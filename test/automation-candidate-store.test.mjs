import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { CandidateStore } from "../server/automation-candidate-store.mjs";
const key = "a".repeat(64);
const request = (patch = {}) => ({ projectId: "p1", taskId: "t1", judgmentKey: key,
  authRev: 1, now: 1000, leaseMs: 1000, maxAttempts: 2, ...patch });
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "candidate-store-"));
  const file = path.join(dir, "candidates.sqlite");
  const stores = [];
  const open = () => { const store = new CandidateStore(file); stores.push(store); return store; };
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { open, file };
}

test("durable judgment verdict suppresses identical inputs after reopening", (t) => {
  const { open } = fixture(t);
  const store = open();
  const claimed = store.claim(request());
  assert.equal(claimed.status, "leased");
  assert.equal(claimed.authorizesDispatch, false);
  store.start(claimed.token, 1100);
  store.finish(claimed.token, { verdict: "rejected", receiptId: "r1", now: 1200 });
  store.close();
  const reopened = open();
  assert.equal(reopened.claim(request({ now: 1300, authRev: 2 })).status, "cached");
  assert.equal(reopened.claim(request({ judgmentKey: "b".repeat(64), now: 1300 })).status, "leased");
});

test("one unresolved attempt blocks duplicate and changed inputs across connections and projects", (t) => {
  const { open } = fixture(t);
  const one = open(), two = open();
  const claim = one.claim(request());
  assert.equal(two.claim(request()).status, "busy");
  assert.equal(two.claim(request({ projectId: "p2", judgmentKey: "b".repeat(64) })).status, "busy");
  assert.equal(one.get(claim.token).started, false);
});

test("expired unstarted lease is recoverable but a started unknown result never replays", (t) => {
  const { open } = fixture(t);
  const store = open();
  const first = store.claim(request());
  const replacement = store.claim(request({ now: 2000 }));
  assert.equal(replacement.status, "leased");
  assert.notEqual(replacement.token, first.token);
  assert.throws(() => store.start(first.token, 2000), /STALE_ATTEMPT/);
  store.start(replacement.token, 2100);
  store.close();
  const reopened = open();
  assert.equal(reopened.claim(request({ now: 3000, judgmentKey: "b".repeat(64) })).status, "unknown");
  assert.throws(() => reopened.finish(replacement.token, { verdict: "accepted", receiptId: "r2", now: 3100 }), /STALE_ATTEMPT/);
  assert.equal(reopened.get(replacement.token).state, "unknown");
});

test("definite retry is delayed and bounded; caller cannot enlarge persisted retry limit", (t) => {
  const { open } = fixture(t);
  const store = open();
  let claim = store.claim(request());
  store.start(claim.token, 1100);
  store.finish(claim.token, { verdict: "retryable", receiptId: "r1", now: 1200, retryAt: 1500 });
  assert.equal(store.claim(request({ now: 1300 })).status, "retry_wait");
  claim = store.claim(request({ now: 1500, maxAttempts: 9 }));
  assert.equal(claim.attempt, 2);
  store.start(claim.token, 1600);
  store.finish(claim.token, { verdict: "retryable", receiptId: "r2", now: 1700, retryAt: 1800 });
  assert.equal(store.claim(request({ now: 1800, maxAttempts: 9 })).status, "exhausted");
});

test("completion is fenced by token and lease and requires a started attempt", (t) => {
  const { open } = fixture(t);
  const store = open();
  const claim = store.claim(request());
  assert.throws(() => store.finish(claim.token, { verdict: "accepted", receiptId: "r", now: 1100 }), /NOT_STARTED/);
  store.start(claim.token, 1100);
  store.finish(claim.token, { verdict: "accepted", receiptId: "r", now: 1200 });
  assert.throws(() => store.finish(claim.token, { verdict: "rejected", receiptId: "r", now: 1300 }), /STALE_ATTEMPT/);
  assert.equal(store.claim(request({ now: 1400 })).verdict, "accepted");
});

