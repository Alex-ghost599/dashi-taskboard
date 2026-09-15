import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExecutionAdmissionStore } from "../server/execution-admission-store.mjs";

function fixture(t, limits = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "admission-"));
  const state = new ExecutionAdmissionStore(path.join(root, "policy.sqlite"));
  t.after(() => { state.close(); rmSync(root, { recursive: true, force: true }); });
  const policy = { schemaVersion: 1, projectId: "p1", hostId: "local", workspacePath: root, enabled: true,
    taskCategories: ["test"], allowedTools: ["read"], maxCallsPerRun: 1, maxConcurrent: 1,
    maxDispatchesPerDay: 2, expiresAt: "2099-01-01T00:00:00.000Z", ...limits };
  const record = state.replace("p1", 0, policy);
  const request = { projectId: "p1", hostId: "local", workspacePath: root, taskCategory: "test", tools: ["read"], maxCalls: 1 };
  const input = (taskId = "t1") => ({ taskId, semanticInputVersion: "a".repeat(64), request, policyRevision: record.revision });
  return { state, input, root, policy };
}

test("admission atomically enforces concurrency and pause before start", (t) => {
  const { state, input } = fixture(t);
  const first = state.reserve(input(), 1000);
  assert.equal(first.decision, "reserved"); assert.equal(first.authorizesDispatch, false);
  assert.equal(state.reserve(input("t2"), 1000).reason, "CONCURRENCY_LIMIT");
  state.pause("p1", 1);
  assert.equal(state.start(first.token, input(), 1100).reason, "STALE_POLICY");
  assert.equal(state.getAdmission(first.token).state, "cancelled");
});

test("unknown started work remains occupied and is never replayed after lease expiry", (t) => {
  const { state, input } = fixture(t);
  const reservation = state.reserve(input(), 1000);
  assert.equal(state.start(reservation.token, input(), 1100).decision, "started");
  state.markUnknown(reservation.token, 1200);
  assert.equal(state.reserve(input(), 100000).reason, "TASK_UNRESOLVED");
  assert.equal(state.reserve(input("t2"), 100000).reason, "CONCURRENCY_LIMIT");
});

test("completed attempts consume daily budget while expired reservations do not", (t) => {
  const { state, input } = fixture(t, { maxDispatchesPerDay: 1 });
  const expired = state.reserve(input(), 1000);
  const current = state.reserve(input("t2"), 31000);
  assert.equal(current.decision, "reserved");
  assert.equal(state.getAdmission(expired.token).state, "cancelled");
  assert.equal(state.start(current.token, input("t2"), 31001).decision, "started");
  assert.equal(state.finish(current.token, "receipt-1", 32000), true);
  assert.equal(state.reserve(input("t3"), 33000).reason, "DAILY_LIMIT");
  assert.equal(state.reserve(input("t3"), 86400000).decision, "reserved");
  assert.throws(() => state.reserve(input("t4"), 100), /CLOCK_ROLLBACK/);
});

test("start rechecks midnight budget and changed task input", (t) => {
  const { state, input } = fixture(t, { maxDispatchesPerDay: 1, maxConcurrent: 2 });
  const before = state.reserve(input(), 86399000);
  const next = state.reserve(input("t2"), 86400000);
  assert.equal(next.decision, "reserved");
  assert.equal(state.start(before.token, input(), 86400001).reason, "DAILY_LIMIT");
  assert.equal(state.start(next.token, { ...input("t2"), semanticInputVersion: "b".repeat(64) }, 86400002).reason, "INPUT_CHANGED");
});


test("completed semantic input stays deduplicated after reopen and policy revision changes", (t) => {
  const { state, input, root, policy } = fixture(t);
  const first = state.reserve(input(), 1000);
  state.start(first.token, input(), 1001);
  state.finish(first.token, "receipt-1", 1002);
  state.close();
  const reopened = new ExecutionAdmissionStore(path.join(root, "policy.sqlite"));
  try {
    reopened.replace("p1", 1, policy);
    const again = reopened.reserve({ ...input(), policyRevision: 2 }, 1100);
    assert.equal(again.decision, "completed");
    assert.equal(again.receiptId, "receipt-1");
    assert.equal(again.token, first.token);
    assert.equal(reopened.start(first.token, { ...input(), policyRevision: 2 }, 1200).reason, "RESERVATION_UNAVAILABLE");
  } finally { reopened.close(); }
});

