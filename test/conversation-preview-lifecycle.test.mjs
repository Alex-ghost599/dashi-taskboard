import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createTaskboardServer } from "../server/app.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "conversation-lifecycle-"));
  const sessions = path.join(root, "sessions");
  const workspace = path.join(root, "workspace");
  await mkdir(sessions); await mkdir(workspace);
  for (let batch = 0; batch < 5; batch++) {
    await Promise.all(Array.from({ length: 60 }, (_, index) => writeFile(
      path.join(sessions, `${batch}-${index}.jsonl`),
      JSON.stringify({ type: "session_meta", payload: { id: randomUUID(), cwd: workspace } }) + "\n",
    )));
  }
  const app = createTaskboardServer({ dataDirectory: path.join(root, "data"), conversationSessionsRoot: sessions, conversationArchivedSessionsRoot: path.join(root, "archived_sessions") });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); } };
  t.after(async () => { await close(); await rm(root, { recursive: true, force: true }); });
  app.database.createProject({ id: "p1", name: "Synthetic", workspacePath: workspace });
  const address = await app.listen({ port: 0 });
  return { app, close, databasePath: app.options.databasePath, archive: path.join(root, "archived_sessions"), workspace, url: `http://127.0.0.1:${address.port}/api/local/conversation-import-preview?projectId=p1` };
}

test("overlapping HTTP previews reject extra work and release the slot afterwards", { timeout: 15000 }, async t => {
  const { app, url } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, async () => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.body.error?.code === "CONVERSATION_PREVIEW_BUSY").length, 3);
  const later = await fetch(url);
  assert.equal(later.status, 200);
  assert.equal((await later.json()).candidates.length, 300);
  assert.equal(app.database.listTasks({ projectId: "p1" }).length, 0);
});

test("disconnecting an active HTTP preview releases its slot without saving cards", { timeout: 15000 }, async t => {
  const { app, url } = await fixture(t);
  const entered = new Promise(resolve => app.server.once("request", resolve));
  const request = http.get(url);
  request.on("error", () => {}); // Client cancellation is expected below.
  t.after(() => request.destroy());
  await entered;
  const concurrent = await fetch(url);
  assert.equal(concurrent.status, 503);
  assert.equal((await concurrent.json()).error.code, "CONVERSATION_PREVIEW_BUSY");
  request.destroy();
  let response;
  for (let attempt = 0; attempt < 20; attempt++) {
    response = await fetch(url);
    if (response.status === 200) break;
    assert.equal((await response.json()).error.code, "CONVERSATION_PREVIEW_BUSY");
    await delay(10);
  }
  assert.equal(response.status, 200);
  assert.equal((await response.json()).candidates.length, 300);
  assert.equal(app.database.listTasks({ projectId: "p1" }).length, 0);
});


test("archive HTTP scope is explicit and stays in configured synthetic roots", { timeout: 15000 }, async t => {
  const { app, url, archive, workspace } = await fixture(t);
  assert.equal((await fetch(url + "&includeArchived=other")).status, 400);
  const missing = await fetch(url + "&includeArchived=true");
  assert.equal(missing.status, 200);
  const incomplete = await missing.json();
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.unavailableSources.length, 1);
  await mkdir(archive);
  await writeFile(path.join(archive, "one.jsonl"), JSON.stringify({ type: "session_meta", payload: { id: randomUUID(), cwd: workspace } }) + "\n");
  const active = await (await fetch(url)).json();
  assert.equal(active.candidates.length, 300);
  const all = await (await fetch(url + "&includeArchived=true")).json();
  assert.equal(all.candidates.length, 301);
  assert.equal(all.candidates.filter(candidate => candidate.sourceFiles.some(source => source.scope === "archived_sessions")).length, 1);
  assert.equal(app.database.listTasks({ projectId: "p1" }).length, 0);
});


test("server shutdown cancels an active preview and completes without saving cards", { timeout: 15000 }, async t => {
  const { app, close, databasePath, url } = await fixture(t);
  const entered = new Promise(resolve => app.server.once("request", resolve));
  const pending = fetch(url);
  await entered;
  assert.equal(app.database.listTasks({ projectId: "p1" }).length, 0);
  const stopped = close();
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "CONVERSATION_SOURCE_UNAVAILABLE");
  await stopped;
  assert.equal(app.server.listening, false);
  const persisted = new DatabaseSync(databasePath, { readOnly: true });
  try { assert.equal(persisted.prepare("SELECT count(*) AS count FROM tasks").get().count, 0); }
  finally { persisted.close(); }
});
