import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createConversationImportProposals } from '../server/conversation-import-proposals.mjs';
import { extractConversationUserText } from '../server/conversation-proposal-text.mjs';

const threadId = '11111111-1111-4111-8111-111111111111';
const actor = { type: 'user', id: 'synthetic-user', name: 'Synthetic' };
const key = 'user:synthetic-user';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const project = { id: 'p1', source: 'local', workspacePath: path.resolve('synthetic-project') };
  const header = JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: project.workspacePath } });
  const body = texts => Buffer.from(header + '\n' + texts.map(text => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })).join('\n') + '\n');
  const sourceFile = { scope: 'sessions', path: 'synthetic.jsonl', headerSha256: createHash('sha256').update(header).digest('hex') };
  const state = { project, bytes: body(['原用户文本', 'Do not infer completion']), reads: [], writes: [], clock: 1000 };
  const read = async input => {
    state.reads.push(input);
    return { buffer: state.bytes, evidence: { projectId: 'p1', threadId, workspacePath: project.workspacePath, ...sourceFile, timestamp: null, inputSha256: createHash('sha256').update(state.bytes).digest('hex'), byteLength: state.bytes.length } };
  };
  const manager = createConversationImportProposals({
    getProject: async () => state.project, readSource: read, extractText: extractConversationUserText,
    saveTask: (input, evidence) => { state.writes.push({ input, evidence }); return { task: { id: 'saved-card', ...input, status: 'backlog', executionBinding: null }, alreadyImported: false }; },
    now: () => state.clock, ...overrides,
  });
  // A client selection is separate from the server reader's own source metadata.
  const selection = { projectId: 'p1', threadId, sourceFile: { ...sourceFile } };
  const prepare = options => manager.prepare(selection, key, options);
  const save = (proposal, changes = {}, options = {}) => manager.save({ proposalId: proposal.proposalId, title: '人工整理标题', description: '人工整理描述', ...changes }, key, { actor, ...options });
  return { state, manager, selection, prepare, save, body, read };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => { assert.equal(error.code, code); return true; });

test('prepare presents raw user evidence, neutral status and editable defaults without saving', async () => {
  const f = fixture(); const p = await f.prepare();
  assert.match(p.proposalId, /^[a-f0-9-]{36}$/i);
  assert.ok(p.title.length > 0 && p.title.length <= 240);
  assert.ok(p.description.includes('用户原文') && p.description.includes('第 2 行') && p.description.includes('原用户文本'));
  assert.ok(p.description.indexOf('原用户文本') < p.description.indexOf('Do not infer completion'));
  assert.equal(p.canSave, true); assert.equal(p.status, 'unknown'); assert.equal(p.executionBinding, null); assert.equal(p.authorizesDispatch, false);
  assert.equal(p.coverage.complete, true); assert.equal(p.evidence.threadId, threadId);
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.reads[0].project, f.state.project);
});

test('save rereads source and sends only reviewed text, real actor and fixed evidence to synchronous saver', async () => {
  const f = fixture(); const p = await f.prepare(); const receipt = await f.save(p);
  assert.equal(receipt.task.id, 'saved-card'); assert.equal(receipt.alreadyImported, false);
  assert.equal(f.state.reads.length, 2); assert.equal(f.state.writes.length, 1);
  assert.deepEqual(f.state.writes[0].input, { projectId: 'p1', title: '人工整理标题', description: '人工整理描述', actor });
  assert.deepEqual(f.state.writes[0].evidence, p.evidence);
});

test('successful retry returns original receipt and cannot overwrite saved content or receipt', async () => {
  const f = fixture(); const p = await f.prepare(); const first = await f.save(p);
  first.task.title = 'caller mutation';
  const second = await f.save(p, { title: 'overwrite', description: 'overwrite' });
  assert.equal(first.replayed ?? false, false); assert.equal(second.replayed, true);
  assert.equal(second.task.title, '人工整理标题'); assert.equal(f.state.writes.length, 1); assert.equal(f.state.reads.length, 2);
});

