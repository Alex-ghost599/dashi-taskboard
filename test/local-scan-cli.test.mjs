import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { TaskboardDatabase } from "../server/database.mjs";
import { LocalScanState } from "../server/local-scan-state.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cli = fileURLToPath(new URL("../scripts/local-candidate-scan.mjs", import.meta.url));

test("CLI observes newly added todo on its real ten-second scan without dispatch", { timeout: 20000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "scan-cli-"));
  const database = path.join(root, "taskboard.sqlite");
  const control = path.join(root, "control.sqlite");
  const writer = new TaskboardDatabase(database);
  writer.createProject({ id: "p1", name: "Synthetic scan", workspacePath: root });
  const config = spawnSync(process.execPath, [cli, "configure", "--state", control, "--project", "p1", "--if-revision", "0", "--armed", "true", "--interval-ms", "10000", "--judge-policy-rev", "1"], { encoding: "utf8" });
  assert.equal(config.status, 0, config.stderr);
  const state = new LocalScanState(control);
  const child = spawn(process.execPath, [cli, "run", "--state", control, "--database", database], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.resume();
  try {
    for (let i = 0; i < 100 && !state.listProjects()[0].report; i++) await delay(25);
    const initial = state.listProjects()[0];
    assert.equal(initial.report.status, "armed");
    assert.deepEqual(initial.report.candidates, []);
    const actor = { type: "user", id: "tester", name: "Tester", avatarUrl: null };
    const task = writer.createTask({ projectId: "p1", title: "Synthetic only", description: "", status: "todo", priority: "none", labels: [], actor,
      assignee: { ...actor, type: "agent", id: "codex-agent" }, threadId: null, developmentContext: null, startDate: null, dueDate: null, recurrence: null });
    for (let i = 0; i < 130 && state.listProjects()[0].report.candidates.length === 0; i++) await delay(100);
    const next = state.listProjects()[0];
    assert.equal(next.report.candidates[0].taskId, task.id);
    assert.ok(next.scannedAt - initial.scannedAt >= 10000);
    assert.equal(next.report.authorizesDispatch, false);
    assert.equal(writer.getTask(task.id).version, task.version);
    assert.match(output, /scan-started/);
    child.kill("SIGTERM");
    const [code, signal] = await exited;
    if (process.platform === "win32") assert.equal(signal, "SIGTERM");
    else assert.equal(code, 0);
    assert.equal(state.listProjects()[0].armed, true);
    // A new process reads the same persisted settings; pausing survives restart.
    const paused = spawnSync(process.execPath, [cli, "configure", "--state", control, "--project", "p1", "--if-revision", "1", "--armed", "false", "--interval-ms", "10000", "--judge-policy-rev", "1"], { encoding: "utf8" });
    assert.equal(paused.status, 0, paused.stderr);
    const restarted = spawn(process.execPath, [cli, "run", "--state", control, "--database", database], { stdio: ["ignore", "pipe", "pipe"] });
    const restartedExit = once(restarted, "exit");
    let started = "";
    restarted.stdout.on("data", (chunk) => { started += chunk; });
    restarted.stderr.resume();
    try {
      for (let i = 0; i < 100 && !started.includes("scan-started"); i++) await delay(25);
      assert.match(started, /scan-started/);
      await delay(1100);
      assert.equal(state.listProjects()[0].armed, false);
      assert.equal(state.listProjects()[0].report, null);
    } finally {
      restarted.kill("SIGTERM");
      await restartedExit;
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    state.close(); writer.close(); rmSync(root, { recursive: true, force: true });
  }
});
