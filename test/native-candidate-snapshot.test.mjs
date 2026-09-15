import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TaskboardDatabase } from "../server/database.mjs";
import { ExecutionAttemptStore } from "../server/execution-attempt-store.mjs";
import { NativeSnapshotReader } from "../server/native-candidate-snapshot.mjs";
import { assessCandidate } from "../shared/automation-candidates.mjs";
const user = { type: "user", id: "tester", name: "Tester", avatarUrl: null };
const codex = { type: "agent", id: "codex-agent", name: "Codex", avatarUrl: null };
function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), "native-snapshot-"));
  const file = path.join(root, "taskboard.sqlite");
  const writer = new TaskboardDatabase(file);
  writer.createProject({ id: "p1", name: "Synthetic", workspacePath: root });
  const reader = new NativeSnapshotReader(file);
  t.after(() => { reader.close(); writer.close(); rmSync(root, { recursive: true, force: true }); });
  const create = (patch = {}) => writer.createTask({ projectId: "p1", title: "Synthetic task", description: "", status: "todo",
    priority: "none", labels: [], actor: user, assignee: codex, threadId: null, developmentContext: null,
    startDate: null, dueDate: null, recurrence: null, ...patch });
  return { root, file, writer, reader, create };
}

test("native snapshot uses assignee rather than creator and keeps human comments semantic", (t) => {
  const { writer, reader, create } = setup(t);
  const task = create();
  const initial = reader.read("p1", "1");
  assert.equal(assessCandidate(task.id, initial).decision, "candidate");
  const before = assessCandidate(task.id, initial).judgmentKey;
  writer.createComment(task.id, { body: "Wait for review", actor: user });
  const after = reader.read("p1", "1");
  assert.notEqual(assessCandidate(task.id, after).judgmentKey, before);
  assert.ok(after.tasks.find((item) => item.id === task.id).instructions.some((item) => item.text.includes("Wait for review")));
  const foreign = create({ actor: codex, assignee: { ...codex, id: "claude-agent" } });
  assert.equal(assessCandidate(foreign.id, reader.read("p1", "1")).reason, "EXECUTOR_NOT_CODEX");
});

test("native snapshot includes completed dependencies, rejects hold and preserves legacy provenance", (t) => {
  const { writer, reader, create } = setup(t);
  const dependency = create({ status: "done", description: "DEPENDENCY_CONTENT_NOT_NEEDED" });
  const task = create();
  writer.addTaskRelation(dependency.id, dependency.version, "blocks", task.id, null, null, user);
  assert.equal(assessCandidate(task.id, reader.read("p1", "1")).decision, "candidate");
  assert.doesNotMatch(JSON.stringify(reader.read("p1", "1")), /DEPENDENCY_CONTENT_NOT_NEEDED/);
  const held = create({ labels: ["hold"] });
  assert.equal(assessCandidate(held.id, reader.read("p1", "1")).reason, "HOLD");
  const legacy = create({ threadId: "legacy-thread" });
  assert.equal(reader.read("p1", "1").tasks.find((row) => row.id === legacy.id).executionBinding, null);
});

test("snapshot does not touch task versions, audit state or database contents", (t) => {
  const { writer, reader, create, file } = setup(t);
  const task = create();
  writer.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const before = readFileSync(file);
  for (let i = 0; i < 10; i++) reader.read("p1", "1");
  assert.deepEqual(readFileSync(file), before);
  assert.equal(writer.getTask(task.id).version, task.version);
  assert.equal(writer.listComments(task.id).length, 0);
});

test("snapshot refuses unknown projects and bounds large stored text before materializing it", (t) => {
  const { writer, reader, create } = setup(t);
  assert.throws(() => reader.read("missing", "1"), /PROJECT_UNAVAILABLE/);
  const task = create();
  writer.database.prepare("UPDATE tasks SET description=? WHERE id=?").run("x".repeat(2_000_001), task.id);
  assert.throws(() => reader.read("p1", "1"), /SNAPSHOT_LIMIT/);
});


test("editing source conversation never becomes an execution binding", (t) => {
  const { writer, reader, create, root } = setup(t);
  const source = { threadId: "source-a", codexProjectId: "codex-project", codexProjectKind: "local", codexHostId: "local", workspacePath: root };
  const task = create({ threadBinding: source });
  assert.deepEqual(writer.getTask(task.id).threadBinding, source);
  assert.equal(reader.read("p1", "1").tasks.find((row) => row.id === task.id).executionBinding, null);
  const nextSource = { ...source, threadId: "source-b" };
  writer.updateTask(task.id, task.version, { title: "Edited by another conversation" }, nextSource.threadId, nextSource, user);
  assert.deepEqual(writer.getTask(task.id).threadBinding, nextSource);
  assert.equal(reader.read("p1", "1").tasks.find((row) => row.id === task.id).executionBinding, null);
});


test("snapshot reads only the dedicated binding and includes its revision in semantic input", (t) => {
  const { writer, create, root, file } = setup(t);
  const task = create();
  const control = new ExecutionAttemptStore(path.join(root, "control.sqlite"));
  const reader = new NativeSnapshotReader(file, { bindingStore: control });
  t.after(() => { reader.close(); control.close(); });
  const binding = { threadId: "executor", codexProjectId: "codex-project", codexProjectKind: "local", codexHostId: "local", workspacePath: root };
  control.setBinding(task.id, "p1", 0, binding, 0);
  const initial = reader.read("p1", "1");
  assert.equal(initial.tasks.find((row) => row.id === task.id).executionBinding.threadId, "executor");
  writer.updateTask(task.id, task.version, { title: task.title }, "source-editor", { ...binding, threadId: "source-editor" }, user);
  const after = reader.read("p1", "1");
  assert.equal(after.tasks.find((row) => row.id === task.id).executionBinding.threadId, "executor");
  const beforeKey = assessCandidate(task.id, after).judgmentKey;
  control.setBinding(task.id, "p1", 1, null, 1);
  control.setBinding(task.id, "p1", 2, binding, 2);
  assert.notEqual(assessCandidate(task.id, reader.read("p1", "1")).judgmentKey, beforeKey);
});