test('duplicate database receipt is retained without claiming another creation', async () => {
  const f = fixture({ saveTask: () => ({ task: { id: 'existing' }, alreadyImported: true }) });
  const p = await f.prepare(); assert.deepEqual(await f.save(p), { task: { id: 'existing' }, alreadyImported: true });
});

test('another actor cannot save or discard a proposal, including after success', async () => {
  const f = fixture(); const p = await f.prepare();
  await rejectsCode(f.manager.save({ proposalId: p.proposalId, title: 'x', description: '' }, 'user:other', { actor }), 'ACTOR_MISMATCH');
  assert.throws(() => f.manager.discard(p.proposalId, 'user:other'), { code: 'ACTOR_MISMATCH' });
  await f.save(p);
  await rejectsCode(f.manager.save({ proposalId: p.proposalId, title: 'x', description: '' }, 'user:other', { actor }), 'ACTOR_MISMATCH');
  assert.equal(f.state.writes.length, 1);
});

test('strict prepare and save whitelists reject execution extras and client supplied actor', async () => {
  const f = fixture();
  for (const extra of [{ status: 'done' }, { actor }, { sourceFile: { ...f.selection.sourceFile, sessionsRoot: '/elsewhere' } }]) {
    await rejectsCode(f.manager.prepare({ ...f.selection, ...extra }, key), 'INVALID_INPUT');
  }
  await rejectsCode(f.manager.prepare(f.selection, ''), 'INVALID_ACTOR');
  const p = await f.prepare();
  for (const extra of [{ status: 'done' }, { executionBinding: {} }, { authorizesDispatch: true }, { actor }, { projectId: 'other' }]) {
    await rejectsCode(f.save(p, extra), 'INVALID_INPUT');
  }
  await rejectsCode(f.manager.save({ proposalId: p.proposalId, title: 'x', description: '' }, key), 'INVALID_ACTOR');
  await rejectsCode(f.save(p, { title: ' ' }), 'INVALID_INPUT');
  await rejectsCode(f.save(p, { title: 'x'.repeat(241) }), 'INVALID_INPUT');
  await rejectsCode(f.save(p, { description: 'x'.repeat(100001) }), 'INVALID_INPUT');
  assert.equal(f.state.writes.length, 0);
});

test('project must exist, be non Jira and have an absolute workspace', async () => {
  for (const project of [null, { id: 'p1', workspacePath: 'relative' }, { id: 'p1', workspacePath: path.resolve('synthetic'), source: 'jira' }, { id: 'other', workspacePath: path.resolve('synthetic') }]) {
    const f = fixture({ getProject: () => project }); await rejectsCode(f.prepare(), 'INVALID_PROJECT'); assert.equal(f.state.reads.length, 0);
  }
});

test('incomplete or empty evidence stays visible but cannot be saved', async () => {
  for (const extractText of [bytes => extractConversationUserText(bytes, { maxMessages: 0 }), bytes => ({ ...extractConversationUserText(bytes), messages: [] })]) {
    const f = fixture({ extractText }); const p = await f.prepare(); assert.equal(p.canSave, false);
    await rejectsCode(f.save(p), 'PROPOSAL_NOT_SAVEABLE'); assert.equal(f.state.writes.length, 0);
  }
});

test('expired proposals are deleted at five minutes and capacity becomes available', async () => {
  const f = fixture(); const p = await f.prepare();
  f.state.clock += 300000; await rejectsCode(f.save(p), 'PROPOSAL_EXPIRED');
  assert.equal(f.manager.discard(p.proposalId, key), false);
  assert.equal((await f.prepare()).canSave, true);
});

test('capacity eight includes in-flight preparation and rejects instead of evicting valid proposals', async () => {
  const gate = deferred(); const f = fixture({ readSource: async input => { await gate.promise; return f.read(input); } });
  const pending = Array.from({ length: 8 }, () => f.prepare());
  await rejectsCode(f.prepare(), 'PROPOSAL_CAPACITY'); gate.resolve();
  const proposals = await Promise.all(pending); assert.equal(new Set(proposals.map(p => p.proposalId)).size, 8);
  await rejectsCode(f.prepare(), 'PROPOSAL_CAPACITY');
  assert.equal(f.manager.discard(proposals[0].proposalId, key), true); assert.equal((await f.prepare()).canSave, true);
});

