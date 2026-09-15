import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ObsReadonlyIndex } from "../server/obs-readonly-index.mjs";
const snapshot = (files = ["a.md"], text = "正文") => ({
  documents: files.map((file) => ({ path: file, markdown: `---\ntask_id: AGT-20260915-001\nagent: codex\nstatus: planned\nworkspace: /fixture\n---\n${text}\n` })),
  projects: [{ hostId: "local", projectId: "p1", workspacePath: "/fixture" }],
  scope: { from: "2026-09-15", through: "2026-09-15", statuses: ["planned"] },
});
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "obs-index-"));
  const filename = path.join(dir, "index.sqlite");
  const db = new ObsReadonlyIndex(filename, "/fixture-notes");
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, dir, filename };
}
test("index retains exact source versions and idempotently consumes an operation without authorizing writes", (t) => {
  const { db } = fixture(t);
  const input = { operationId: "op1", expectedRevision: 0, snapshot: snapshot() };
  const result = db.apply(input);
  assert.equal(result.revision, 1);
  assert.equal(result.authorizesSourceWrite, false);
  assert.equal(result.authorizesDispatch, false);
  assert.equal(db.apply(input).duplicate, true);
  assert.equal(db.list().revision, 1);
  assert.equal(db.list().items[0].state, "observed");
  assert.equal(db.readVersion(db.list().items[0].contentHash), input.snapshot.documents[0].markdown);
  assert.throws(() => db.apply({ ...input, snapshot: snapshot(["a.md"], "改动") }), /OPERATION_CONFLICT/);
});
test("CAS refuses stale writers and keeps both content versions after a valid edit", (t) => {
  const { db } = fixture(t);
  db.apply({ operationId: "a", expectedRevision: 0, snapshot: snapshot() });
  const old = db.list().items[0].contentHash;
  assert.throws(() => db.apply({ operationId: "b", expectedRevision: 0, snapshot: snapshot(["a.md"], "新") }), /STALE_REVISION/);
  db.apply({ operationId: "b", expectedRevision: 1, snapshot: snapshot(["a.md"], "新") });
  assert.match(db.readVersion(old), /正文/);
  assert.match(db.readVersion(db.list().items[0].contentHash), /新/);
});
test("unobserved paths are preserved; a new path with the same ID freezes both instead of guessing a move", (t) => {
  const { db } = fixture(t);
  db.apply({ operationId: "a", expectedRevision: 0, snapshot: snapshot() });
  db.apply({ operationId: "b", expectedRevision: 1, snapshot: snapshot([]) });
  assert.equal(db.list().items[0].state, "unobserved");
  db.apply({ operationId: "c", expectedRevision: 2, snapshot: snapshot(["renamed.md"]) });
  assert.equal(db.list().items.length, 2);
  assert.ok(db.list().items.every((item) => item.state === "conflict"));
});
test("invalid current Markdown retains historical ID and freezes the row, never silently restoring old data", (t) => {
  const { db } = fixture(t);
  db.apply({ operationId: "a", expectedRevision: 0, snapshot: snapshot() });
  const input = snapshot(); input.documents[0].markdown = "temporarily incomplete";
  db.apply({ operationId: "b", expectedRevision: 1, snapshot: input });
  assert.equal(db.list().items[0].taskId, "AGT-20260915-001");
  assert.equal(db.list().items[0].state, "blocked");
  assert.equal(db.list().items[0].reason, "INVALID_FRONTMATTER");
});
test("reopen and isolated database copy preserve revisions, source history and no execution authorization", (t) => {
  const { db, dir, filename } = fixture(t);
  db.apply({ operationId: "a", expectedRevision: 0, snapshot: snapshot() });
  const expected = db.list(); db.close();
  const copy = path.join(dir, "restored.sqlite"); copyFileSync(filename, copy);
  const restored = new ObsReadonlyIndex(copy, "/fixture-notes");
  try { assert.deepEqual(restored.list(), expected); } finally { restored.close(); }
  assert.throws(() => new ObsReadonlyIndex(filename, "/different-root"), /ROOT_MISMATCH/);
});
test("historical content conflict survives repeated scans, reopen and later content changes", (t) => {
  const { db, filename } = fixture(t);
  for (const [i, text] of ["A", "B", "A", "A"].entries()) {
    db.apply({ operationId: `scan-${i}`, expectedRevision: i, snapshot: snapshot(["a.md"], text) });
    if (i >= 2) assert.equal(db.list().items[0].reason, "HISTORICAL_CONTENT_REAPPEARED");
  }
  db.close();
  const reopened = new ObsReadonlyIndex(filename, "/fixture-notes");
  try {
    for (const [i, text] of ["A", "C"].entries()) {
      reopened.apply({ operationId: `after-${i}`, expectedRevision: 4 + i, snapshot: snapshot(["a.md"], text) });
      assert.equal(reopened.list().items[0].state, "blocked");
      assert.equal(reopened.list().items[0].reason, "HISTORICAL_CONTENT_REAPPEARED");
    }
  } finally { reopened.close(); }
});
test("identity replacement remains frozen when the original identity returns", (t) => {
  const { db } = fixture(t);
  db.apply({ operationId: "a", expectedRevision: 0, snapshot: snapshot() });
  const replacement = snapshot();
  replacement.documents[0].markdown = replacement.documents[0].markdown.replace("AGT-20260915-001", "AGT-20260915-002");
  db.apply({ operationId: "b", expectedRevision: 1, snapshot: replacement });
  db.apply({ operationId: "c", expectedRevision: 2, snapshot: snapshot() });
  assert.equal(db.list().items[0].reason, "SOURCE_ID_CHANGED");
  assert.equal(db.list().items[0].taskId, "AGT-20260915-001");
});
test("skipped other-agent bodies are not retained as source versions", (t) => {
  const { db } = fixture(t);
  const input = snapshot(); input.documents[0].markdown = input.documents[0].markdown.replace("agent: codex", "agent: hermes");
  db.apply({ operationId: "other", expectedRevision: 0, snapshot: input });
  assert.equal(db.list().items[0].state, "blocked");
  assert.equal(db.readVersion(db.list().items[0].contentHash), null);
});
test("exceeding the document cap rolls back all new observations, versions and the operation", (t) => {
  const { db } = fixture(t);
  db.apply({ operationId: "first", expectedRevision: 0, snapshot: snapshot(Array.from({ length: 1000 }, (_, i) => `${i}.md`)) });
  const before = db.list();
  const counts = () => db.db.prepare("SELECT (SELECT count(*) FROM versions) AS v,(SELECT count(*) FROM observations) AS o,(SELECT count(*) FROM operations) AS p").get();
  const previous = counts();
  assert.throws(() => db.apply({ operationId: "overflow", expectedRevision: 1, snapshot: snapshot(["new.md"], "new body") }), /INDEX_CAPACITY/);
  assert.deepEqual(db.list(), before);
  assert.deepEqual(counts(), previous);
});
test("independent processes compete on the same revision and only one commits", async (t) => {
  const { spawn } = await import("node:child_process");
  const { db, filename } = fixture(t);
  const moduleUrl = new URL("../server/obs-readonly-index.mjs", import.meta.url).href;
  const code = `import {ObsReadonlyIndex} from ${JSON.stringify(moduleUrl)};
    const db = new ObsReadonlyIndex(process.argv[1], '/fixture-notes');
    try { console.log(JSON.stringify(db.apply(JSON.parse(process.argv[2])))); }
    catch(e) { console.log(e.message); process.exitCode=2; } finally { db.close(); }`;
  const run = (operationId) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, filename,
      JSON.stringify({ operationId, expectedRevision: 0, snapshot: snapshot() })], { timeout: 5000, killSignal: "SIGKILL" });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all([run("writer-a"), run("writer-b")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [0, 2]);
  assert.match(results.find((r) => r.status === 2).stdout, /STALE_REVISION/);
  assert.equal(db.list().revision, 1);
});
test("CLI indexes an explicit synthetic manifest, reopens read-only and preserves source and database bytes", async (t) => {
  const { mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { db, dir } = fixture(t); db.close();
  const root = path.join(dir, "notes"); mkdirSync(root);
  const privateDir = path.join(dir, "private"); mkdirSync(privateDir, { mode: 0o700 });
  const input = snapshot(); const source = path.join(root, "a.md");
  writeFileSync(source, input.documents[0].markdown);
  const manifest = path.join(dir, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ root, files: ["a.md"], projects: input.projects, scope: input.scope }));
  const filename = path.join(privateDir, "index.sqlite");
  const cli = fileURLToPath(new URL("../scripts/obs-readonly-index.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  const ingest = run("ingest", "--database", filename, "--manifest", manifest, "--operation", "explicit-1", "--expected-revision", "0");
  assert.equal(ingest.status, 0, ingest.stderr);
  assert.equal(JSON.parse(ingest.stdout).authorizesImport, false);
  const before = readFileSync(filename);
  const listed = run("list", "--database", filename, "--source-root", realpathSync(root));
  assert.equal(listed.status, 0, listed.stderr);
  const result = JSON.parse(listed.stdout);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].state, "observed");
  assert.equal(result.items[0].taskId, "AGT-20260915-001");
  assert.equal(result.authorizesDispatch, false);
  assert.deepEqual(readFileSync(filename), before);
  assert.equal(readFileSync(source, "utf8"), input.documents[0].markdown);
  const wrong = run("list", "--database", filename, "--source-root", path.join(dir, "wrong"));
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /ROOT_MISMATCH/); assert.equal(wrong.stdout, "");
  const absent = path.join(privateDir, "absent.sqlite");
  assert.equal(run("list", "--database", absent, "--source-root", root).status, 1);
  assert.equal(existsSync(absent), false);
});
test("replacement identities remain reserved across batches and later edits", (t) => {
  const { db } = fixture(t);
  db.apply({ operationId: "a", expectedRevision: 0, snapshot: snapshot() });
  const second = snapshot(); second.documents[0].markdown = second.documents[0].markdown.replace("AGT-20260915-001", "AGT-20260915-002");
  db.apply({ operationId: "b", expectedRevision: 1, snapshot: second });
  db.apply({ operationId: "c", expectedRevision: 2, snapshot: snapshot() });
  second.documents[0].path = "b.md";
  db.apply({ operationId: "d", expectedRevision: 3, snapshot: second });
  assert.ok(db.list().items.every((item) => item.state === "conflict"));
  assert.equal(db.list().items[0].reason, "SOURCE_ID_CHANGED");
  assert.ok(db.list().items.every((item) => item.conflictReason === "DUPLICATE_TASK_ID_HISTORY"));
});
