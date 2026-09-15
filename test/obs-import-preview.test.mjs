import test from "node:test";
import assert from "node:assert/strict";
import { previewObsImport } from "../shared/obs-import-preview.mjs";
const scope = { from: "2026-09-01", through: "2026-09-30", statuses: ["planned"] };
const projects = [{ hostId: "local", projectId: "p1", workspacePath: "/fixture/project" }];
const note = (path = "a.md", extra = "") => ({ path, markdown: `---\ntask_id: AGT-20260915-001\nagent: codex\nstatus: planned\nworkspace: /fixture/project\n${extra}---\n# 测试任务\n正文保留\n` });
const run = (documents, options = {}) => previewObsImport({ documents, projects, scope, existing: [], ...options });
test("explicit scope is mandatory; preview retains content and cannot authorize import or execution", () => {
  assert.throws(() => run([note()], { scope: undefined }), /INVALID_SCOPE/);
  const result = run([note()]);
  assert.equal(result.authorizesImport, false);
  assert.equal(result.authorizesDispatch, false);
  const row = result.rows[0];
  assert.equal(row.decision, "candidate");
  assert.equal(row.proposed.executionBinding, null);
  assert.equal(row.proposed.sourceStatus, "planned");
  assert.equal(row.proposed.body, "# 测试任务\n正文保留\n");
  assert.equal(row.proposed.projectBinding.projectId, "p1");
  assert.equal(row.proposed.bindingVerified, false);
  assert.equal(Object.hasOwn(row.proposed, "status"), false);
});
test("unknown source, other executor, missing or ambiguous projects are skipped", () => {
  assert.equal(run([{ ...note(), markdown: note().markdown.replace("agent: codex", "agent: hermes") }]).rows[0].reason, "SOURCE_NOT_CODEX");
  assert.equal(run([note("a.md", "executor_agent: hermes\n")]).rows[0].reason, "EXECUTOR_NOT_CODEX");
  assert.equal(run([note()], { projects: [] }).rows[0].reason, "PROJECT_UNKNOWN");
  assert.equal(run([note()], { projects: [...projects, { ...projects[0], hostId: "remote" }] }).rows[0].reason, "PROJECT_AMBIGUOUS");
});
test("duplicate IDs freeze all copies even when one is outside status scope", () => {
  const other = { ...note("b.md"), markdown: note("b.md").markdown.replace("status: planned", "status: done") };
  assert.deepEqual(run([note(), other]).rows.map((row) => row.reason), ["DUPLICATE_TASK_ID", "DUPLICATE_TASK_ID"]);
});
test("duplicate YAML keys, aliases and merge mappings cannot alter interpreted fields", () => {
  assert.equal(run([note("a.md", "agent: hermes\n")]).rows[0].reason, "INVALID_FRONTMATTER");
  assert.equal(run([note("a.md", "a: &x [one]\nb: *x\n")]).rows[0].reason, "INVALID_FRONTMATTER");
  assert.equal(run([note("a.md", "<<: {agent: hermes}\n")]).rows[0].reason, "INVALID_FRONTMATTER");
});
test("date range uses task ID date explicitly and never implies native todo", () => {
  assert.equal(run([note()], { scope: { ...scope, from: "2026-09-16" } }).rows[0].reason, "OUTSIDE_DATE_SCOPE");
  assert.equal(run([note()], { scope: { ...scope, statuses: ["done"] } }).rows[0].reason, "OUTSIDE_STATUS_SCOPE");
  assert.throws(() => run([note()], { scope: { ...scope, from: "2026-02-30" } }), /INVALID_SCOPE/);
});
test("stable ID detects moves, reports exact field differences and freezes duplicate existing IDs", () => {
  const before = run([note()]).rows[0].proposed;
  const existing = [{ ...before, sourcePath: "old.md", body: "旧正文" }];
  const row = run([note()], { existing }).rows[0];
  assert.equal(row.operation, "update");
  assert.deepEqual(row.changes.map((change) => change.field).sort(), ["body", "sourcePath"]);
  assert.equal(run([note()], { existing: [before, before] }).rows[0].reason, "DUPLICATE_EXISTING_ID");
  assert.equal(run([note()], { existing: [before] }).rows[0].operation, "unchanged");
});
test("binding/catalog conflicts are not reassigned; hints never match names or parents", () => {
  assert.equal(run([note("a.md", 'execution_binding: {hostId: remote, projectId: p1, workspacePath: /fixture/project, threadId: t1}\n')]).rows[0].reason, "BINDING_PROJECT_CONFLICT");
  assert.equal(run([note()], { projects: [{ ...projects[0], workspacePath: "/fixture" }] }).rows[0].reason, "PROJECT_UNKNOWN");
});
test("bounded input rejects oversized batches and malformed catalogs without partial candidates", () => {
  assert.throws(() => run(Array(1001).fill(note())), /INPUT_LIMIT/);
  assert.throws(() => run([note()], { projects: [{ projectId: "p1" }] }), /INVALID_CATALOG/);
  assert.equal(run([{ path: "x.md", markdown: "x".repeat(1024 * 1024 + 1) }]).rows[0].reason, "DOCUMENT_LIMIT");
});
