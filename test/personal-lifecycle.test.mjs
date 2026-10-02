import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForServiceReady(child, { timeoutMs = 20_000 } = {}) {
  // Startup allowance is independent of the three/six-second shutdown assertions.
  return new Promise((resolve, reject) => {
    let output = "", errors = "", pending = "";
    const diagnostic = (message, cause) => new Error(
      `${message}; stderr: ${errors || "<empty>"}; stdout: ${output || "<empty>"}`,
      cause ? { cause } : undefined,
    );
    const finish = (error, ready) => {
      clearTimeout(timer);
      child.stdout.off("data", onOutput);
      child.stderr?.off("data", onErrors);
      child.off("error", onError);
      child.off("close", onClose);
      if (error) reject(error); else resolve({ ready, output, errors });
    };
    const onOutput = (chunk) => {
      output = (output + chunk).slice(-8192);
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event?.event !== "personal-ready") continue;
        if (!Number.isInteger(event.port) || event.port < 1 || event.port > 65535) {
          finish(diagnostic("invalid personal-ready port"));
        } else {
          finish(null, event);
        }
        return;
      }
      pending = pending.slice(-8192);
    };
    const onErrors = (chunk) => { errors = (errors + chunk).slice(-8192); };
    const onError = (error) => finish(diagnostic("personal service spawn error", error));
    // close follows stream drainage, preserving stderr from an early exit.
    const onClose = (code, signal) => finish(diagnostic(
      `personal service exited before readiness (exit code ${code}, signal ${signal ?? "none"})`,
    ));
    const timer = setTimeout(() => finish(diagnostic(
      `personal service readiness timeout after ${timeoutMs}ms`,
    )), timeoutMs);
    child.stdout.on("data", onOutput);
    child.stderr?.on("data", onErrors);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

async function withStartupFixture(script, check, executable = process.execPath) {
  const child = spawn(executable, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    await check(child);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
}

function startupEvents() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

test("startup waiter accepts delayed readiness after the old five-second polling window", async () => {
  await withStartupFixture(`setTimeout(() => {
    process.stdout.write('{"event":"personal-');
    setTimeout(() => console.log('ready","port":12345}'), 25);
  }, 5200); setInterval(() => {}, 1000);`, async (child) => {
    const result = await waitForServiceReady(child);
    assert.equal(result.ready.port, 12345);
  });
});

test("startup waiter reports early exit code and stderr without waiting for the deadline", async () => {
  const child = startupEvents();
  const waiting = waitForServiceReady(child, { timeoutMs: 10_000 });
  child.stderr.write("synthetic startup failed");
  child.emit("close", 7, null);
  await assert.rejects(waiting, (error) => {
    assert.match(error.message, /exit.*7/);
    assert.match(error.message, /synthetic startup failed/);
    return true;
  });
});

test("startup waiter reports spawn error and preserves the cause", async () => {
  await withStartupFixture('', async (child) => {
    await assert.rejects(waitForServiceReady(child, { timeoutMs: 10_000 }), (error) => {
      assert.equal(error.cause?.code, "ENOENT");
      return true;
    });
  }, `${process.execPath}-taskboard-missing`);
});

test("startup waiter bounds a child that never emits readiness and retains diagnostics", { timeout: 2000 }, async () => {
  const child = startupEvents();
  const waiting = waitForServiceReady(child, { timeoutMs: 50 });
  child.stderr.write("synthetic never ready");
  await assert.rejects(waiting, (error) => {
    assert.match(error.message, /readiness.*timeout/);
    assert.match(error.message, /synthetic never ready/);
    return true;
  });
});

async function assertPortReleased(port, timeoutMs = 3000) {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const replacement = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        replacement.once("error", reject);
        replacement.listen(port, "127.0.0.1", resolve);
      });
      await new Promise((resolve) => replacement.close(resolve));
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || performance.now() >= deadline) throw error;
      await delay(50);
    }
  }
}

