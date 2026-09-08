import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTaskboardServer } from "../server/app.mjs";

test("shutdown closes an idle accepted TCP connection within a bounded grace period", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "taskboard-shutdown-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  const { port } = await app.listen({ port: 0 });
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  await once(socket, "connect");
  let timer;
  const closing = app.close();
  try {
    await Promise.race([
      closing,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("shutdown left an accepted connection alive")), 4000); }),
    ]);
    assert.equal(app.server.listening, false);
    const replacement = net.createServer();
    await new Promise((resolve, reject) => {
      replacement.once("error", reject);
      replacement.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => replacement.close(resolve));
  } finally {
    clearTimeout(timer);
    socket.destroy();
    await closing;
    await rm(directory, { recursive: true, force: true });
  }
});

test("shutdown lets an accepted request complete during the grace period", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "taskboard-shutdown-drain-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  const { port } = await app.listen({ port: 0 });
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  await once(socket, "connect");
  let output = "";
  socket.setEncoding("utf8");
  socket.on("data", (data) => { output += data; });
  const closed = once(socket, "close");
  const accepted = once(app.server, "request");
  socket.write(`POST /api/projects HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{`);
  await accepted;
  const closing = app.close();
  try {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    socket.write("}");
    await Promise.all([closing, closed]);
    assert.match(output, /^HTTP\/1\.1 400 /);
  } finally {
    socket.destroy();
    await closing;
    await rm(directory, { recursive: true, force: true });
  }
});