test('changed workspace, source identity fields or whole body hash prevents saving', async () => {
  for (const field of ['workspacePath', 'threadId', 'scope', 'path', 'headerSha256', 'inputSha256', 'projectId', 'byteLength']) {
    let calls = 0; const f = fixture({ readSource: async input => { const result = await f.read(input); if (++calls === 2) result.evidence[field] = field === 'byteLength' ? result.evidence[field] + 1 : 'changed'; return result; } });
    const p = await f.prepare(); await rejectsCode(f.save(p), 'SOURCE_CHANGED'); assert.equal(f.state.writes.length, 0);
  }
  const f = fixture(); const p = await f.prepare(); f.state.bytes = f.body(['new body']);
  await rejectsCode(f.save(p), 'SOURCE_CHANGED'); assert.equal(f.state.writes.length, 0);
  const g = fixture(); const q = await g.prepare(); g.state.project = { ...g.state.project, workspacePath: path.resolve('changed') };
  await rejectsCode(g.save(q), 'SOURCE_CHANGED'); assert.equal(g.state.reads.length, 1);
});

test('caller changes to preview evidence, selection and coverage cannot affect stored save evidence', async () => {
  const f = fixture(); const p = await f.prepare(); p.evidence.path = 'changed'; p.coverage.complete = false; f.selection.sourceFile.path = 'caller changed';
  await f.save(p); assert.equal(f.state.writes[0].evidence.path, 'synthetic.jsonl'); assert.equal(f.state.reads[1].sourceFile.path, 'synthetic.jsonl');
});

test('concurrent save of the same token is busy and never creates twice', async () => {
  const gate = deferred(); let calls = 0; const f = fixture({ readSource: async input => { if (++calls === 2) await gate.promise; return f.read(input); } });
  const p = await f.prepare(); const saving = f.save(p); await rejectsCode(f.save(p), 'PROPOSAL_BUSY'); gate.resolve();
  await saving; await f.save(p); assert.equal(f.state.writes.length, 1);
});

test('read or synchronous save failure retains cause and allows a safe explicit retry', async () => {
  const cause = new Error('synthetic read failure'); let fail = true;
  const f = fixture({ readSource: async input => { if (fail) throw cause; return f.read(input); } });
  await assert.rejects(f.prepare(), error => error.code === 'SOURCE_READ_FAILED' && error.cause === cause); fail = false;
  const p = await f.prepare(); await f.save(p);
  let attempts = 0; const g = fixture({ saveTask: () => { if (++attempts === 1) throw cause; return { task: { id: 'saved' }, alreadyImported: false }; } });
  const q = await g.prepare(); await assert.rejects(g.save(q), error => error.code === 'SAVE_FAILED' && error.cause === cause);
  assert.equal((await g.save(q)).task.id, 'saved'); assert.equal(attempts, 2);
});

test('cancellation before or after each awaited prepare step leaves no usable proposal', async () => {
  for (const phase of ['before', 'project', 'read', 'extract']) {
    const controller = new AbortController(); const f = fixture({
      getProject: async () => { if (phase === 'project') controller.abort(); return f.state.project; },
      readSource: async input => { const result = await f.read(input); if (phase === 'read') controller.abort(); return result; },
      extractText: async bytes => { const result = extractConversationUserText(bytes); if (phase === 'extract') controller.abort(); return result; },
    });
    if (phase === 'before') controller.abort(); await rejectsCode(f.prepare({ signal: controller.signal }), 'ABORTED');
    assert.equal(f.state.writes.length, 0); assert.equal((await f.prepare()).canSave, true);
  }
});

test('cancellation at save project or source await prevents the atomic write and permits retry', async () => {
  for (const phase of ['project', 'read']) {
    let saving = false; const controller = new AbortController(); const f = fixture({
      getProject: async () => { if (saving && phase === 'project') controller.abort(); return f.state.project; },
      readSource: async input => { const result = await f.read(input); if (saving && phase === 'read') controller.abort(); return result; },
    });
    const p = await f.prepare(); saving = true; await rejectsCode(f.save(p, {}, { signal: controller.signal }), 'ABORTED');
    assert.equal(f.state.writes.length, 0); saving = false; await f.save(p); assert.equal(f.state.writes.length, 1);
  }
});