test("four processes racing for one slot admit exactly one task", async (t) => {
  const { spawn } = await import("node:child_process");
  const { state, input, root } = fixture(t);
  const source = `import {ExecutionAdmissionStore} from ${JSON.stringify(new URL("../server/execution-admission-store.mjs", import.meta.url).href)};
    const state=new ExecutionAdmissionStore(process.argv[1]);
    try { console.log(JSON.stringify(state.reserve(JSON.parse(process.argv[2]),1000))); }
    finally { state.close(); }`;
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, path.join(root, "policy.sqlite"), JSON.stringify(input(`task-${i}`))], { timeout: 5000, killSignal: "SIGKILL" });
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => { try { assert.equal(code, 0, errors); resolve(JSON.parse(output)); } catch (error) { reject(error); } });
  })));
  assert.equal(results.filter((result) => result.decision === "reserved").length, 1);
  assert.equal(results.filter((result) => result.reason === "CONCURRENCY_LIMIT").length, 3);
  assert.equal(state.db.prepare("SELECT count(*) AS n FROM admissions WHERE state='reserved'").get().n, 1);
});

test("killed started owner remains occupied after reopening instead of being retried", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { state, input, root } = fixture(t);
  const source = `import {ExecutionAdmissionStore} from ${JSON.stringify(new URL("../server/execution-admission-store.mjs", import.meta.url).href)};
    const state=new ExecutionAdmissionStore(process.argv[1]);
    const input=JSON.parse(process.argv[2]);
    const reserved=state.reserve(input,1000); state.start(reserved.token,input,1100);
    process.stdout.write(JSON.stringify(reserved)+'\\n'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, path.join(root, "policy.sqlite"), JSON.stringify(input())], { timeout: 5000, killSignal: "SIGKILL" });
  const exited = once(child, "exit");
  child.stderr.resume();
  try {
    let output = "";
    const ready = new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("\n")) resolve(JSON.parse(output)); });
      child.once("error", reject);
      child.once("exit", () => reject(new Error("child exited before ready")));
    });
    const reservation = await ready;
    child.kill("SIGKILL"); await exited;
    state.close();
    const reopened = new ExecutionAdmissionStore(path.join(root, "policy.sqlite"));
    try {
      assert.equal(reopened.getAdmission(reservation.token).state, "started");
      assert.equal(reopened.reserve(input(), 100000).reason, "TASK_UNRESOLVED");
      assert.equal(reopened.reserve(input("t2"), 100000).reason, "CONCURRENCY_LIMIT");
    } finally { reopened.close(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
});

test("pause committed by another process prevents an existing reservation from starting", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { state, input, root } = fixture(t);
  const first = state.reserve(input(), 1000);
  const source = `import {ExecutionPolicyStore} from ${JSON.stringify(new URL("../server/execution-policy-store.mjs", import.meta.url).href)};
    const state=new ExecutionPolicyStore(process.argv[1]);
    try { state.pause('p1',1); } finally { state.close(); }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, path.join(root, "policy.sqlite")], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state.start(first.token, input(), 1100).reason, "STALE_POLICY");
  assert.equal(state.getAdmission(first.token).state, "cancelled");
});

test("schema upgrade preserves existing policy history and isolated backup retains terminal receipts", async (t) => {
  const { ExecutionPolicyStore } = await import("../server/execution-policy-store.mjs");
  const { copyFileSync } = await import("node:fs");
  const { state, root, input, policy } = fixture(t);
  const legacyPath = path.join(root, "legacy.sqlite");
  const legacy = new ExecutionPolicyStore(legacyPath);
  legacy.replace("p1", 0, policy); legacy.pause("p1", 1); legacy.close();
  const upgraded = new ExecutionAdmissionStore(legacyPath);
  try {
    assert.equal(upgraded.get("p1").revision, 2);
    assert.equal(upgraded.get("p1").policy.enabled, false);
    assert.equal(upgraded.db.prepare("SELECT count(*) AS n FROM policy_revisions").get().n, 2);
  } finally { upgraded.close(); }
  const first = state.reserve(input(), 1000);
  state.start(first.token, input(), 1100); state.finish(first.token, "receipt-restored", 1200); state.close();
  const restoredPath = path.join(root, "restored.sqlite");
  copyFileSync(path.join(root, "policy.sqlite"), restoredPath);
  const restored = new ExecutionAdmissionStore(restoredPath);
  try { assert.equal(restored.reserve(input(), 1300).receiptId, "receipt-restored"); }
  finally { restored.close(); }
});
