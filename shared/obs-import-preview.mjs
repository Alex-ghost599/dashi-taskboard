import yaml from "js-yaml";
import { normalizeObsTaskIdentity } from "./obs-task-contract.mjs";
const states = new Set(["intake", "planned", "active", "waiting", "review", "done", "blocked", "dropped"]);
const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const absolute = (value) => typeof value === "string" && value.length <= 4096 && !value.includes("\0") && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value));
const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const counts = (values) => {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
};

function parse(markdown) {
  if (typeof markdown !== "string" || Buffer.byteLength(markdown) > 1024 * 1024) throw new Error("DOCUMENT_LIMIT");
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match || Buffer.byteLength(match[1]) > 65536) throw new Error("INVALID_FRONTMATTER");
  try {
    // JSON schema keeps dates as strings and does not enable YAML merge semantics.
    const metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA, listener(event, state) {
      if (event === "close" && state.anchor !== null) throw new Error("Anchors unsupported");
    } });
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Mapping required");
    const seen = new Set();
    let nodes = 0;
    const inspect = (value, depth = 0) => {
      if (++nodes > 4096 || depth > 16) throw new Error("Metadata limit");
      if (!value || typeof value !== "object") return;
      if (seen.has(value) || Object.hasOwn(value, "<<")) throw new Error("Aliases/merges unsupported");
      seen.add(value);
      for (const child of Object.values(value)) inspect(child, depth + 1);
    };
    inspect(metadata);
    return { metadata, body: markdown.slice(match[0].length) };
  } catch { throw new Error("INVALID_FRONTMATTER"); }
}

// Read-only, caller-supplied snapshot. Catalog entries are hints for preview,
// not proof of a live host/project or permission to import/dispatch.
export function previewObsImport({ documents, projects, scope, existing = [] }) {
  if (!scope || !date(scope.from) || !date(scope.through) || scope.from > scope.through
    || !Array.isArray(scope.statuses) || !scope.statuses.length || !scope.statuses.every((status) => states.has(status))) throw new Error("INVALID_SCOPE");
  if (!Array.isArray(documents) || documents.length > 1000 || !Array.isArray(existing) || existing.length > 10000
    || documents.reduce((sum, item) => sum + (typeof item?.markdown === "string" ? Buffer.byteLength(item.markdown) : 0), 0) > 10 * 1024 * 1024) throw new Error("INPUT_LIMIT");
  if (!Array.isArray(projects) || projects.length > 10000 || !projects.every((project) => project && identifier(project.hostId) && identifier(project.projectId) && absolute(project.workspacePath))) throw new Error("INVALID_CATALOG");
  if (!existing.every((item) => item && typeof item.taskId === "string" && item.sourceType === "obsidian")) throw new Error("INVALID_EXISTING");
  const parsed = documents.map((document) => {
    const path = document?.path;
    if (typeof path !== "string" || !path.length || path.length > 4096 || path.includes("\0")) return { path: null, error: "INVALID_SOURCE_PATH" };
    try { return { path, sourceMarkdown: document.markdown, ...parse(document.markdown) }; } catch (error) { return { path, error: error.message }; }
  });
  const ids = counts(parsed.filter((item) => item.metadata && typeof item.metadata.task_id === "string").map((item) => item.metadata.task_id));
  const paths = counts(parsed.map((item) => item.path));
  const oldIds = counts(existing.map((item) => item.taskId));
  const rows = parsed.map((item) => {
    const skip = (reason) => ({ path: item.path, taskId: typeof item.metadata?.task_id === "string" ? item.metadata.task_id : null, decision: "skipped", reason });
    if (item.error) return skip(item.error);
    if (paths.get(item.path) > 1) return skip("DUPLICATE_SOURCE_PATH");
    if (ids.get(item.metadata.task_id) > 1) return skip("DUPLICATE_TASK_ID");
    const normalized = normalizeObsTaskIdentity(item.metadata);
    if (normalized.decision !== "valid") return skip(normalized.reason);
    const identity = normalized.identity;
    if (oldIds.get(identity.taskId) > 1) return skip("DUPLICATE_EXISTING_ID");
    const day = identity.taskId.slice(4, 12).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    if (day < scope.from || day > scope.through) return skip("OUTSIDE_DATE_SCOPE");
    if (!scope.statuses.includes(identity.sourceStatus)) return skip("OUTSIDE_STATUS_SCOPE");
    const matches = projects.filter((project) => project.workspacePath === identity.workspaceHint);
    if (matches.length !== 1) return skip(matches.length ? "PROJECT_AMBIGUOUS" : "PROJECT_UNKNOWN");
    const project = matches[0];
    const projectBinding = { hostId: project.hostId, projectId: project.projectId, workspacePath: project.workspacePath };
    if (identity.executionBinding && Object.keys(projectBinding).some((key) => identity.executionBinding[key] !== projectBinding[key])) return skip("BINDING_PROJECT_CONFLICT");
    const proposed = { ...identity, projectBinding, sourcePath: item.path, body: item.body, sourceMarkdown: item.sourceMarkdown };
    const old = existing.find((record) => record.taskId === identity.taskId);
    const changes = Object.keys(proposed).filter((field) => JSON.stringify(old?.[field]) !== JSON.stringify(proposed[field]))
      .map((field) => ({ field, before: old?.[field] ?? null, after: proposed[field] }));
    return { path: item.path, taskId: identity.taskId, decision: "candidate", operation: old ? (changes.length ? "update" : "unchanged") : "create", proposed, changes };
  });
  return { schemaVersion: 1, mode: "preview", authorizesImport: false, authorizesDispatch: false,
    scope: { ...scope, dateBasis: "task_id", inputFiles: documents.length },
    completeness: parsed.some((item) => item.error) ? "unreadable_documents" : "supplied_snapshot_only", rows };
}
