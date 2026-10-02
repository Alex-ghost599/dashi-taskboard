"""Isolated restore and failure checks; never touch installed personal data."""
from pathlib import Path
import importlib.util
import json
import os
import plistlib
import shutil
import subprocess
import sys
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('personal_backup', Path(__file__).parents[1] / 'scripts/personal_backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class PersonalBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name) / 'data'
        self.data.mkdir()
        self.dest = Path(self.temp.name) / 'restore'

    def database(self, name, value):
        connection = sqlite3.connect(self.data / name)
        self.addCleanup(connection.close)
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('CREATE TABLE records (value TEXT)')
        connection.execute('INSERT INTO records VALUES (?)', (value,))
        connection.commit()
        return connection

    def test_restores_both_wal_databases_and_sqlite_named_attachment(self):
        self.database('taskboard.sqlite', 'test-card')
        self.database('execution-control.sqlite', 'UNKNOWN-test-attempt')
        attachment = self.data / 'attachments' / 'important.sqlite'
        attachment.parent.mkdir()
        attachment.write_bytes(b'ordinary attachment, not a database')
        manifest = backup.backup_personal_data(self.data, self.dest)
        self.assertEqual(len(manifest), 2)
        for name, expected in [('taskboard.sqlite', 'test-card'), ('execution-control.sqlite', 'UNKNOWN-test-attempt')]:
            with sqlite3.connect(self.dest / name) as restored:
                self.assertEqual(restored.execute('SELECT value FROM records').fetchone()[0], expected)
                self.assertEqual(restored.execute('PRAGMA integrity_check').fetchall(), [('ok',)])
        self.assertEqual((self.dest / 'attachments/important.sqlite').read_bytes(), attachment.read_bytes())
        self.assertFalse((self.dest / 'taskboard.sqlite-wal').exists())

    def test_writer_on_second_database_rejects_before_copy_and_releases_first_lock(self):
        first = self.database('taskboard.sqlite', 'card')
        second = self.database('execution-control.sqlite', 'attempt')
        second.execute('BEGIN IMMEDIATE')
        with self.assertRaises(sqlite3.OperationalError):
            backup.backup_personal_data(self.data, self.dest)
        self.assertFalse(self.dest.exists())
        first.execute('INSERT INTO records VALUES ("after-failure")')
        first.commit()

    def test_simultaneous_locks_prevent_interleaving_writes(self):
        first = self.database('taskboard.sqlite', 'card')
        second = self.database('execution-control.sqlite', 'attempt')
        original = backup.shutil.copytree
        def observed_copy(*args, **kwargs):
            for name in backup.DATABASES:
                with sqlite3.connect(self.data / name, timeout=0) as writer:
                    with self.assertRaises(sqlite3.OperationalError):
                        writer.execute('INSERT INTO records VALUES ("interleaved")')
            return original(*args, **kwargs)
        with patch.object(backup.shutil, 'copytree', side_effect=observed_copy):
            backup.backup_personal_data(self.data, self.dest)
        for connection in (first, second):
            self.assertEqual(connection.execute('SELECT count(*) FROM records').fetchone()[0], 1)

    def test_legacy_main_only_backup_does_not_create_coordinator(self):
        self.database('taskboard.sqlite', 'legacy')
        manifest = backup.backup_personal_data(self.data, self.dest)
        self.assertEqual([item['name'] for item in manifest], ['taskboard.sqlite'])
        self.assertFalse((self.data / 'execution-control.sqlite').exists())
        self.assertFalse((self.dest / 'execution-control.sqlite').exists())

    def test_symlink_database_rejected(self):
        outside = Path(self.temp.name) / 'elsewhere.sqlite'
        outside.write_bytes(b'private')
        (self.data / 'taskboard.sqlite').symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            backup.backup_personal_data(self.data, self.dest)
        self.assertFalse(self.dest.exists())
        self.assertEqual(outside.read_bytes(), b'private')

    def test_symlink_attachment_rejected_instead_of_aliasing_live_data(self):
        outside = Path(self.temp.name) / 'live-attachment'
        outside.write_bytes(b'live')
        (self.data / 'attachment').symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            backup.backup_personal_data(self.data, self.dest)
        self.assertFalse(self.dest.exists())

    def test_link_appearing_during_copy_cannot_produce_success(self):
        outside = Path(self.temp.name) / 'live'
        outside.write_bytes(b'live')
        original = backup.shutil.copytree
        def changed_source(*args, **kwargs):
            (self.data / 'late-link').symlink_to(outside)
            return original(*args, **kwargs)
        with patch.object(backup.shutil, 'copytree', side_effect=changed_source):
            with self.assertRaisesRegex(RuntimeError, 'Symlink'):
                backup.backup_personal_data(self.data, self.dest)
        self.assertFalse((self.dest / 'database-backup-manifest.json').exists())

    def test_failed_restore_snapshot_cannot_inherit_success_manifest(self):
        self.database('taskboard.sqlite', 'card')
        (self.data / 'database-backup-manifest.json').write_text('{"databases":[{"integrity":"ok"}]}')
        original = backup.sqlite3.connect
        def failed_read(database, *args, **kwargs):
            if '?mode=ro' in str(database):
                raise sqlite3.OperationalError('synthetic I/O failure')
            return original(database, *args, **kwargs)
        with patch.object(backup.sqlite3, 'connect', side_effect=failed_read):
            with self.assertRaises(sqlite3.OperationalError):
                backup.backup_personal_data(self.data, self.dest)
        self.assertFalse((self.dest / 'database-backup-manifest.json').exists())

    def test_corrupt_database_never_produces_success_manifest(self):
        (self.data / 'taskboard.sqlite').write_bytes(b'not sqlite')
        with self.assertRaises(sqlite3.DatabaseError):
            backup.backup_personal_data(self.data, self.dest)
        self.assertFalse((self.dest / 'database-backup-manifest.json').exists())


class PersonalInstallTests(unittest.TestCase):
    def fixture(self, holder=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        scripts = root / 'source/scripts'
        scripts.mkdir(parents=True)
        original = Path(__file__).parents[1] / 'scripts'
        for name in ('personal-install.py', 'personal_backup.py'):
            shutil.copyfile(original / name, scripts / name)
        candidate = root / 'candidate.app'
        (candidate / 'Contents/Resources').mkdir(parents=True)
        (candidate / 'Contents/Resources/build-provenance.json').write_text(json.dumps({'dirty': False, 'commit': 'test-commit'}))
        (candidate / 'new-program').write_text('candidate')
        deploy = root / 'source/.local-deploy'
        deploy.mkdir()
        (deploy / 'artifact-path').write_text(str(candidate))
        home = root / 'home'
        target = home / 'Applications/Dashi Taskboard Personal.app'
        (target / 'Contents').mkdir(parents=True)
        (target / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'com.alexghost599.dashi-taskboard-personal'}))
        (target / 'old-program').write_text('previous')
        data = home / 'Library/Application Support/Dashi Taskboard Personal'
        data.mkdir(parents=True)
        for name, value in [('taskboard.sqlite', 'card'), ('execution-control.sqlite', 'UNKNOWN')]:
            with sqlite3.connect(data / name) as database:
                database.execute('CREATE TABLE records(value TEXT)')
                database.execute('INSERT INTO records VALUES (?)', (value,))
        tools = root / 'tools'
        tools.mkdir()
        for name, body in [('git', 'echo test-commit'), ('ps', 'exit 0'), ('lsof', 'echo 123; exit 0' if holder else 'exit 1')]:
            executable = tools / name
            executable.write_text('#!/bin/sh\n' + body + '\n')
            executable.chmod(0o700)
        environment = dict(os.environ, HOME=str(home), PATH=str(tools), PYTHONDONTWRITEBYTECODE='1')
        return scripts, environment, home, target, data

    def test_actual_installer_pairs_old_app_with_both_database_backups(self):
        scripts, environment, home, target, data = self.fixture()
        result = subprocess.run([sys.executable, str(scripts / 'personal-install.py')], env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        directory = Path(receipt['backup'])
        self.assertEqual((directory / target.name / 'old-program').read_text(), 'previous')
        self.assertEqual((target / 'new-program').read_text(), 'candidate')
        self.assertEqual(len(receipt['databases']), 2)
        for name, expected in [('taskboard.sqlite', 'card'), ('execution-control.sqlite', 'UNKNOWN')]:
            with sqlite3.connect(directory / 'data' / name) as restored:
                self.assertEqual(restored.execute('SELECT value FROM records').fetchone()[0], expected)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)

    def test_database_holder_refuses_install_without_replacing_old_app(self):
        scripts, environment, home, target, data = self.fixture(holder=True)
        result = subprocess.run([sys.executable, str(scripts / 'personal-install.py')], env=environment, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('holders', result.stderr)
        self.assertTrue((target / 'old-program').exists())
        self.assertFalse((target / 'new-program').exists())
        self.assertFalse((home / 'Library/Application Support/Dashi Taskboard Personal Backups').exists())


if __name__ == '__main__':
    unittest.main()