test('clear or discard during save invalidates token before any write', async () => {
  for (const action of ['clear', 'discard', 'expire']) {
    const gate = deferred(); let calls = 0; const f = fixture({ readSource: async input => { if (++calls === 2) await gate.promise; return f.read(input); } });
    const p = await f.prepare(); const saving = f.save(p); await Promise.resolve(); await Promise.resolve();
    if (action === 'clear') f.manager.clear(); else if (action === 'discard') f.manager.discard(p.proposalId, key); else f.state.clock += 300000;
    gate.resolve(); await rejectsCode(saving, action === 'expire' ? 'PROPOSAL_EXPIRED' : 'PROPOSAL_NOT_FOUND'); assert.equal(f.state.writes.length, 0);
  }
});

test('unbounded or inconsistent extractor output cannot become a cached editable proposal', async () => {
  for (const change of [result => { result.messages[0].text = 'x'.repeat(32769); }, result => { result.coverage.sessionMetaValidated = false; }, result => { result.inputSha256 = '0'.repeat(64); }, result => { result.hashScope = 'coveredBytes'; }]) {
    const f = fixture({ extractText: bytes => { const result = extractConversationUserText(bytes); change(result); return result; } });
    await rejectsCode(f.prepare(), 'INVALID_EXTRACTION'); assert.equal(f.state.writes.length, 0);
  }
});

test('clear and expiry during preparation prevent returning an invalidated proposal', async () => {
  for (const action of ['clear', 'expire']) {
    const gate = deferred(); const entered = deferred(); const f = fixture({ readSource: async input => { entered.resolve(); await gate.promise; return f.read(input); } });
    const pending = f.prepare(); await entered.promise;
    if (action === 'clear') f.manager.clear(); else f.state.clock += 300000;
    gate.resolve(); await rejectsCode(pending, action === 'clear' ? 'PROPOSAL_NOT_FOUND' : 'PROPOSAL_EXPIRED');
    assert.equal((await f.prepare()).canSave, true);
  }
});

test('expiry releases all eight slots and clear removes successful receipts', async () => {
  const f = fixture(); const proposals = await Promise.all(Array.from({ length: 8 }, () => f.prepare()));
  await f.save(proposals[0]); f.state.clock += 300000;
  assert.equal((await f.prepare()).canSave, true);
  await rejectsCode(f.save(proposals[0]), 'PROPOSAL_NOT_FOUND');
  const p = await f.prepare(); await f.save(p); f.manager.clear(); await rejectsCode(f.save(p), 'PROPOSAL_NOT_FOUND');
});

test('project and extraction dependency failures retain causes without consuming capacity', async () => {
  const cause = new Error('synthetic failure');
  for (const [dependency, code] of [['getProject', 'PROJECT_LOOKUP_FAILED'], ['extractText', 'EXTRACTION_FAILED']]) {
    const f = fixture({ [dependency]: () => { throw cause; } });
    for (let i = 0; i < 9; i += 1) await assert.rejects(f.prepare(), error => error.code === code && error.cause === cause);
  }
});

test('a caller mutating a pending reviewed save cannot replace its title, description or actor', async () => {
  const gate = deferred(); const entered = deferred(); let reads = 0;
  const f = fixture({ readSource: async input => { if (++reads === 2) { entered.resolve(); await gate.promise; } return f.read(input); } });
  const p = await f.prepare(); const input = { proposalId: p.proposalId, title: 'reviewed', description: 'reviewed description' }; const currentActor = { ...actor };
  const saving = f.manager.save(input, key, { actor: currentActor }); await entered.promise;
  input.proposalId = '22222222-2222-4222-8222-222222222222'; input.title = 'replacement'; input.description = 'replacement'; currentActor.id = 'replacement';
  gate.resolve(); await saving; assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.writes[0].input.title, 'reviewed'); assert.equal(f.state.writes[0].input.description, 'reviewed description'); assert.deepEqual(f.state.writes[0].input.actor, actor);
});
