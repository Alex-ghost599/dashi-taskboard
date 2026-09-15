import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupScheduledPause } from '../server/scheduled-pause-backup.mjs';

const snapshot = { id: 'fixture', projectId: 'project', prompt: 'private original', status: 'ACTIVE', rrule: 'FREQ=DAILY' };
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pause-backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'backups');
}
test('backup preserves the complete snapshot and deduplicates exact bytes', t => {
  const directory = fixture(t);
  const first = backupScheduledPause(directory, snapshot);
  assert.deepEqual(JSON.parse(readFileSync(first.path, 'utf8')), snapshot);
  assert.deepEqual(backupScheduledPause(directory, snapshot), first);
  assert.equal(first.authorizesDispatch, false);
});
test('existing corrupted snapshot is rejected without overwrite', t => {
  const directory = fixture(t);
  const first = backupScheduledPause(directory, snapshot);
  writeFileSync(first.path, 'corrupt');
  assert.throws(() => backupScheduledPause(directory, snapshot), /BACKUP_CONTENT_MISMATCH/);
  assert.equal(readFileSync(first.path, 'utf8'), 'corrupt');
});
test('snapshot capacity is bounded before any write', t => {
  const directory = fixture(t);
  assert.throws(() => backupScheduledPause(directory, { ...snapshot, prompt: 'x'.repeat(1024 * 1024) }), /BACKUP_TOO_LARGE/);
});

test('a linked backup file is refused without changing its target', async t => {
  const { symlinkSync, unlinkSync } = await import('node:fs');
  const directory = fixture(t);
  const first = backupScheduledPause(directory, snapshot);
  const target = path.join(path.dirname(directory), 'unrelated');
  writeFileSync(target, 'keep');
  unlinkSync(first.path);
  symlinkSync(target, first.path);
  assert.throws(() => backupScheduledPause(directory, snapshot), /BACKUP_INVALID_FILE/);
  assert.equal(readFileSync(target, 'utf8'), 'keep');
});
test('shared backup permissions are refused on POSIX', { skip: process.platform === 'win32' }, async t => {
  const { chmodSync } = await import('node:fs');
  const directory = fixture(t);
  const first = backupScheduledPause(directory, snapshot);
  chmodSync(first.path, 0o644);
  assert.throws(() => backupScheduledPause(directory, snapshot), /BACKUP_NOT_PRIVATE/);
  chmodSync(first.path, 0o600);
  chmodSync(directory, 0o755);
  assert.throws(() => backupScheduledPause(directory, snapshot), /BACKUP_NOT_PRIVATE/);
});