test("unrecognized databases and invalid requests are rejected without dispatch", (t) => {
  const { open, file } = fixture(t);
  writeFileSync(file, "foreign contents", { mode: 0o600 });
  assert.throws(open);
  assert.equal(readFileSync(file, "utf8"), "foreign contents");
});

function child(source, args) {
  const process = spawn(globalThis.process.execPath, ["--input-type=module", "-e", source, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "", error = "";
  process.stdout.on("data", (chunk) => { output += chunk; });
  process.stderr.on("data", (chunk) => { error += chunk; });
  const exited = new Promise((resolve, reject) => {
    process.on("error", reject);
    process.on("exit", (code, signal) => resolve({ code, signal, output, error }));
  });
  return { process, exited };
}
const moduleUrl = new URL("../server/automation-candidate-store.mjs", import.meta.url).href;

test("separate Node processes race for exactly one durable lease", async (t) => {
  const { open, file } = fixture(t);
  open().close();
  const source = `import { CandidateStore } from ${JSON.stringify(moduleUrl)};
    const store = new CandidateStore(process.argv[1]);
    console.log(JSON.stringify(store.claim(JSON.parse(process.argv[2])))); store.close();`;
  const children = Array.from({ length: 4 }, () => child(source, [file, JSON.stringify(request())]));
  t.after(() => { for (const child of children) if (child.process.exitCode === null) child.process.kill(); });
  const results = await Promise.all(children.map((child) => child.exited));
  for (const result of results) assert.equal(result.code, 0, result.error);
  const statuses = results.map((result) => JSON.parse(result.output).status).sort();
  assert.deepEqual(statuses, ["busy", "busy", "busy", "leased"]);
});

test("killed started worker stays unknown after restart and isolated database restore", async (t) => {
  const { open, file } = fixture(t);
  open().close();
  const source = `import { CandidateStore } from ${JSON.stringify(moduleUrl)};
    const store = new CandidateStore(process.argv[1]);
    const lease = store.claim(JSON.parse(process.argv[2])); store.start(lease.token, 1100);
    console.log(JSON.stringify(lease)); setInterval(() => {}, 1000);`;
  const worker = child(source, [file, JSON.stringify(request())]);
  t.after(() => { if (worker.process.exitCode === null) worker.process.kill(); });
  const token = await new Promise((resolve, reject) => {
    let text = "";
    const timeout = setTimeout(() => { worker.process.kill(); reject(new Error("worker start timeout")); }, 10000);
    worker.process.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.includes("\n")) { clearTimeout(timeout); resolve(JSON.parse(text.trim()).token); }
    });
    worker.process.on("error", (error) => { clearTimeout(timeout); reject(error); });
  });
  worker.process.kill("SIGKILL");
  await worker.exited;
  const reopened = open();
  assert.equal(reopened.claim(request({ now: 3000 })).status, "unknown");
  assert.equal(reopened.get(token).started, true);
  reopened.close();
  const backup = `${file}.restored`;
  copyFileSync(file, backup);
  const restored = new CandidateStore(backup);
  try { assert.equal(restored.claim(request({ now: 4000 })).status, "unknown"); }
  finally { restored.close(); }
});

test("clock reversal and malformed requests cannot acquire a lease", (t) => {
  const { open } = fixture(t);
  const store = open();
  store.claim(request());
  assert.throws(() => store.claim(request({ taskId: "t2", now: 999 })), /CLOCK_MOVED_BACKWARD/);
  for (const patch of [{ leaseMs: 0 }, { maxAttempts: 11 }, { authRev: 0 }, { judgmentKey: "bad" }, { now: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => store.claim(request(patch)), /Invalid claim/);
  }
});

test("unknown outcome blocks retries even after input changes", (t) => {
  const { open } = fixture(t);
  const store = open();
  const claim = store.claim(request());
  store.start(claim.token, 1100);
  store.markUnknown(claim.token, 1200);
  assert.equal(store.claim(request({ judgmentKey: "b".repeat(64), now: 1300 })).status, "unknown");
});
