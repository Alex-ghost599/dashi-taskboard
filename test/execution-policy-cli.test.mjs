import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const script = fileURLToPath(new URL("../scripts/execution-policy.mjs", import.meta.url));
function setup(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "policy-cli-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace"); mkdirSync(workspace);
  const store = path.join(root, "control.sqlite"); const file = path.join(root, "policy.json");
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, projectId: "demo", hostId: "local", workspacePath: workspace,
    enabled: true, taskCategories: ["docs"], allowedTools: ["read_file"], maxCallsPerRun: 2,
    maxConcurrent: 1, maxDispatchesPerDay: 5, expiresAt: "2099-01-01T00:00:00.000Z" }));
  const args = (command, extra = []) => [script, command, "--store", store, "--project", "demo", ...extra];
  const run = (command, extra) => {
    const result = spawnSync(process.execPath, args(command, extra), { encoding: "utf8" });
    return { status: result.status, body: JSON.parse(result.stdout || result.stderr) };
  };
  return { root, store, file, workspace, args, run };
}

test("operator CLI persists a grant across processes, and read-only get never creates a store", (t) => {
  const f = setup(t);
  assert.deepEqual(f.run("get"), { status: 0, body: { policy: null } });
  assert.equal(existsSync(f.store), false);
  const saved = f.run("replace", ["--expected-revision", "0", "--file", f.file]);
  assert.equal(saved.status, 0); assert.equal(saved.body.revision, 1);
  assert.equal(f.run("get").body.policy.enabled, true);
  if (process.platform !== "win32") assert.equal(statSync(f.store).mode & 0o777, 0o600);
});

test("stale writes cannot overwrite pause and pause does not claim to stop running tasks", (t) => {
  const f = setup(t); assert.equal(f.run("replace", ["--expected-revision", "0", "--file", f.file]).status, 0);
  const paused = f.run("pause", ["--expected-revision", "1"]);
  assert.equal(paused.body.revision, 2); assert.equal(paused.body.runningTasksStopped, false);
  assert.equal(f.run("replace", ["--expected-revision", "1", "--file", f.file]).status, 1);
  assert.equal(f.run("get").body.policy.enabled, false);
});

test("concurrent operators with the same revision produce exactly one accepted update", async (t) => {
  const f = setup(t); assert.equal(f.run("replace", ["--expected-revision", "0", "--file", f.file]).status, 0);
  const update = () => new Promise((resolve) => {
    const child = spawn(process.execPath, f.args("replace", ["--expected-revision", "1", "--file", f.file]), { stdio: "ignore" });
    child.on("exit", resolve);
  });
  assert.deepEqual((await Promise.all([update(), update()])).sort(), [0, 1]);
  assert.equal(f.run("get").body.revision, 2);
});

test("bad schema, mismatched project and foreign files are rejected without overwriting", (t) => {
  const f = setup(t); const policy = JSON.parse(readFileSync(f.file));
  for (const patch of [{ modelApproval: true }, { projectId: "other" }, { maxConcurrent: 0 }, { enabled: "true" }]) {
    writeFileSync(f.file, JSON.stringify({ ...policy, ...patch }));
    assert.equal(f.run("replace", ["--expected-revision", "0", "--file", f.file]).status, 1);
  }
  const foreign = path.join(f.root, "foreign.sqlite"); writeFileSync(foreign, "unrelated data", { mode: 0o600 });
  const before = readFileSync(foreign);
  const r = spawnSync(process.execPath, [script, "get", "--store", foreign, "--project", "demo"]);
  assert.equal(r.status, 1); assert.deepEqual(readFileSync(foreign), before);
});

test("pause remains possible after the workspace is removed", (t) => {
  const f = setup(t); assert.equal(f.run("replace", ["--expected-revision", "0", "--file", f.file]).status, 0);
  rmSync(f.workspace, { recursive: true });
  assert.equal(f.run("pause", ["--expected-revision", "1"]).body.policy.enabled, false);
});

test("preview reads live policy revision and never mutates it or launches work", (t) => {
  const f = setup(t); assert.equal(f.run("replace", ["--expected-revision", "0", "--file", f.file]).status, 0);
  const request = path.join(f.root, "request.json"); writeFileSync(request, JSON.stringify({ projectId: "demo", hostId: "local", workspacePath: f.workspace, taskCategory: "docs", tools: ["read_file"], maxCalls: 1 }));
  const before = readFileSync(f.store);
  const result = f.run("preview", ["--expected-revision", "1", "--file", request]);
  assert.equal(result.body.decision, "eligible_for_admission"); assert.equal(result.body.authorizesDispatch, false);
  assert.deepEqual(readFileSync(f.store), before);
  f.run("pause", ["--expected-revision", "1"]);
  assert.equal(f.run("preview", ["--expected-revision", "1", "--file", request]).body.reason, "STALE_POLICY");
});

test("a mistyped pause path never creates an empty control database", (t) => {
  const f = setup(t);
  assert.equal(f.run("pause", ["--expected-revision", "0"]).status, 1);
  assert.equal(existsSync(f.store), false);
});
