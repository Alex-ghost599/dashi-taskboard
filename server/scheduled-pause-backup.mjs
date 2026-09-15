import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function privateFile(info, directory = false) {
  if (directory ? !info.isDirectory() : !info.isFile()) throw new Error('BACKUP_INVALID_FILE');
  if (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077))) {
    throw new Error('BACKUP_NOT_PRIVATE');
  }
}

// Original RPC snapshots stay in the private runtime directory, never in logs.
// A partial/corrupt existing file is refused; this function never overwrites it.
export function backupScheduledPause(directory, snapshot) {
  if (!path.isAbsolute(directory) || !snapshot || typeof snapshot.id !== 'string' || !snapshot.id) {
    throw new Error('BACKUP_INVALID_INPUT');
  }
  const contents = Buffer.from(`${JSON.stringify(snapshot)}\n`);
  if (contents.length > 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
  const sha256 = createHash('sha256').update(contents).digest('hex');
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const directoryInfo = lstatSync(directory);
  privateFile(directoryInfo, true);
  const filename = path.join(directory, `${sha256}.json`);
  let fd;
  try {
    try {
      fd = openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      writeFileSync(fd, contents);
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = lstatSync(filename);
    privateFile(info);
    fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    privateFile(opened);
    if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== contents.length) throw new Error('BACKUP_CONTENT_MISMATCH');
    const actual = readFileSync(fd);
    if (!actual.equals(contents)) throw new Error('BACKUP_CONTENT_MISMATCH');
    const after = lstatSync(directory);
    if (after.dev !== directoryInfo.dev || after.ino !== directoryInfo.ino || after.isSymbolicLink()) throw new Error('BACKUP_DIRECTORY_CHANGED');
    if (process.platform !== 'win32') {
      const dirFd = openSync(directory, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    }
    return { path: filename, sha256, bytes: contents.length, authorizesDispatch: false };
  } finally { if (fd !== undefined) closeSync(fd); }
}
