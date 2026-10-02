import assert from 'node:assert/strict';
import { test } from 'node:test';
import fsPromises, { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createTaskboardServer } from '../server/app.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'conversation-proposal-lifecycle-'));
  const sessions = path.join(root, 'sessions'), workspace = path.join(root, 'workspace');
  await mkdir(sessions); await mkdir(workspace);
  const threadId = randomUUID(), file = path.join(sessions, 'source.jsonl');
  const bytes = Buffer.from([
    { type: 'session_meta', payload: { id: threadId, cwd: workspace } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Synthetic source user text; no dispatch.' }] } },
  ].map(JSON.stringify).join('\n') + '\n');
  await writeFile(file, bytes);
  const app = createTaskboardServer({ dataDirectory: path.join(root, 'data'), conversationSessionsRoot: sessions,
    conversationArchivedSessionsRoot: path.join(root, 'archived_sessions') });
  let closing;
  const cleanups = [];
  const close = () => closing ??= app.close();
  t.after(async () => { for (const cleanup of cleanups) cleanup(); await close(); await rm(root, { recursive: true, force: true }); });
  app.database.createProject({ id: 'p1', name: 'Synthetic', workspacePath: workspace });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  const preview = await (await fetch(base + '/api/local/conversation-import-preview?projectId=p1')).json();
  assert.equal(preview.candidates.length, 1);
  const selection = { projectId: 'p1', threadId, sourceFile: preview.candidates[0].sourceFiles[0] };
  const proposalUrl = base + '/api/local/conversation-import-proposal';
  const post = async (route = 'conversation-import-proposal', input = selection) => {
    const response = await fetch(base + '/api/local/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  };
  return { app, close, file: await realpath(file), bytes, selection, proposalUrl, post,
    beforeCleanup: callback => cleanups.push(callback), databasePath: app.options.databasePath };
}

// Delay genuine body I/O on this fixture only. Metadata reads and all bytes still use real fs.
function pauseBodyRead(t, fixture) {
  const entered = deferred(), release = deferred();
  const originalOpen = fsPromises.open;
  let paused = false;
  t.mock.method(fsPromises, 'open', async function (filename, ...args) {
    const handle = await originalOpen.call(this, filename, ...args);
    if (filename === fixture.file) {
      const originalRead = handle.read;
      t.mock.method(handle, 'read', async function (...readArgs) {
        if (!paused && typeof readArgs[3] === 'number') {
          paused = true;
          entered.resolve({ byteLength: readArgs[0].byteLength, position: readArgs[3] });
          await release.promise;
        }
        return originalRead.apply(this, readArgs);
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  fixture.beforeCleanup(() => release.resolve());
  t.after(() => { release.resolve(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { entered: entered.promise, release: () => release.resolve() };
}

function persistedTaskCount(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try { return database.prepare('SELECT count(*) AS count FROM tasks').get().count; }
  finally { database.close(); }
}

async function releasedProposal(post) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await post();
    if (result.status === 200) return result;
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'CONVERSATION_PREVIEW_BUSY');
    await delay(10);
  }
  assert.fail('Cancelled proposal did not release the source read slot');
}

test('an actual POST paused in body reading rejects concurrent work and releases its slot afterwards', { timeout: 15000 }, async t => {
  const f = await fixture(t), gate = pauseBodyRead(t, f);
  const first = f.post();
  const read = await gate.entered;
  assert.equal(read.position, 0); assert.equal(read.byteLength, f.bytes.length);
  const concurrent = await f.post();
  assert.equal(concurrent.status, 503); assert.equal(concurrent.body.error.code, 'CONVERSATION_PREVIEW_BUSY');
  assert.equal(f.app.database.listTasks({ projectId: 'p1' }).length, 0);
  gate.release();
  const prepared = await first;
  assert.equal(prepared.status, 200); assert.equal(prepared.body.canSave, true);
  assert.match(prepared.body.description, /Synthetic source user text/);
  assert.equal((await f.post()).status, 200);
  await f.close(); assert.equal(persistedTaskCount(f.databasePath), 0);
});

test('disconnecting a POST during body reading releases the slot without persisting a card', { timeout: 15000 }, async t => {
  const f = await fixture(t), gate = pauseBodyRead(t, f), serverResponseClosed = deferred();
  f.app.server.once('request', (_request, response) => response.once('close', () => serverResponseClosed.resolve()));
  const request = http.request(f.proposalUrl, { method: 'POST', headers: { 'content-type': 'application/json' } });
  request.on('error', error => { assert.equal(error.code, 'ECONNRESET'); });
  t.after(() => request.destroy());
  request.end(JSON.stringify(f.selection));
  await gate.entered;
  const concurrent = await f.post(); assert.equal(concurrent.status, 503);
  assert.equal(concurrent.body.error.code, 'CONVERSATION_PREVIEW_BUSY');
  request.destroy(); await serverResponseClosed.promise;
  gate.release();
  const fresh = await releasedProposal(f.post);
  assert.equal(fresh.body.canSave, true); assert.equal(fresh.body.authorizesDispatch, false);
  assert.equal(f.app.database.listTasks({ projectId: 'p1' }).length, 0);
  await f.close(); assert.equal(persistedTaskCount(f.databasePath), 0);
});

test('disconnecting a save POST during source reading leaves zero cards and an explicit retry saves once', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const prepared = await f.post();
  assert.equal(prepared.status, 200); assert.equal(prepared.body.canSave, true);
  const input = { proposalId: prepared.body.proposalId, title: 'Reviewed after cancellation', description: prepared.body.description };
  const gate = pauseBodyRead(t, f), serverResponseClosed = deferred();
  f.app.server.once('request', (_request, response) => response.once('close', () => serverResponseClosed.resolve(response.writableFinished)));
  const saveUrl = new URL('conversation-import-save', f.proposalUrl);
  const request = http.request(saveUrl, { method: 'POST', headers: { 'content-type': 'application/json' } });
  request.on('error', error => { assert.equal(error.code, 'ECONNRESET'); });
  f.beforeCleanup(() => request.destroy());
  request.end(JSON.stringify(input));
  const read = await gate.entered;
  assert.equal(read.position, 0); assert.equal(read.byteLength, f.bytes.length);
  assert.equal(persistedTaskCount(f.databasePath), 0);
  request.destroy();
  assert.equal(await serverResponseClosed.promise, false);
  gate.release();
  // A separate read-only preparation confirms the cancelled save released the HTTP slot.
  assert.equal((await releasedProposal(f.post)).status, 200);
  assert.equal(persistedTaskCount(f.databasePath), 0);
  const saved = await f.post('conversation-import-save', input);
  assert.equal(saved.status, 200); assert.equal(saved.body.replayed ?? false, false);
  assert.equal(saved.body.alreadyImported, false); assert.equal(saved.body.task.status, 'backlog');
  assert.equal(saved.body.task.title, input.title); assert.equal(saved.body.task.threadId, null);
  assert.equal(saved.body.task.threadBinding, null); assert.equal(saved.body.authorizesDispatch, false);
  const repeat = await f.post('conversation-import-save', { ...input, title: 'Retry cannot overwrite' });
  assert.equal(repeat.status, 200); assert.equal(repeat.body.replayed, true);
  assert.equal(repeat.body.task.id, saved.body.task.id); assert.equal(repeat.body.task.title, input.title);
  assert.equal(f.app.database.listConversationImports('p1').length, 1);
  await f.close(); assert.equal(persistedTaskCount(f.databasePath), 1);
});

test('service close cancels an active POST body read and leaves the persisted database empty', { timeout: 15000 }, async t => {
  const f = await fixture(t), gate = pauseBodyRead(t, f);
  const pending = f.post(); await gate.entered;
  const stopped = f.close(); gate.release();
  const result = await pending;
  assert.equal(result.status, 409); assert.equal(result.body.error.code, 'ABORTED');
  await stopped;
  assert.equal(f.app.server.listening, false);
  assert.equal(persistedTaskCount(f.databasePath), 0);
});

test('the real five-second POST deadline aborts reading and releases the slot without saving', { timeout: 15000 }, async t => {
  const f = await fixture(t), gate = pauseBodyRead(t, f);
  const originalTimeout = AbortSignal.timeout;
  let deadline;
  t.mock.method(AbortSignal, 'timeout', function (milliseconds) {
    const signal = originalTimeout.call(this, milliseconds);
    if (milliseconds === 5000) deadline = signal;
    return signal;
  });
  const started = performance.now(), pending = f.post();
  await gate.entered;
  assert.ok(deadline); assert.equal(deadline.aborted, false);
  await new Promise(resolve => deadline.addEventListener('abort', resolve, { once: true }));
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 4900, `Deadline fired too early: ${elapsed}ms`);
  gate.release();
  const result = await pending;
  assert.equal(result.status, 409); assert.equal(result.body.error.code, 'ABORTED');
  assert.equal((await f.post()).status, 200);
  assert.equal(f.app.database.listTasks({ projectId: 'p1' }).length, 0);
  await f.close(); assert.equal(persistedTaskCount(f.databasePath), 0);
});
