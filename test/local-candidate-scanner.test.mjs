import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalScanState } from "../server/local-scan-state.mjs";
import { LocalCandidateScanner } from "../server/local-candidate-scanner.mjs";

function fixture(t, reader) {
  const root = mkdtempSync(path.join(tmpdir(), "scan-loop-"));
  const state = new LocalScanState(path.join(root, "control.sqlite"));
  let now = 1000;
  state.configure("p1", 0, { armed: true, intervalMs: 10000, judgePolicyRev: "1" }, now);
  const scanner = new LocalCandidateScanner({ reader, state, clock: () => now });
  t.after(async () => { await scanner.stop(); state.close(); rmSync(root, { recursive: true, force: true }); });
  return { state, scanner, setTime: (value) => { now = value; } };
}
const empty = () => ({ projectIds: ["p1"], tasks: [], unresolvedTaskIds: [], judgePolicyRev: "1" });

test("empty queue stays armed and missed intervals are not replayed", async (t) => {
  let reads = 0;
  const f = fixture(t, { read() { reads++; return empty(); } });
  await f.scanner.tick();
  f.setTime(10999); await f.scanner.tick(); assert.equal(reads, 1);
  f.setTime(100000); await f.scanner.tick(); assert.equal(reads, 2);
  await f.scanner.tick(); assert.equal(reads, 2);
  assert.equal(f.state.listProjects()[0].armed, true);
  assert.deepEqual(f.state.listProjects()[0].report.candidates, []);
  assert.equal(f.state.listProjects()[0].report.authorizesDispatch, false);
});

test("overlapping ticks coalesce and pause during a read discards its report", async (t) => {
  let complete, reads = 0;
  const f = fixture(t, { read() { reads++; return new Promise((resolve) => { complete = resolve; }); } });
  const first = f.scanner.tick();
  assert.equal(f.scanner.tick(), first);
  f.setTime(1100);
  f.state.configure("p1", 1, { armed: false, intervalMs: 10000, judgePolicyRev: "1" }, 1100);
  complete(empty()); await first;
  assert.equal(reads, 1); assert.equal(f.state.listProjects()[0].report, null);
  await f.scanner.tick(); assert.equal(reads, 1);
});

test("snapshot errors keep scanning armed and do not persist private exception text", async (t) => {
  const f = fixture(t, { read() { throw new Error("PRIVATE_TASK_CONTENT"); } });
  await f.scanner.tick();
  const status = f.state.listProjects()[0];
  assert.equal(status.armed, true); assert.equal(status.report.status, "error");
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE_TASK_CONTENT/);
});

test("start is refused during stop and old loop cannot schedule after restart", async (t) => {
  let complete, reads = 0;
  const f = fixture(t, { read() { reads++; return new Promise((resolve) => { complete = resolve; }); } });
  f.scanner.start();
  const stopped = f.scanner.stop();
  assert.throws(() => f.scanner.start(), /SCAN_STOPPING/);
  complete(empty()); await stopped;
  assert.equal(f.scanner.running, false);
  assert.equal(f.scanner.timer, null);
  assert.equal(reads, 1);
  f.scanner.reader = { read: empty };
  f.scanner.start();
  await f.scanner.stop();
  assert.equal(f.scanner.running, false);
});

test("all-held tasks remain armed; changing one hold yields only that candidate", async (t) => {
  const tasks = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`, projectId: "p1", status: "todo", archived: false,
    title: "Synthetic", description: "Synthetic bounded task details", labels: ["hold"], executionAgent: "codex", hold: true,
    executionForbidden: false, dependencyIds: [], executionBinding: null, instructions: [] }));
  const f = fixture(t, { read: () => ({ ...empty(), tasks }) });
  const began = performance.now();
  const cpu = process.cpuUsage();
  await f.scanner.tick();
  const elapsedMs = performance.now() - began;
  const used = process.cpuUsage(cpu);
  const status = f.state.listProjects()[0];
  assert.equal(status.armed, true);
  assert.equal(status.report.blocked.length, 1000);
  assert.equal(status.report.candidates.length, 0);
  t.diagnostic(JSON.stringify({ tasks: 1000, elapsedMs, cpuMs: (used.user + used.system) / 1000, rssBytes: process.memoryUsage().rss }));
  tasks[0].hold = false; tasks[0].labels = [];
  f.setTime(11000); await f.scanner.tick();
  assert.deepEqual(f.state.listProjects()[0].report.candidates.map((entry) => entry.taskId), ["t0"]);
});
