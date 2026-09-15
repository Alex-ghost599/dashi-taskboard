import test from "node:test";
import assert from "node:assert/strict";
import { assessCandidate } from "../shared/automation-candidates.mjs";

const task = (patch = {}) => ({ id: "t1", projectId: "p1", status: "todo", archived: false,
  title: "Synthetic task", description: "Check fixture", labels: [], executionAgent: "codex",
  hold: false, executionForbidden: false, dependencyIds: [], executionBinding: null,
  instructions: [], ...patch });
const context = (patch = {}) => ({ projectIds: ["p1"], tasks: [task()], unresolvedTaskIds: [],
  judgePolicyRev: "1", ...patch });

test("candidate assessment never authorizes execution and ignores audit-only changes", () => {
  const first = assessCandidate("t1", context());
  assert.equal(first.decision, "candidate");
  assert.equal(first.authorizesDispatch, false);
  const updated = assessCandidate("t1", context({ tasks: [task({ updatedAt: "later", version: 7,
    comments: [{ kind: "system_receipt", text: "processed" }] })] }));
  assert.equal(updated.semanticInputVersion, first.semanticInputVersion);
  assert.equal(updated.judgmentKey, first.judgmentKey);
});

test("relevant input and judge policy changes invalidate judgment keys", () => {
  const first = assessCandidate("t1", context());
  for (const patch of [{ title: "changed" }, { description: "changed" }, { labels: ["review"] },
    { instructions: [{ id: "i1", text: "Do not proceed yet" }] },
    { executionBinding: { threadId: "thread1", hostId: "local", projectId: "p1", workspacePath: "/fixture" } }]) {
    assert.notEqual(assessCandidate("t1", context({ tasks: [task(patch)] })).judgmentKey, first.judgmentKey);
  }
  const revised = assessCandidate("t1", context({ judgePolicyRev: "2" }));
  assert.equal(revised.semanticInputVersion, first.semanticInputVersion);
  assert.notEqual(revised.judgmentKey, first.judgmentKey);
});

test("local guards reject held, forbidden, archived, ambiguous, foreign and unresolved tasks", () => {
  for (const patch of [{ hold: true }, { executionForbidden: true }, { archived: true },
    { status: "in_progress" }, { executionAgent: "claude" }, { executionAgent: null },
    { projectId: "unknown" }, { labels: ["HOLD"] }]) {
    assert.equal(assessCandidate("t1", context({ tasks: [task(patch)] })).decision, "blocked");
  }
  assert.equal(assessCandidate("t1", context({ unresolvedTaskIds: ["t1"] })).reason, "UNRESOLVED_ATTEMPT");
  assert.equal(assessCandidate("t1", context({ tasks: [task(), task()] })).reason, "AMBIGUOUS_TASK");
});

test("missing and cyclic dependencies fail closed; completion invalidates semantic version", () => {
  const main = task({ dependencyIds: ["t2"] });
  const pending = task({ id: "t2", status: "in_review" });
  const blocked = assessCandidate("t1", context({ tasks: [main, pending] }));
  assert.equal(blocked.reason, "DEPENDENCY_NOT_DONE");
  const done = assessCandidate("t1", context({ tasks: [main, { ...pending, status: "done" }] }));
  assert.equal(done.decision, "candidate");
  assert.notEqual(done.semanticInputVersion, blocked.semanticInputVersion);
  assert.equal(assessCandidate("t1", context({ tasks: [main] })).reason, "DEPENDENCY_MISSING");
  assert.equal(assessCandidate("t1", context({ tasks: [main, { ...pending, status: "done", dependencyIds: ["t1"] }] })).reason, "DEPENDENCY_CYCLE");
});

test("dependency order is stable and a shared dependency is not a cycle", () => {
  const nodes = [task({ dependencyIds: ["b", "a"] }),
    task({ id: "a", status: "done", dependencyIds: ["c"] }),
    task({ id: "b", status: "done", dependencyIds: ["c"] }), task({ id: "c", status: "done" })];
  const first = assessCandidate("t1", context({ tasks: nodes }));
  assert.equal(first.decision, "candidate");
  assert.equal(assessCandidate("t1", context({ tasks: [nodes[3], nodes[2], nodes[1],
    { ...nodes[0], dependencyIds: ["a", "b"] }] })).judgmentKey, first.judgmentKey);
});

test("malformed fields cannot become eligible through truthy coercion", () => {
  for (const patch of [{ hold: "false" }, { executionForbidden: undefined },
    { instructions: [{ id: "x", text: "first" }, { id: "x", text: "second" }] },
    { dependencyIds: ["t2", "t2"] }, { executionBinding: { threadId: "legacy" } }]) {
    assert.equal(assessCandidate("t1", context({ tasks: [task(patch)] })).reason, "INVALID_SNAPSHOT");
  }
});

test("aggregate semantic text and graph work are bounded before hashing", () => {
  const instructions = Array.from({ length: 21 }, (_, i) => ({ id: `i${i}`, text: "x".repeat(100000) }));
  assert.equal(assessCandidate("t1", context({ tasks: [task({ instructions })] })).reason, "INVALID_SNAPSHOT");
  const ids = Array.from({ length: 150 }, (_, i) => `d${i}`);
  const tasks = [task({ dependencyIds: ids }), ...ids.map((id, i) => task({ id, status: "done",
    dependencyIds: ids.slice(i + 1) }))];
  // Under budget: a dense acyclic graph remains usable.
  assert.equal(assessCandidate("t1", context({ tasks })).decision, "candidate");
  const bigIds = Array.from({ length: 210 }, (_, i) => `d${i}`);
  const excessive = [task({ dependencyIds: bigIds }), ...bigIds.map((id, i) => task({ id, status: "done",
    dependencyIds: bigIds.slice(i + 1) }))];
  assert.equal(assessCandidate("t1", context({ tasks: excessive })).reason, "INVALID_SNAPSHOT");
});
