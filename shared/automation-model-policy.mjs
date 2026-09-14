const JUDGE_MODEL = "gpt-5.3-codex-spark";
const EXECUTOR_MODEL = "gpt-6-astra";
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const HIGHER_EFFORTS = new Set(["xhigh", "max", "ultra"]);

// Model selection only: this result is not a dispatch permit or proof of adapter isolation.
// trustedExecutorEffort must come from operator control state, never a card/model payload.
export function resolveAutomationModels(catalog, request, { trustedExecutorEffort } = {}) {
  const wait = (reason) => ({ status: "waiting", reason, authorizesDispatch: false });
  if (!request || typeof request !== "object" || Array.isArray(request)
    || Object.keys(request).length !== 1 || !Object.hasOwn(request, "executorEffort")) return wait("INVALID_MODEL_REQUEST");
  const effort = request.executorEffort === "light" ? "low" : request.executorEffort;
  if (!EFFORTS.has(effort)) return wait("INVALID_MODEL_REQUEST");
  if (HIGHER_EFFORTS.has(effort) && trustedExecutorEffort !== effort) return wait("TRUSTED_EFFORT_OVERRIDE_REQUIRED");
  if (!Array.isArray(catalog?.models)) return wait("MODEL_CATALOG_UNAVAILABLE");
  const candidates = (slug) => catalog.models.filter((model) => model && model.slug === slug);
  const judge = candidates(JUDGE_MODEL); const executor = candidates(EXECUTOR_MODEL);
  if (judge.length > 1 || executor.length > 1) return wait("AMBIGUOUS_MODEL_CATALOG");
  const visible = (model) => model && (model.visibility === undefined || model.visibility === "list");
  if (!visible(judge[0])) return wait("JUDGE_MODEL_UNAVAILABLE");
  if (!visible(executor[0])) return wait("EXECUTOR_MODEL_UNAVAILABLE");
  const supports = (model, level) => Array.isArray(model.supported_reasoning_levels)
    && model.supported_reasoning_levels.some((item) => item?.effort === level);
  if (!supports(judge[0], "low")) return wait("JUDGE_EFFORT_UNAVAILABLE");
  if (!supports(executor[0], effort)) return wait("EXECUTOR_EFFORT_UNAVAILABLE");
  return { status: "model_selection_valid", authorizesDispatch: false,
    judge: { model: JUDGE_MODEL, reasoningEffort: "low" },
    executor: { model: EXECUTOR_MODEL, reasoningEffort: effort } };
}
