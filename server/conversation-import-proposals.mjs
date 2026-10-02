import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { JIRA_PROJECT_ID } from '../shared/domain.mjs';

const TTL = 5 * 60 * 1000;
const CAPACITY = 8;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowed = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const clone = value => structuredClone(value);

export class ConversationImportProposalError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = 'ConversationImportProposalError';
    this.code = code;
  }
}
const fail = (code, cause) => { throw new ConversationImportProposalError(code, cause ? { cause } : undefined); };

/** saveTask must synchronously commit its transaction and return {task, alreadyImported}. */
export function createConversationImportProposals({ readSource, extractText, saveTask, getProject, now = Date.now }) {
  const entries = new Map();
  const actorKeyValid = actorKey => {
    if (typeof actorKey !== 'string' || !actorKey || actorKey.length > 1024) fail('INVALID_ACTOR');
  };
  const checkAbort = signal => { if (signal?.aborted) fail('ABORTED', signal.reason); };
  const prune = () => {
    const time = now();
    for (const [id, entry] of entries) if (time >= entry.expiresAt) entries.delete(id);
  };
  const active = (id, entry, signal) => {
    checkAbort(signal);
    if (now() >= entry.expiresAt) {
      if (entries.get(id) === entry) entries.delete(id);
      fail('PROPOSAL_EXPIRED');
    }
    if (entries.get(id) !== entry) fail('PROPOSAL_NOT_FOUND');
  };
  const lookup = (id, actorKey) => {
    actorKeyValid(actorKey);
    const entry = entries.get(id);
    if (!entry) fail('PROPOSAL_NOT_FOUND');
    if (entry.actorKey !== actorKey) fail('ACTOR_MISMATCH');
    active(id, entry);
    return entry;
  };
  const projectValid = (project, id) => {
    if (!object(project) || project.id !== id || id === JIRA_PROJECT_ID || project.source === 'jira'
      || typeof project.workspacePath !== 'string' || !path.isAbsolute(project.workspacePath)
      || project.workspacePath.includes('\0')) fail('INVALID_PROJECT');
    return project;
  };
  const projectLookup = async (id, signal) => {
    try { return await getProject(id); }
    catch (cause) { checkAbort(signal); fail('PROJECT_LOOKUP_FAILED', cause); }
  };
  const sourceValid = source => allowed(source, ['scope', 'path', 'headerSha256', 'timestamp'])
    && ['sessions', 'archived_sessions'].includes(source.scope)
    && typeof source.path === 'string' && source.path.length > 0 && source.path.length <= 1024
    && !source.path.includes('\0') && !path.isAbsolute(source.path) && !source.path.split(/[\\/]/).includes('..')
    && typeof source.headerSha256 === 'string' && SHA256.test(source.headerSha256)
    && (source.timestamp === undefined || source.timestamp === null || (typeof source.timestamp === 'string' && source.timestamp.length <= 64));
  const read = async (selection, project, signal) => {
    let result;
    try { result = await readSource({ project, threadId: selection.threadId, sourceFile: clone(selection.sourceFile), signal }); }
    catch (cause) {
      checkAbort(signal);
      fail('SOURCE_READ_FAILED', cause);
    }
    checkAbort(signal);
    const evidence = result?.evidence;
    const bytes = result?.buffer;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 2 * 1024 * 1024
      || !allowed(evidence, ['projectId', 'threadId', 'workspacePath', 'scope', 'path', 'headerSha256', 'timestamp', 'inputSha256', 'byteLength'])
      || evidence.projectId !== selection.projectId || evidence.threadId !== selection.threadId
      || evidence.workspacePath !== path.resolve(project.workspacePath)
      || !sourceValid({ scope: evidence.scope, path: evidence.path, headerSha256: evidence.headerSha256, timestamp: evidence.timestamp })
      || evidence.scope !== selection.sourceFile.scope || evidence.path !== selection.sourceFile.path
      || evidence.headerSha256 !== selection.sourceFile.headerSha256
      || evidence.byteLength !== bytes.byteLength || evidence.inputSha256 !== createHash('sha256').update(bytes).digest('hex')) fail('SOURCE_CHANGED');
    return { buffer: bytes, evidence: clone(evidence) };
  };

  async function prepare(input, actorKey, { signal } = {}) {
    actorKeyValid(actorKey);
    checkAbort(signal);
    if (!allowed(input, ['projectId', 'threadId', 'sourceFile'])
      || typeof input.projectId !== 'string' || !input.projectId || input.projectId.length > 240
      || typeof input.threadId !== 'string' || !UUID.test(input.threadId) || !sourceValid(input.sourceFile)) fail('INVALID_INPUT');
    prune();
    if (entries.size >= CAPACITY) fail('PROPOSAL_CAPACITY');
    const selection = clone(input);
    const proposalId = randomUUID();
    // Reserve capacity before awaiting so concurrent preparations cannot exceed eight.
    const entry = { actorKey, selection, expiresAt: now() + TTL, state: 'preparing' };
    entries.set(proposalId, entry);
    try {
      const project = await projectLookup(selection.projectId, signal);
      active(proposalId, entry, signal);
      projectValid(project, selection.projectId);
      const source = await read(selection, project, signal);
      active(proposalId, entry, signal);
      let extracted;
      try { extracted = await extractText(source.buffer); }
      catch (cause) { checkAbort(signal); fail('EXTRACTION_FAILED', cause); }
      active(proposalId, entry, signal);
      if (!object(extracted) || extracted.inputSha256 !== source.evidence.inputSha256 || extracted.hashScope !== 'inputBytes'
        || !object(extracted.coverage) || !extracted.coverage.sessionMetaValidated || !Array.isArray(extracted.messages)
        || extracted.messages.length > 100 || extracted.messages.some(message => !object(message)
          || !Number.isSafeInteger(message.lineNumber) || message.lineNumber < 2 || typeof message.text !== 'string')
        || extracted.messages.reduce((total, message) => total + Buffer.byteLength(message.text, 'utf8'), 0) > 32 * 1024) fail('INVALID_EXTRACTION');
      const proposal = {
        proposalId, title: '会话用户原文待整理',
        description: extracted.messages.map(message => `来源用户原文（第 ${message.lineNumber} 行）\n${message.text}`).join('\n\n'),
        coverage: clone(extracted.coverage), evidence: source.evidence,
        status: 'unknown', executionBinding: null, authorizesDispatch: false,
        canSave: extracted.coverage.complete === true && extracted.coverage.truncated === false && extracted.messages.length > 0,
      };
      // Retain only bounded extracted text and evidence, never the source byte snapshot.
      entry.proposal = proposal;
      entry.state = 'ready';
      return clone(proposal);
    } catch (cause) {
      if (entries.get(proposalId) === entry) entries.delete(proposalId);
      throw cause;
    }
  }

  async function save(input, actorKey, { signal, actor } = {}) {
    checkAbort(signal);
    if (!allowed(input, ['proposalId', 'title', 'description']) || typeof input.proposalId !== 'string' || !UUID.test(input.proposalId)
      || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 240
      || typeof input.description !== 'string' || input.description.length > 100000) fail('INVALID_INPUT');
    if (!object(actor) || typeof actor.id !== 'string' || !actor.id || typeof actor.type !== 'string') fail('INVALID_ACTOR');
    const proposalId = input.proposalId;
    const entry = lookup(proposalId, actorKey);
    if (entry.state === 'saved') return { ...clone(entry.receipt), replayed: true };
    if (entry.state !== 'ready') fail('PROPOSAL_BUSY');
    if (!entry.proposal.canSave) fail('PROPOSAL_NOT_SAVEABLE');
    // Copy reviewed values before the first await; a caller cannot mutate a pending save.
    const reviewed = { projectId: entry.selection.projectId, title: input.title.trim(), description: input.description, actor: clone(actor) };
    entry.state = 'saving';
    try {
      const project = await projectLookup(entry.selection.projectId, signal);
      active(proposalId, entry, signal);
      projectValid(project, entry.selection.projectId);
      if (path.resolve(project.workspacePath) !== entry.proposal.evidence.workspacePath) fail('SOURCE_CHANGED');
      const source = await read(entry.selection, project, signal);
      active(proposalId, entry, signal);
      for (const field of ['projectId', 'threadId', 'workspacePath', 'scope', 'path', 'headerSha256', 'inputSha256', 'byteLength']) {
        if (source.evidence[field] !== entry.proposal.evidence[field]) fail('SOURCE_CHANGED');
      }
      // No await between the final cancellation check and the synchronous DB transaction.
      active(proposalId, entry, signal);
      let receipt;
      try { receipt = saveTask(reviewed, clone(entry.proposal.evidence)); }
      catch (cause) { fail('SAVE_FAILED', cause); }
      entry.receipt = clone(receipt);
      entry.state = 'saved';
      delete entry.proposal;
      return clone(entry.receipt);
    } catch (cause) {
      if (entries.get(proposalId) === entry) entry.state = 'ready';
      throw cause;
    }
  }

  function discard(proposalId, actorKey) {
    actorKeyValid(actorKey);
    const entry = entries.get(proposalId);
    if (!entry) return false;
    if (entry.actorKey !== actorKey) fail('ACTOR_MISMATCH');
    entries.delete(proposalId);
    return true;
  }
  return { prepare, save, discard, clear: () => entries.clear() };
}
