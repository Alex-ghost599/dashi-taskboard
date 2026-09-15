const id = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const text = (value, max) => typeof value === "string" && value.length <= max && !value.includes("\0");
const blank = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
const states = new Set(["intake", "planned", "active", "waiting", "review", "done", "blocked", "dropped"]);
function taskId(value) {
  const match = typeof value === "string" && /^AGT-(\d{4})(\d{2})(\d{2})-(\d{3})$/.exec(value);
  if (!match) return false;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function binding(value) {
  if (blank(value)) return null;
  const fields = ["hostId", "projectId", "workspacePath", "threadId"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length || !fields.every((key) => Object.hasOwn(value, key))
    || !id(value.hostId) || !id(value.projectId) || !id(value.threadId)
    || !text(value.workspacePath, 4096) || !(value.workspacePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value.workspacePath))) throw new Error("INVALID_BINDING");
  return Object.fromEntries(fields.map((key) => [key, value[key]]));
}

// Input is parsed frontmatter, not Markdown text. This function never reads files,
// resolves a project, imports a task or authorizes execution.
export function normalizeObsTaskIdentity(input) {
  const reject = (reason) => ({ decision: "blocked", reason, authorizesDispatch: false });
  if (!input || typeof input !== "object" || Array.isArray(input)) return reject("INVALID_INPUT");
  if (!taskId(input.task_id)) return reject("INVALID_TASK_ID");
  if (blank(input.agent)) return reject("SOURCE_UNKNOWN");
  if (!id(input.agent)) return reject("INVALID_SOURCE");
  if (input.agent !== "codex") return reject("SOURCE_NOT_CODEX");
  const executor = blank(input.executor_agent) ? input.agent : input.executor_agent;
  if (!id(executor)) return reject("INVALID_EXECUTOR");
  if (executor !== "codex") return reject("EXECUTOR_NOT_CODEX");
  if (!states.has(input.status)) return reject("UNKNOWN_STATUS");
  if (!blank(input.workspace) && !text(input.workspace, 4096)) return reject("INVALID_WORKSPACE_HINT");
  if (!blank(input.source_session) && !text(input.source_session, 4096)) return reject("INVALID_SOURCE_SESSION");
  let executionBinding;
  try { executionBinding = binding(input.execution_binding); } catch { return reject("INVALID_BINDING"); }
  return { decision: "valid", authorizesDispatch: false, identity: {
    schemaVersion: 1, sourceType: "obsidian", taskId: input.task_id,
    sourceAgent: input.agent, executorAgent: executor, sourceStatus: input.status,
    workspaceHint: blank(input.workspace) ? null : input.workspace,
    sourceSession: blank(input.source_session) ? null : input.source_session,
    executionBinding, bindingVerified: false, projectBinding: null,
  } };
}
