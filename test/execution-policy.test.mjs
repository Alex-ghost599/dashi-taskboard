import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { previewExecutionPolicy } from "../server/execution-policy.mjs";

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "taskboard-policy-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  mkdirSync(workspace);
  return { root, workspace, policy: {
    schemaVersion: 1, projectId: "project-a", hostId: "local", workspacePath: workspace,
    enabled: true, taskCategories: ["code", "docs"], allowedTools: ["read_file", "apply_patch"],
    maxCallsPerRun: 4, maxConcurrent: 1, maxDispatchesPerDay: 10,
    expiresAt: "2099-01-01T00:00:00.000Z",
  }, request: {
    projectId: "project-a", hostId: "local", workspacePath: workspace,
    taskCategory: "docs", tools: ["read_file"], maxCalls: 2,
  }};
}

test("a scoped request passes preflight without becoming an execution permit", (t) => {
  const { policy, request } = fixture(t);
  const result = previewExecutionPolicy({ revision: 1, policy }, request);
  assert.equal(result.decision, "eligible_for_admission");
  assert.equal(result.policyRevision, 1);
  assert.equal(result.authorizesDispatch, false);
  assert.deepEqual(result.limits, { maxCallsPerRun: 4, maxConcurrent: 1, maxDispatchesPerDay: 10 });
});

test("missing, paused, expired and stale policy fail closed", (t) => {
  const { policy, request } = fixture(t);
  assert.equal(previewExecutionPolicy(null, request).reason, "NO_POLICY");
  assert.equal(previewExecutionPolicy({ revision: 2, policy: { ...policy, enabled: false } }, request).reason, "PAUSED");
  assert.equal(previewExecutionPolicy({ revision: 2, policy: { ...policy, expiresAt: "2000-01-01T00:00:00.000Z" } }, request).reason, "EXPIRED");
  assert.equal(previewExecutionPolicy({ revision: 2, policy }, request, { expectedRevision: 1 }).reason, "STALE_POLICY");
});

test("task input cannot expand tools, scope, budget or trusted policy fields", (t) => {
  const { policy, request } = fixture(t);
  for (const patch of [
    { projectId: "other" }, { hostId: "remote" }, { workspacePath: path.dirname(request.workspacePath) },
    { taskCategory: "deployment" }, { tools: ["run_shell"] }, { maxCalls: 5 },
    { maxCalls: -1 }, { maxCalls: "2" }, { enabled: true }, { policyRevision: 1 },
  ]) {
    assert.equal(previewExecutionPolicy({ revision: 1, policy }, { ...request, ...patch }).decision, "blocked");
  }
});

test("scope is the exact canonical workspace, not a string prefix or escaped symlink", (t) => {
  const { root, workspace, policy, request } = fixture(t);
  const other = path.join(root, "workspace-other"); mkdirSync(other);
  assert.equal(previewExecutionPolicy({ revision: 1, policy }, { ...request, workspacePath: other }).reason, "WORKSPACE_MISMATCH");
  const link = path.join(workspace, "escape"); symlinkSync(other, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(previewExecutionPolicy({ revision: 1, policy }, { ...request, workspacePath: link }).reason, "WORKSPACE_MISMATCH");
});

test("a changed task within the same scope does not require a new project grant", (t) => {
  const { policy, request } = fixture(t);
  assert.equal(previewExecutionPolicy({ revision: 7, policy }, request).decision, "eligible_for_admission");
  assert.equal(previewExecutionPolicy({ revision: 7, policy }, { ...request, taskCategory: "code", tools: ["apply_patch"] }).policyRevision, 7);
});

test("a saved workspace replaced with a symlink cannot silently redirect the policy", (t) => {
  const { root, workspace, policy, request } = fixture(t);
  const replacement = path.join(root, "replacement"); mkdirSync(replacement);
  rmSync(workspace, { recursive: true });
  symlinkSync(replacement, workspace, process.platform === "win32" ? "junction" : "dir");
  assert.equal(previewExecutionPolicy({ revision: 1, policy }, request).reason, "WORKSPACE_CHANGED");
});
