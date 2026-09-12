import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  let output = "", errors = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  try {
    for (let i = 0; i < 100 && !output.includes("listening on") && !output.includes('"personal-ready"'); i++) await delay(50);
    assert.match(output, /listening on|personal-ready/, errors);
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
    const child=spawn(process.execPath,['server/index.mjs'],{stdio:['pipe','pipe','ignore']});
    console.log(JSON.stringify({pid:child.pid}));
    child.stdout.on('data', data=>process.stdout.write(data));
    setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root, env: { ...process.env, CODEX_TASKBOARD_PERSONAL_MODE: "1", CODEX_TASKBOARD_PARENT_PIPE: "1",
      CODEX_TASKBOARD_DATA_DIR: data, CODEX_TASKBOARD_HOST: "127.0.0.1", CODEX_TASKBOARD_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", pid;
  parent.stdout.on("data", (chunk) => { output += chunk; });
  const dead = new Promise((resolve) => parent.once("exit", resolve));
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    for (let i = 0; i < 100 && !output.includes('"personal-ready"'); i++) await delay(50);
    pid = JSON.parse(output.split("\n")[0]).pid;
    assert.match(output, /personal-ready/);
    parent.kill("SIGKILL");
    await dead;
    for (let i = 0; i < 100 && alive(); i++) await delay(50);
    assert.equal(alive(), false, "orphan personal service survived its parent");
    const replacement = net.createServer();
    await new Promise((resolve, reject) => { replacement.once("error", reject); replacement.listen(port, "127.0.0.1", resolve); });
    await new Promise((resolve) => replacement.close(resolve));
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
    stdio: ["pipe", "pipe", "ignore"] });
  let output = "", response = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let socket;
  try {
    for (let i = 0; i < 100 && !output.includes('"personal-ready"'); i++) await delay(50);
    assert.match(output, /personal-ready/);
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