test("port release check fails within its deadline while the same port remains occupied", async () => {
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const port = occupied.address().port;
  try {
    await assert.rejects(assertPortReleased(port, 100), { code: "EADDRINUSE" });
    assert.equal(occupied.listening, true);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
  await assertPortReleased(port);
});


test("personal owned service exits when its parent pipe closes and releases its port", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "personal-parent-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: { ...process.env, CODEX_TASKBOARD_PERSONAL_MODE: "1", CODEX_TASKBOARD_PARENT_PIPE: "1",
      CODEX_TASKBOARD_DATA_DIR: data, CODEX_TASKBOARD_HOST: "127.0.0.1", CODEX_TASKBOARD_PORT: String(port) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  try {
    await waitForServiceReady(child);
    child.stdin.end();
    const result = await Promise.race([exited, delay(3000).then(() => null)]);
    assert.notEqual(result, null, "personal service remained alive after its owning pipe closed");
    assert.equal(result.code, 0, errors);
    const replacement = net.createServer();
    await new Promise((resolve, reject) => { replacement.once("error", reject); replacement.listen(port, "127.0.0.1", resolve); });
    await new Promise((resolve) => replacement.close(resolve));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    await rm(data, { recursive: true, force: true });
  }
});

test("SIGKILL of the spawning parent closes the owned pipe and releases its service port", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "personal-parent-kill-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const script = `import {spawn} from 'node:child_process';
    const child=spawn(process.execPath,['server/index.mjs'],{stdio:['pipe','pipe','pipe']});
    console.log(JSON.stringify({pid:child.pid}));
    child.stdout.on('data', data=>process.stdout.write(data));
    child.stderr.on('data', data=>process.stderr.write(data));
    child.once('error', error=>{console.error(error);process.exit(1);});
    child.once('exit', (code,signal)=>{console.error('owned service exit',code,signal);process.exit(code??1);});
    setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root, env: { ...process.env, CODEX_TASKBOARD_PERSONAL_MODE: "1", CODEX_TASKBOARD_PARENT_PIPE: "1",
      CODEX_TASKBOARD_DATA_DIR: data, CODEX_TASKBOARD_HOST: "127.0.0.1", CODEX_TASKBOARD_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", pid;
  parent.stdout.on("data", (chunk) => {
    output += chunk;
    if (!pid && output.includes("\n")) {
      const announced = JSON.parse(output.split("\n")[0]).pid;
      if (Number.isInteger(announced) && announced > 0) pid = announced;
    }
  });
  const dead = new Promise((resolve) => parent.once("close", resolve));
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    await waitForServiceReady(parent);
    pid = JSON.parse(output.split("\n")[0]).pid;
    assert.match(output, /personal-ready/);
    const ready = output.split("\n").filter(Boolean).map((line) => JSON.parse(line))
      .find((event) => event.event === "personal-ready");
    assert.equal(ready.port, port, "service must bind the requested port without fallback");
    parent.kill("SIGKILL");
    await dead;
    for (let i = 0; i < 100 && alive(); i++) await delay(50);
    assert.equal(alive(), false, "orphan personal service survived its parent");
    // Process exit and OS socket release are separately bounded observations.
    await assertPortReleased(ready.port);
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
    await dead;
    if (pid && alive()) process.kill(pid, "SIGKILL");
    await rm(data, { recursive: true, force: true });
  }
});

for (const order of ["signal-first", "eof-first"]) test(`${order}: owner EOF and SIGTERM share the drain of an accepted request`, async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "personal-drain-signals-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["server/index.mjs"], { cwd: root,
    env: { ...process.env, CODEX_TASKBOARD_PERSONAL_MODE: "1", CODEX_TASKBOARD_PARENT_PIPE: "1",
      CODEX_TASKBOARD_DATA_DIR: data, CODEX_TASKBOARD_HOST: "127.0.0.1", CODEX_TASKBOARD_PORT: String(port) },
    stdio: ["pipe", "pipe", "pipe"] });
  let response = "";
  const exited = new Promise((resolve) => child.once("close", resolve));
  let socket;
  try {
    await waitForServiceReady(child);
    const { token } = JSON.parse(await readFile(path.join(data, "personal-service.json"), "utf8"));
    // Expect gives a real receipt before finishing an authenticated POST body.
    socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    socket.on("data", (chunk) => { response += chunk; });
    socket.write(`POST /${token}/api/projects HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nExpect: 100-continue\r\nContent-Length: 2\r\nConnection: close\r\n\r\n`);
    for (let i = 0; i < 100 && !response.includes("100 Continue"); i++) await delay(10);
    assert.match(response, /100 Continue/);
    if (order === "signal-first") child.kill("SIGTERM"); else child.stdin.end();
    await delay(100);
    if (order === "signal-first") child.stdin.end(); else child.kill("SIGTERM");
    await delay(200);
    assert.equal(child.exitCode, null, "second close request bypassed the active drain");
    socket.end("{}");
    await Promise.race([exited, delay(6000).then(() => { throw new Error("drain timeout"); })]);
  } finally {
    socket?.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    await rm(data, { recursive: true, force: true });
  }
});
