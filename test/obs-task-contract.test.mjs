import test from "node:test";
import assert from "node:assert/strict";
import { normalizeObsTaskIdentity } from "../shared/obs-task-contract.mjs";
const base = { task_id: "AGT-20260915-001", agent: "codex", status: "planned", workspace: "external-system" };

test("legacy blank executor means the known source agent, never a guessed Codex identity", () => {
  for (const value of [undefined, null, "", "  "]) {
    const result = normalizeObsTaskIdentity({ ...base, executor_agent: value });
    assert.equal(result.decision, "valid");
    assert.equal(result.identity.executorAgent, "codex");
    assert.equal(result.identity.executionBinding, null);
    assert.equal(result.identity.projectBinding, null);
    assert.equal(result.authorizesDispatch, false);
  }
  assert.equal(normalizeObsTaskIdentity({ ...base, agent: null }).reason, "SOURCE_UNKNOWN");
  assert.equal(normalizeObsTaskIdentity({ ...base, agent: "hermes", executor_agent: "codex" }).reason, "SOURCE_NOT_CODEX");
  assert.equal(normalizeObsTaskIdentity({ ...base, executor_agent: "hermes" }).reason, "EXECUTOR_NOT_CODEX");
});

test("source session never grants execution binding and identity is independent of note path", () => {
  const first = normalizeObsTaskIdentity({ ...base, source_session: "codex://threads/source-1", file: "/notes/first.md" });
  const moved = normalizeObsTaskIdentity({ ...base, source_session: "codex://threads/source-1", file: "/notes/moved.md" });
  assert.deepEqual(first.identity, moved.identity);
  assert.equal(first.identity.sourceSession, "codex://threads/source-1");
  assert.equal(first.identity.executionBinding, null);
  assert.equal(first.identity.workspaceHint, "external-system");
});

test("malformed identities, incomplete bindings and unknown states fail explicitly", () => {
  assert.equal(normalizeObsTaskIdentity({ ...base, task_id: "AGT-20260230-001" }).reason, "INVALID_TASK_ID");
  assert.equal(normalizeObsTaskIdentity({ ...base, status: "todo" }).reason, "UNKNOWN_STATUS");
  assert.equal(normalizeObsTaskIdentity({ ...base, execution_binding: { threadId: "source-1" } }).reason, "INVALID_BINDING");
});

test("complete binding remains unverified and source status stays separate from native todo", () => {
  const execution_binding = { hostId: "local", projectId: "project-1", workspacePath: "/synthetic/project", threadId: "executor-1" };
  for (const status of ["intake", "planned", "active", "waiting", "review", "done", "blocked", "dropped"]) {
    const result = normalizeObsTaskIdentity({ ...base, status, execution_binding, source_session: "source-1" });
    assert.equal(result.decision, "valid");
    assert.equal(result.identity.sourceStatus, status);
    assert.deepEqual(result.identity.executionBinding, execution_binding);
    assert.equal(result.identity.bindingVerified, false);
    assert.equal(result.identity.projectBinding, null);
    assert.equal(result.authorizesDispatch, false);
    assert.equal(Object.hasOwn(result.identity, "status"), false);
  }
});

test("binding cannot accept arrays, relative paths, NUL or missing scope", () => {
  const valid = { hostId: "local", projectId: "p1", workspacePath: "/synthetic", threadId: "t1" };
  for (const execution_binding of [[], { ...valid, workspacePath: "relative" }, { ...valid, workspacePath: "/bad\0path" }, { ...valid, hostId: "" }, { ...valid, extra: true }]) {
    assert.equal(normalizeObsTaskIdentity({ ...base, execution_binding }).reason, "INVALID_BINDING");
  }
});
