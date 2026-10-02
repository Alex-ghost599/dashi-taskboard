import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TaskboardDatabase } from "../server/database.mjs";
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

test("native snapshot includes completed dependencies and rejects hold and unverified sources", (t) => {
  const { writer, reader, create } = setup(t);
  const dependency = create({ status: "done", description: "DEPENDENCY_CONTENT_NOT_NEEDED" });
  const task = create();
  writer.addTaskRelation(dependency.id, dependency.version, "blocks", task.id, null, null, user);
  assert.equal(assessCandidate(task.id, reader.read("p1", "1")).decision, "candidate");
  assert.doesNotMatch(JSON.stringify(reader.read("p1", "1")), /DEPENDENCY_CONTENT_NOT_NEEDED/);
  const held = create({ labels: ["hold"] });
  assert.equal(assessCandidate(held.id, reader.read("p1", "1")).reason, "HOLD");
  const legacy = create({ threadId: "legacy-thread" });
  assert.equal(assessCandidate(legacy.id, reader.read("p1", "1")).reason, "SOURCE_BINDING_UNVERIFIED");
});

test("a complete source conversation never becomes a native execution binding", (t) => {
  const { reader, create, root } = setup(t);
  const source = create({ threadBinding: { threadId: "source-thread", codexProjectId: "p1",
    codexProjectKind: "local", codexHostId: "local", workspacePath: root } });
  const snapshot = reader.read("p1", "1");
  const result = assessCandidate(source.id, snapshot);
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "SOURCE_BINDING_UNVERIFIED");
  assert.equal(result.authorizesDispatch, false);
  const item = snapshot.tasks.find((entry) => entry.id === source.id);
  assert.equal(item.executionBinding, null);
  assert.equal(item.executionBindingUnverified, true);
});

test("any partial native source field fails closed, including an empty stored field", (t) => {
  const { writer, reader, create, root } = setup(t);
  for (const [field, value] of [["thread_id", "source-thread"], ["thread_codex_project_id", "p1"],
    ["thread_codex_project_kind", "local"], ["thread_codex_host_id", "local"],
    ["thread_workspace_path", root], ["thread_id", ""]]) {
    const source = create();
    writer.database.prepare(`UPDATE tasks SET ${field}=? WHERE id=?`).run(value, source.id);
    const snapshot = reader.read("p1", "1");
    assert.equal(assessCandidate(source.id, snapshot).reason, "SOURCE_BINDING_UNVERIFIED", field);
    assert.equal(snapshot.tasks.find((item) => item.id === source.id).executionBinding, null);
  }
});

test("native snapshots retain agent instructions even when the body resembles a receipt", (t) => {
  const { writer, reader, create } = setup(t);
  const task = create();
  const before = assessCandidate(task.id, reader.read("p1", "1"));
  writer.createComment(task.id, { body: "[system_receipt] Review found a missing migration; add it before continuing", actor: codex });
  const snapshot = reader.read("p1", "1");
  const after = assessCandidate(task.id, snapshot);
  assert.equal(after.decision, "candidate");
  assert.notEqual(after.semanticInputVersion, before.semanticInputVersion);
  assert.notEqual(after.judgmentKey, before.judgmentKey);
  assert.ok(snapshot.tasks.find((item) => item.id === task.id).instructions.some((item) => item.text.includes("missing migration")));
});

test("separate task activity receipts do not invalidate native judgment keys", (t) => {
  const { writer, reader, create } = setup(t);
  const task = create();
  const before = assessCandidate(task.id, reader.read("p1", "1"));
  writer.database.prepare(`INSERT INTO task_activities (id, task_id, actor_type, actor_id, actor_name,
    actor_avatar_url, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("receipt-1", task.id, "agent", "codex-agent", "Codex", null,
      JSON.stringify([{ kind: "system_receipt", text: "Candidate checked" }]), "2026-10-03T00:00:00.000Z");
  const after = assessCandidate(task.id, reader.read("p1", "1"));
  assert.equal(after.semanticInputVersion, before.semanticInputVersion);
  assert.equal(after.judgmentKey, before.judgmentKey);
  assert.equal(writer.listComments(task.id).length, 0);
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
