import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const script = fileURLToPath(new URL("../scripts/automation-capabilities.mjs", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "automation-capabilities-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "catalog.json");
  writeFileSync(file, JSON.stringify({ models: [
    { slug: "gpt-5.3-codex-spark", supported_reasoning_levels: [{ effort: "low" }], privateExtra: "DO_NOT_ECHO" },
    { slug: "gpt-6-astra", supported_reasoning_levels: [{ effort: "low" }, { effort: "max" }] },
  ] }));
  return { file, run: (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" }) };
}

test("offline catalog CLI reports model selection while leaving execution readiness unverified", (t) => {
  const { file, run } = fixture(t); const before = readFileSync(file);
  const r = run("--catalog", file, "--executor-effort", "light"); assert.equal(r.status, 0);
  const result = JSON.parse(r.stdout);
  assert.equal(result.selection.executor.reasoningEffort, "low");
  assert.equal(result.authorizesDispatch, false);
  assert.equal(result.readiness, "waiting_for_adapter_validation");
  assert.equal(result.evidence.catalogSource, "snapshot_file");
  assert.equal(result.evidence.modelGenerationVerified, false);
  assert.equal(r.stdout.includes("DO_NOT_ECHO"), false);
  assert.deepEqual(readFileSync(file), before);
});

test("catalog selection does not grant higher effort through ordinary command input", (t) => {
  const { file, run } = fixture(t);
  assert.equal(JSON.parse(run("--catalog", file, "--executor-effort", "max").stdout).selection.reason, "TRUSTED_EFFORT_OVERRIDE_REQUIRED");
  const r = run("--catalog", file, "--executor-effort", "max", "--trusted-executor-effort", "max");
  assert.equal(JSON.parse(r.stdout).selection.status, "model_selection_valid");
});

test("invalid and conflicting sources fail without invoking an executable", (t) => {
  const { file, run } = fixture(t);
  assert.equal(run("--catalog", file, "--codex", "/should-not-run").status, 1);
  assert.equal(run("--codex", "relative-codex").status, 1);
  assert.equal(run("--catalog", file, "--enable-execution", "true").status, 1);
});

test("live probe invokes only debug models and removes taskboard launcher environment", (t) => {
  const { file } = fixture(t); const executable = path.join(path.dirname(file), "fake-codex.mjs");
  const receipt = path.join(path.dirname(file), "invocation.json");
  writeFileSync(executable, `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({args:process.argv.slice(2),launcher:process.env.CODEX_TASKBOARD_URL??null}));
process.stdout.write(fs.readFileSync(${JSON.stringify(file)},'utf8'));`);
  const result = spawnSync(process.execPath, [script, "--codex", executable], {
    encoding: "utf8", env: { ...process.env, CODEX_TASKBOARD_URL: "private-launcher-value" },
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(receipt)), { args: ["debug", "models"], launcher: null });
  assert.equal(JSON.parse(result.stdout).selection.status, "model_selection_valid");
  assert.equal(result.stdout.includes("private-launcher-value"), false);
});

test("failed executable stderr and malformed catalog contents are never echoed or used as fallback", (t) => {
  const { file, run } = fixture(t); const executable = path.join(path.dirname(file), "broken-codex.mjs");
  writeFileSync(executable, "console.error('PRIVATE_PROVIDER_SECRET'); process.exit(1);");
  let result = run("--codex", executable);
  assert.equal(result.status, 1); assert.equal((result.stdout + result.stderr).includes("PRIVATE_PROVIDER_SECRET"), false);
  writeFileSync(file, "PRIVATE_CATALOG_SECRET"); result = run("--catalog", file);
  assert.equal(result.status, 1); assert.equal((result.stdout + result.stderr).includes("PRIVATE_CATALOG_SECRET"), false);
});
