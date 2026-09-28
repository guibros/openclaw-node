from contextlib import closing
import importlib.util
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('backup_verify', Path(__file__).with_name('backup_verify.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        os.umask(0o077)
        self.temporary = tempfile.TemporaryDirectory(prefix='openclaw-sqlite-fixture-')
        self.root = Path(self.temporary.name)
        self.source = self.root / 'fixture.db'
        self.writer = sqlite3.connect(self.source)
        self.writer.execute('PRAGMA journal_mode=WAL')
        self.writer.execute('CREATE TABLE entries(value)')
        self.writer.commit()

    def tearDown(self):
        self.writer.close()
        self.temporary.cleanup()

    def current_digest(self):
        with closing(backup.connect_readonly(self.source)) as reader:
            return backup.fingerprint(reader)['tables']['entries']['sha256']

    def test_continuous_writer_and_pinned_snapshot(self):
        self.writer.execute('INSERT INTO entries VALUES(zeroblob(4194304))')
        self.writer.commit()
        stop = self.root / 'stop'
        ready = self.root / 'ready'
        process = subprocess.Popen([sys.executable, __file__, '--writer', str(self.source), str(stop), str(ready)])
        try:
            deadline = time.monotonic() + 5
            while not ready.exists():
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            before = self.writer.execute('SELECT count(*) FROM entries').fetchone()[0]
            result = backup.snapshot_store(self.root, 'fixture.db', self.root / 'output')
            after = self.writer.execute('SELECT count(*) FROM entries').fetchone()[0]
            self.assertTrue(result['sourceSnapshotEqualsRestore'])
            self.assertGreater(after, before)
            self.assertEqual(self.writer.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            self.assertTrue(Path(str(self.source) + '-wal').exists())
        finally:
            stop.touch()
            process.wait(timeout=5)

    def test_rollback_journal_is_refused(self):
        self.writer.execute('PRAGMA journal_mode=DELETE')
        with self.assertRaisesRegex(RuntimeError, 'require WAL'):
            backup.connect_readonly(self.source)

    def test_integer_precision(self):
        self.writer.execute('INSERT INTO entries VALUES(?)', (9007199254740992,))
        self.writer.commit()
        first = self.current_digest()
        self.writer.execute('UPDATE entries SET value=?', (9007199254740993,))
        self.writer.commit()
        self.assertNotEqual(first, self.current_digest())

    def test_invalid_utf8_and_storage_type(self):
        self.writer.execute("INSERT INTO entries VALUES(CAST(X'80' AS TEXT))")
        self.writer.commit()
        first = self.current_digest()
        self.writer.execute("UPDATE entries SET value=CAST(X'81' AS TEXT)")
        self.writer.commit()
        second = self.current_digest()
        self.writer.execute("UPDATE entries SET value=X'81'")
        self.writer.commit()
        self.assertEqual(len({first, second, self.current_digest()}), 3)

    def test_rowids_and_without_rowid(self):
        self.writer.execute('INSERT INTO entries(rowid,value) VALUES(5,1)')
        self.writer.execute('CREATE TABLE keyed(a INTEGER,b TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID')
        self.writer.execute("INSERT INTO keyed VALUES(1,'b'),(1,'a')")
        self.writer.commit()
        first = self.current_digest()
        self.writer.execute('UPDATE entries SET rowid=6')
        self.writer.commit()
        self.assertNotEqual(first, self.current_digest())
        self.assertTrue(backup.snapshot_store(self.root, 'fixture.db', self.root / 'output')['sourceSnapshotEqualsRestore'])

    def test_inventory_refuses_new_store(self):
        backup.inventory_stores(self.root, ('fixture.db',))
        unknown = sqlite3.connect(self.root / 'new-agent-state')
        unknown.execute('CREATE TABLE state(value)')
        unknown.close()
        with self.assertRaisesRegex(RuntimeError, 'undeclared=.*new-agent-state'):
            backup.inventory_stores(self.root, ('fixture.db',))
        excluded = self.root / 'backups'
        excluded.mkdir()
        (self.root / 'new-agent-state').rename(excluded / 'old.db')
        result = backup.inventory_stores(self.root, ('fixture.db',))
        self.assertIn('backups/', result['excluded'])
        os.mkfifo(self.root / 'pipe')
        backup.inventory_stores(self.root, ('fixture.db',))

    def test_manifest_replacement_failure_retains_previous(self):
        path = self.root / 'manifest.json'
        backup.write_manifest(path, {'verified': 1})
        before = path.read_bytes()
        with patch.object(backup.os, 'replace', side_effect=OSError('fixture interruption')):
            with self.assertRaises(OSError):
                backup.write_manifest(path, {'verified': 2})
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.root.glob('.manifest.json-*')), [])


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--writer':
        source, stop, ready = map(Path, sys.argv[2:])
        with closing(sqlite3.connect(source)) as connection:
            while not stop.exists():
                connection.execute('INSERT INTO entries VALUES(?)', (time.time_ns(),))
                connection.commit()
                ready.touch()
                time.sleep(0.002)
    else:
        unittest.main()
