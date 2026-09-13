import { realpathSync, statSync } from "node:fs";
import path from "node:path";

const POLICY_FIELDS = ["schemaVersion", "projectId", "hostId", "workspacePath", "enabled", "taskCategories", "allowedTools", "maxCallsPerRun", "maxConcurrent", "maxDispatchesPerDay", "expiresAt"];
const REQUEST_FIELDS = ["projectId", "hostId", "workspacePath", "taskCategory", "tools", "maxCalls"];
const identifier = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
function exactFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}
function identifiers(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 100
    && value.every(identifier) && new Set(value).size === value.length;
}
function canonicalDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("Absolute workspace directory required");
  const resolved = realpathSync(value);
  if (!statSync(resolved).isDirectory()) throw new Error("Workspace must be a directory");
  return resolved;
}

// Only an operator may persist this object. Task fields and model responses are requests, never policies.
export function validateExecutionPolicy(value) {
  if (!exactFields(value, POLICY_FIELDS) || value.schemaVersion !== 1
    || !identifier(value.projectId) || value.hostId !== "local" || typeof value.enabled !== "boolean"
    || !identifiers(value.taskCategories) || !identifiers(value.allowedTools)
    || !positiveInteger(value.maxCallsPerRun) || !positiveInteger(value.maxConcurrent)
    || !positiveInteger(value.maxDispatchesPerDay)
    || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))
    || new Date(value.expiresAt).toISOString() !== value.expiresAt) {
    throw new Error("Invalid execution policy");
  }
  return { ...value, workspacePath: canonicalDirectory(value.workspacePath),
    taskCategories: [...value.taskCategories], allowedTools: [...value.allowedTools] };
}

// This checks scope only. The coordinator must re-read policy/task, reserve budget and
// concurrency atomically, and validate the actual adapter before any external dispatch.
export function previewExecutionPolicy(record, request, { expectedRevision, now = Date.now() } = {}) {
  const blocked = (reason) => ({ decision: "blocked", reason, authorizesDispatch: false });
  if (!record) return blocked("NO_POLICY");
  let policy;
  try {
    if (!positiveInteger(record.revision)) return blocked("INVALID_POLICY");
    policy = validateExecutionPolicy(record.policy);
    // Stored canonical path must not silently follow a replacement symlink.
    if (policy.workspacePath !== record.policy.workspacePath) return blocked("WORKSPACE_CHANGED");
  } catch { return blocked("INVALID_POLICY"); }
  if (expectedRevision !== undefined && expectedRevision !== record.revision) return blocked("STALE_POLICY");
  if (!policy.enabled) return blocked("PAUSED");
  if (!Number.isFinite(now) || Date.parse(policy.expiresAt) <= now) return blocked("EXPIRED");
  if (!exactFields(request, REQUEST_FIELDS) || !identifier(request.projectId)
    || !identifier(request.hostId) || !identifier(request.taskCategory)
    || !identifiers(request.tools) || !positiveInteger(request.maxCalls)) return blocked("INVALID_REQUEST");
  if (request.projectId !== policy.projectId) return blocked("PROJECT_MISMATCH");
  if (request.hostId !== policy.hostId) return blocked("HOST_MISMATCH");
  try {
    if (canonicalDirectory(request.workspacePath) !== policy.workspacePath) return blocked("WORKSPACE_MISMATCH");
  } catch { return blocked("WORKSPACE_UNAVAILABLE"); }
  if (!policy.taskCategories.includes(request.taskCategory)) return blocked("CATEGORY_NOT_ALLOWED");
  if (request.tools.some((tool) => !policy.allowedTools.includes(tool))) return blocked("TOOL_NOT_ALLOWED");
  if (request.maxCalls > policy.maxCallsPerRun) return blocked("CALL_LIMIT_EXCEEDED");
  return { decision: "eligible_for_admission", policyRevision: record.revision, authorizesDispatch: false,
    limits: { maxCallsPerRun: policy.maxCallsPerRun, maxConcurrent: policy.maxConcurrent,
      maxDispatchesPerDay: policy.maxDispatchesPerDay } };
}
