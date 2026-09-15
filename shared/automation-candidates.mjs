import { createHash } from "node:crypto";

const identifier = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const text = (value, max) => typeof value === "string" && value.length <= max;
const uniqueIds = (value) => Array.isArray(value) && value.length <= 10000
  && value.every(identifier) && new Set(value).size === value.length;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function normalize(task, budget) {
  if (!task || !identifier(task.id) || !identifier(task.projectId)
    || !["todo", "in_progress", "in_review", "done", "blocked", "backlog", "cancelled"].includes(task.status)
    || typeof task.archived !== "boolean" || typeof task.hold !== "boolean"
    || typeof task.executionForbidden !== "boolean" || !text(task.title, 2000)
    || !text(task.description, 200000) || !uniqueIds(task.dependencyIds)
    || !Array.isArray(task.labels) || task.labels.length > 100
    || !task.labels.every((label) => text(label, 200))
    || !(task.executionAgent === null || identifier(task.executionAgent))
    || !Array.isArray(task.instructions) || task.instructions.length > 1000
    || !task.instructions.every((item) => item && identifier(item.id) && text(item.text, 200000))
    || new Set(task.instructions.map((item) => item.id)).size !== task.instructions.length) throw new Error("Invalid task snapshot");
  // Bound aggregate work before constructing projections or serializing semantic input.
  budget.edges += task.dependencyIds.length;
  budget.characters += task.title.length + task.description.length
    + task.labels.reduce((sum, label) => sum + label.length, 0);
  for (const item of task.instructions) {
    budget.characters += item.id.length + item.text.length;
    if (budget.characters > 2_000_000) throw new Error("Snapshot character budget exceeded");
  }
  if (budget.characters > 2_000_000 || budget.edges > 20_000) throw new Error("Snapshot work budget exceeded");
  let binding = null;
  if (task.executionBinding !== null) {
    const b = task.executionBinding;
    const fields = ["threadId", "hostId", "projectId", "workspacePath"];
    if (!b || Object.keys(b).length !== fields.length || !fields.every((key) => Object.hasOwn(b, key))
      || !identifier(b.threadId) || !identifier(b.hostId) || !identifier(b.projectId)
      || !text(b.workspacePath, 4096) || b.workspacePath.length === 0) throw new Error("Invalid binding snapshot");
    binding = Object.fromEntries(fields.map((key) => [key, b[key]]));
  }
  // Deliberate semantic projection: audit timestamps/versions/receipts are not judgment input.
  // The adapter must put every human instruction (including human comments) in instructions.
  return { id: task.id, projectId: task.projectId, status: task.status, archived: task.archived,
    title: task.title, description: task.description, labels: [...new Set(task.labels)].sort(),
    executionAgent: task.executionAgent, hold: task.hold, executionForbidden: task.executionForbidden,
    dependencyIds: [...task.dependencyIds].sort(), executionBinding: binding,
    instructions: task.instructions.map(({ id, text: content }) => ({ id, text: content })) };
}

// Pure local qualification only. The caller supplies a complete normalized snapshot;
// policy admission, durable leasing and dispatch are separate coordinator operations.
export function assessCandidate(taskId, context) {
  const blocked = (reason, extra = {}) => ({ decision: "blocked", reason, authorizesDispatch: false, ...extra });
  if (!identifier(taskId) || !context || !uniqueIds(context.projectIds)
    || !uniqueIds(context.unresolvedTaskIds) || !identifier(context.judgePolicyRev)
    || !Array.isArray(context.tasks) || context.tasks.length > 10000) return blocked("INVALID_SNAPSHOT");
  const byId = new Map();
  for (const task of context.tasks) {
    if (!task || !identifier(task.id)) return blocked("INVALID_SNAPSHOT");
    if (byId.has(task.id)) return blocked("AMBIGUOUS_TASK");
    byId.set(task.id, task);
  }
  if (!byId.has(taskId)) return blocked("TASK_MISSING");
  const budget = { characters: 0, edges: 0 };
  let task;
  try { task = normalize(byId.get(taskId), budget); } catch { return blocked("INVALID_SNAPSHOT"); }
  const dependencies = new Map();
  const visiting = new Set();
  const visited = new Set();
  const stack = [{ id: taskId, exit: false }];
  let dependencyProblem = null;
  while (stack.length) {
    const item = stack.pop();
    if (item.exit) { visiting.delete(item.id); visited.add(item.id); continue; }
    if (visiting.has(item.id)) { dependencyProblem = "DEPENDENCY_CYCLE"; break; }
    if (visited.has(item.id)) continue;
    if (!byId.has(item.id)) { dependencyProblem = "DEPENDENCY_MISSING"; break; }
    let current;
    try { current = item.id === taskId ? task : normalize(byId.get(item.id), budget); } catch { return blocked("INVALID_SNAPSHOT"); }
    if (item.id !== taskId) dependencies.set(item.id, { id: current.id, projectId: current.projectId,
      status: current.status, archived: current.archived, dependencyIds: current.dependencyIds });
    visiting.add(item.id);
    stack.push({ id: item.id, exit: true });
    for (const id of [...current.dependencyIds].reverse()) stack.push({ id, exit: false });
  }
  const dependencyState = [...dependencies.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const semanticInputVersion = digest({ schemaVersion: 1, task, dependencyState, dependencyProblem });
  const judgmentKey = digest({ semanticInputVersion, judgePolicyRev: context.judgePolicyRev });
  const versions = { semanticInputVersion, judgmentKey };
  if (task.archived || task.status !== "todo") return blocked("NOT_TODO", versions);
  if (task.hold || task.labels.some((label) => label.trim().toLowerCase() === "hold")) return blocked("HOLD", versions);
  if (task.executionForbidden) return blocked("EXECUTION_FORBIDDEN", versions);
  if (task.executionAgent !== "codex") return blocked("EXECUTOR_NOT_CODEX", versions);
  if (!context.projectIds.includes(task.projectId)) return blocked("PROJECT_UNKNOWN", versions);
  if (context.unresolvedTaskIds.includes(task.id)) return blocked("UNRESOLVED_ATTEMPT", versions);
  if (dependencyProblem) return blocked(dependencyProblem, versions);
  if (dependencyState.some((dep) => !context.projectIds.includes(dep.projectId))) return blocked("DEPENDENCY_PROJECT_UNKNOWN", versions);
  if (dependencyState.some((dep) => dep.archived || dep.status !== "done")) return blocked("DEPENDENCY_NOT_DONE", versions);
  return { decision: "candidate", authorizesDispatch: false, ...versions };
}
