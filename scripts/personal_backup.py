"""Back up the two personal SQLite stores under simultaneous writer locks."""
from contextlib import ExitStack, closing
from pathlib import Path
import json
import os
import shutil
import sqlite3
import stat

DATABASES = ('taskboard.sqlite', 'execution-control.sqlite')


def _identity(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError(f'Refusing non-regular database: {path.name}')
    return info.st_dev, info.st_ino


def _reject_symlinks(directory):
    for folder, directories, files in os.walk(directory, followlinks=False):
        for entry in directories + files:
            if (Path(folder) / entry).is_symlink():
                raise RuntimeError('Symlink inside personal data; inspect before backup')


def backup_personal_data(data, destination):
    """Caller must stop service holders; locks additionally reject concurrent writes.

    Both stores remain locked while copying and backing up. SQLite backup reads
    through separate read-only connections, including committed WAL content.
    Only root database files/sidecars are excluded from the file copy; an
    attachment with a .sqlite suffix is ordinary user data and is retained.
    """
    data, destination = Path(data), Path(destination)
    if data.is_symlink() or not data.is_dir():
        raise RuntimeError('Personal data must be a real directory')
    _reject_symlinks(data)
    identities = {name: _identity(data / name) for name in DATABASES
                  if (data / name).exists() or (data / name).is_symlink()}
    manifest = []
    with ExitStack() as stack:
        for name in identities:
            lock = stack.enter_context(closing(sqlite3.connect(
                (data / name).as_uri() + '?mode=rw', uri=True, timeout=0)))
            lock.execute('BEGIN IMMEDIATE')
        excluded = {name + suffix for name in DATABASES
                    for suffix in ('', '-wal', '-shm', '-journal')}
        excluded.add('database-backup-manifest.json')
        def ignore(directory, names):
            return set(names) & excluded if Path(directory) == data else set()
        shutil.copytree(data, destination, ignore=ignore, symlinks=True)
        destination.chmod(0o700)
        # Copy can race a source change: reject links in the actual snapshot too.
        _reject_symlinks(destination)
        for name in DATABASES:
            if name not in identities and ((data / name).exists() or (data / name).is_symlink()):
                raise RuntimeError('Database appeared during backup')
        for name, identity in identities.items():
            if _identity(data / name) != identity:
                raise RuntimeError('Database identity changed during backup')
            source = stack.enter_context(closing(sqlite3.connect(
                (data / name).as_uri() + '?mode=ro', uri=True, timeout=0)))
            target = stack.enter_context(closing(sqlite3.connect(destination / name)))
            (destination / name).chmod(0o600)
            source.backup(target)
            # A self-contained restore copy must not depend on a WAL sidecar.
            target.execute('PRAGMA journal_mode=DELETE')
            checks = target.execute('PRAGMA integrity_check').fetchall()
            if checks != [('ok',)]:
                raise RuntimeError(f'Backup integrity failed: {name}')
            manifest.append({'name': name, 'integrity': 'ok',
                             'userVersion': target.execute('PRAGMA user_version').fetchone()[0]})
        for name, identity in identities.items():
            if _identity(data / name) != identity:
                raise RuntimeError('Database identity changed during backup')
        _reject_symlinks(destination)
        # Closing the lock connections releases all writer locks after snapshots.
    (destination / 'database-backup-manifest.json').write_text(
        json.dumps({'databases': manifest}, indent=2) + '\n')
    return manifest
