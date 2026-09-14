import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAutomationModels } from "../shared/automation-model-policy.mjs";
const catalog = { models: [
  { slug: "gpt-5.3-codex-spark", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }] },
  { slug: "gpt-6-astra", supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort })) },
] };

test("uses the exact Spark/GPT6 pair and maps Light to low without authorizing dispatch", () => {
  const result = resolveAutomationModels(catalog, { executorEffort: "light" });
  assert.equal(result.status, "model_selection_valid");
  assert.deepEqual(result.judge, { model: "gpt-5.3-codex-spark", reasoningEffort: "low" });
  assert.deepEqual(result.executor, { model: "gpt-6-astra", reasoningEffort: "low" });
  assert.equal(result.authorizesDispatch, false);
});

test("unavailable exact model never falls back to another catalog entry", () => {
  const result = resolveAutomationModels({ models: catalog.models.slice(1) }, { executorEffort: "medium" });
  assert.equal(result.status, "waiting"); assert.equal(result.reason, "JUDGE_MODEL_UNAVAILABLE");
  assert.equal(Object.hasOwn(result, "executor"), false);
});

test("catalog reasoning levels constrain both models, including Judge low", () => {
  const models = structuredClone(catalog.models);
  models[0].supported_reasoning_levels = [{ effort: "high" }];
  assert.equal(resolveAutomationModels({ models }, { executorEffort: "low" }).reason, "JUDGE_EFFORT_UNAVAILABLE");
  models[0] = catalog.models[0]; models[1].supported_reasoning_levels = [{ effort: "low" }];
  assert.equal(resolveAutomationModels({ models }, { executorEffort: "high" }).reason, "EXECUTOR_EFFORT_UNAVAILABLE");
});

test("model text cannot self-authorize above high or inject policy fields", () => {
  for (const executorEffort of ["xhigh", "max", "ultra"]) {
    assert.equal(resolveAutomationModels(catalog, { executorEffort }).reason, "TRUSTED_EFFORT_OVERRIDE_REQUIRED");
  }
  assert.equal(resolveAutomationModels(catalog, { executorEffort: "max", approvedByUser: true }).reason, "INVALID_MODEL_REQUEST");
});

test("above-high requires an exact matching separate trusted operator value", () => {
  assert.equal(resolveAutomationModels(catalog, { executorEffort: "max" }, { trustedExecutorEffort: "max" }).status, "model_selection_valid");
  assert.equal(resolveAutomationModels(catalog, { executorEffort: "ultra" }, { trustedExecutorEffort: "max" }).reason, "TRUSTED_EFFORT_OVERRIDE_REQUIRED");
});

test("unknown, ambiguous, hidden and malformed catalog entries fail closed", () => {
  assert.equal(resolveAutomationModels(null, { executorEffort: "low" }).status, "waiting");
  assert.equal(resolveAutomationModels(catalog, { executorEffort: "automatic" }).reason, "INVALID_MODEL_REQUEST");
  assert.equal(resolveAutomationModels({ models: [...catalog.models, catalog.models[0]] }, { executorEffort: "low" }).reason, "AMBIGUOUS_MODEL_CATALOG");
  assert.equal(resolveAutomationModels({ models: [{ ...catalog.models[0], visibility: "hide" }, catalog.models[1]] }, { executorEffort: "low" }).reason, "JUDGE_MODEL_UNAVAILABLE");
  assert.equal(resolveAutomationModels({ models: [null] }, { executorEffort: "low" }).status, "waiting");
});
