#!/usr/bin/env node
// Attach only. Starting/restarting Codex remains an explicit user/CLI operation.
import { spawn, spawnSync } from "node:child_process";
import { open, unlink, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { personalServiceCredentials } from "../shared/personal-service.mjs";
import { withoutTaskboardLauncherEnvironment } from "../shared/codex-environment.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]) || Number(args[1]) < 1024 || Number(args[1]) > 65535) {
  throw new Error("Usage: personal-cdp.mjs --port <existing loopback Codex CDP port>");
}
const listeners = spawnSync("/usr/sbin/lsof", ["-nP", `-iTCP:${args[1]}`, "-sTCP:LISTEN", "-Fpn"], { encoding: "utf8" });
const fields = listeners.stdout?.trim().split("\n") ?? [];
const addresses = fields.filter((line) => line.startsWith("n")).map((line) => line.slice(1));
const pids = [...new Set(fields.filter((line) => /^p\d+$/.test(line)).map((line) => line.slice(1)))];
if (listeners.status !== 0 || pids.length === 0 || addresses.length === 0
  || addresses.some((address) => address !== `127.0.0.1:${args[1]}` && address !== `[::1]:${args[1]}`)) {
  throw new Error("CDP must have verified owners and listen only on loopback");
}
const processes = new Map();
const table = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" });
for (const line of table.stdout?.split("\n") ?? []) {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (match) processes.set(match[1], { parent: match[2], executable: match[3] });
}
const codexOwners = pids.filter((pid) => processes.get(pid)?.executable === "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT");
const belongsToCodex = (pid) => {
  const visited = new Set();
  while (pid && !visited.has(pid)) {
    if (pid === codexOwners[0]) return true;
    visited.add(pid);
    pid = processes.get(pid)?.parent;
  }
  return false;
};
if (table.status !== 0 || codexOwners.length !== 1 || !pids.every(belongsToCodex)) {
  throw new Error("CDP listeners do not belong to one official Codex process family");
}
const data = path.join(os.homedir(), "Library/Application Support/Dashi Taskboard Personal");
const credentials = await personalServiceCredentials(data);
const lockPath = path.join(data, `personal-cdp-${args[1]}.lock`);
let lock;
try { lock = await open(lockPath, "wx", 0o600); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  const previous = JSON.parse(await readFile(lockPath, "utf8"));
  if (!Number.isInteger(previous.pid) || previous.pid <= 1) throw new Error("Invalid injector lock; inspect before recovery");
  try { process.kill(previous.pid, 0); throw new Error("An injector is already running; stop it before starting another"); }
  catch (check) { if (check.code !== "ESRCH") throw check; }
  await unlink(lockPath);
  lock = await open(lockPath, "wx", 0o600);
}
await lock.writeFile(JSON.stringify({ pid: process.pid, port: Number(args[1]), startedAt: new Date().toISOString() }));
await lock.close();
const installedPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const env = {
  ...withoutTaskboardLauncherEnvironment(process.env),
  CODEX_TASKBOARD_DATA_DIR: data,
  CODEX_TASKBOARD_PERSONAL_SERVICE: "1",
  CODEX_TASKBOARD_HOST: "127.0.0.1",
  CODEX_TASKBOARD_PORT: "47823",
  CODEX_TASKBOARD_VERSION: `${installedPackage.version}-personal`,
  CODEX_TASKBOARD_INSTANCE_TOKEN: credentials.token,
  CODEX_TASKBOARD_INSTANCE_SECRET: credentials.secret,
};
let child;
try {
  child = spawn(process.execPath, [fileURLToPath(new URL("./codex-injector.mjs", import.meta.url)), "--external-service", "--watch", "--attach-existing", "--open", ...args], { env, stdio: "inherit" });
  const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1)); });
  process.exitCode = code;
} finally { await unlink(lockPath); }
