import importlib.util
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'lib'))
spec = importlib.util.spec_from_file_location('nats_root_journal', REPO / 'lib' / 'nats_root_journal.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RootJournalTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=REPO)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.base.chmod(0o755)
        self.site = self.base / 'site'
        self.site.mkdir(mode=0o755)
        self.ledger = self.base / 'site-ledger'
        self.lock = self.base / 'writer.lock'
        self.uid = os.getuid()
        self.gid = os.getgid()
        self.transaction = str(uuid.uuid4())
        self.observation = {'boot': 'c' * 64,
                            'user_transfer': {'verified': True, 'root_transaction': self.transaction,
                                              'head': 'a' * 64},
                            'admission': {'verified': True, 'masters': ['b' * 64]}}

    def begin(self):
        return module.LockBootstrapJournal.begin(self.site, self.lock, self.uid, self.gid,
                                                 self.transaction, self.observation)

    def reopen(self):
        return module.LockBootstrapJournal(self.site, self.uid, self.gid)

    def acquire(self, journal, census=None, observe=None, seconds=10):
        return journal.acquire_after_intent(
            self.lock, observe or (lambda: self.observation),
            census or (lambda context: {**context, 'verified': True}), seconds=seconds)

    def test_ledger_is_outside_empty_protected_site_and_reopens_same_lock(self):
        with self.begin() as journal:
            self.assertEqual(list(self.site.iterdir()), [])
            self.assertEqual([row['event'] for row in journal.records], ['lock-create-intent'])
            with self.acquire(journal) as lock:
                lock.validate()
                self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode), 0o644)
            self.assertEqual([row['event'] for row in journal.records],
                             ['lock-create-intent', 'lock-staged', 'lock-admitted'])
        with self.reopen() as journal:
            with self.acquire(journal) as lock:
                lock.validate()
            self.assertEqual(len(journal.records), 3)
        self.assertEqual(list(self.site.iterdir()), [])

    def test_empty_ledger_after_crash_allows_one_begin(self):
        self.ledger.mkdir(mode=0o700)
        with self.begin() as journal:
            self.assertEqual(len(journal.records), 1)
        with self.assertRaisesRegex(module.Refused, 'already has a transaction'):
            self.begin()

    def test_pending_before_publication_is_discarded(self):
        with self.begin() as journal:
            pending = journal.root / ('.pending-' + uuid.uuid4().hex)
            pending.write_bytes(b'interrupted')
            pending.chmod(0o600)
        with self.reopen() as journal:
            with self.acquire(journal):
                pass
            self.assertEqual(journal.records[-1]['event'], 'lock-admitted')
        self.assertFalse(pending.exists())

    def test_pending_after_hardlink_is_recovered(self):
        with self.begin() as journal:
            nonce = journal.records[0]['data']['descriptor']['lock_nonce']
            body = {'sequence': 1, 'previous': journal.records[-1]['sha256'],
                    'event': 'lock-staged', 'data': {'inode': 123, 'nonce': nonce}}
            pending = journal.root / ('.pending-' + uuid.uuid4().hex)
            pending.write_bytes(module.encoded({**body, 'sha256': module.digest(body)}))
            pending.chmod(0o600)
            final = journal.root / '000001.json'
            os.link(pending, final)
        with self.reopen() as journal:
            self.assertEqual(len(journal.records), 2)
            self.assertFalse(pending.exists())
            self.assertEqual(final.stat().st_nlink, 1)

    def test_concurrent_driver_refuses_before_second_intent(self):
        with self.begin():
            script = """import pathlib, sys
sys.path.insert(0, sys.argv[1])
from nats_root_journal import LockBootstrapJournal
LockBootstrapJournal(pathlib.Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
"""
            result = subprocess.run([sys.executable, '-c', script, str(REPO / 'lib'),
                                     str(self.site), str(self.uid), str(self.gid)],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('active driver', result.stderr)
            self.assertEqual(len(list(self.ledger.glob('*.json'))), 1)

    def test_recovery_uses_existing_stage_inode(self):
        with self.begin() as journal:
            saved = journal.records[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
        with self.reopen() as journal:
            with self.acquire(journal):
                pass
            self.assertEqual(self.lock.stat().st_ino, inode)
            self.assertFalse(stage.exists())

    def test_reentry_resyncs_existing_stage_before_recording_it(self):
        with self.begin() as journal:
            saved = journal.records[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
        with self.reopen() as journal:
            with patch.object(module, 'sync_fd', wraps=module.sync_fd) as file_sync, patch.object(
                    module, 'sync_dir', wraps=module.sync_dir) as dir_sync:
                self.assertEqual(journal._create_stage(stage, saved['lock_nonce']), inode)
                self.assertEqual(file_sync.call_count, 1)
                self.assertEqual([call.args[0] for call in dir_sync.call_args_list], [stage.parent])
            with self.acquire(journal):
                pass
            self.assertEqual(self.lock.stat().st_ino, inode)
            self.assertFalse(stage.exists())

    def test_recovery_completes_two_link_gap(self):
        with self.begin() as journal:
            saved = journal.records[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
            journal._append('lock-staged', inode=inode, nonce=saved['lock_nonce'])
            os.link(stage, self.lock)
            self.assertEqual(stage.stat().st_nlink, 2)
        with self.reopen() as journal:
            with self.acquire(journal):
                pass
            self.assertEqual(self.lock.stat().st_ino, inode)
            self.assertFalse(stage.exists())
            self.assertEqual(self.lock.stat().st_nlink, 1)

    def test_deleted_stage_and_lock_after_receipt_cannot_recreate(self):
        with self.begin() as journal:
            saved = journal.records[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
            journal._append('lock-staged', inode=inode, nonce=saved['lock_nonce'])
            stage.unlink()
        with self.reopen() as journal:
            with self.assertRaisesRegex(module.Refused, 'refusing recreation'):
                self.acquire(journal)
            self.assertFalse(self.lock.exists())

    def test_replacement_after_receipt_refuses(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
        self.lock.unlink()
        self.lock.write_bytes(b'bad')
        self.lock.chmod(0o644)
        with self.reopen() as journal:
            with self.assertRaises(module.Refused):
                self.acquire(journal)

    def test_metadata_change_after_admission_refuses(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
        saved = self.lock.stat().st_ctime_ns
        for _ in range(10):
            os.utime(self.lock, None)
            if self.lock.stat().st_ctime_ns != saved:
                break
            time.sleep(0.001)
        self.assertNotEqual(self.lock.stat().st_ctime_ns, saved)
        with self.reopen() as journal:
            with self.assertRaisesRegex(module.Refused, 'identity changed'):
                self.acquire(journal)

    def test_shared_holder_prevents_admission_receipt(self):
        with self.begin() as journal:
            saved = journal.records[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
            journal._append('lock-staged', inode=inode, nonce=saved['lock_nonce'])
            journal._publish_stage(stage, self.lock, inode, saved['lock_nonce'])
            fd = os.open(self.lock, os.O_RDONLY)
            fcntl.flock(fd, fcntl.LOCK_SH)
            try:
                with self.assertRaisesRegex(module.Refused, 'legacy NATS writer still holds'):
                    self.acquire(journal, seconds=0.01)
                self.assertEqual(len(journal.records), 2)
            finally:
                os.close(fd)

    def test_admission_drift_refuses_before_stage(self):
        with self.begin() as journal:
            other = {**self.observation, 'admission': {'verified': True, 'masters': []}}
            with self.assertRaisesRegex(module.Refused, 'admission changed'):
                self.acquire(journal, observe=lambda: other)
            self.assertFalse(self.lock.exists())
            self.assertEqual(len(journal.records), 1)

    def test_census_cannot_mutate_its_comparison_context(self):
        with self.begin() as journal:
            def forged(context):
                context.update(transaction='other', phase='under-exclusion', inode=999)
                return {**context, 'verified': True}
            with self.assertRaisesRegex(module.Refused, 'census is not bound'):
                self.acquire(journal, census=forged)
            self.assertFalse(self.lock.exists())

    def test_census_for_another_phase_or_inode_refuses(self):
        with self.begin() as journal:
            with self.assertRaisesRegex(module.Refused, 'census is not bound'):
                self.acquire(journal, census=lambda context: {
                    **context, 'phase': 'under-exclusion', 'verified': True})
            self.assertFalse(self.lock.exists())

    def test_census_failure_after_stage_reenters_same_inode(self):
        calls = 0
        def census(context):
            nonlocal calls
            calls += 1
            return {**context, 'verified': calls == 1}
        with self.begin() as journal:
            with self.assertRaisesRegex(module.Refused, 'census is not bound'):
                self.acquire(journal, census=census)
            inode = self.lock.stat().st_ino
            self.assertEqual(len(journal.records), 2)
        with self.reopen() as journal:
            with self.acquire(journal):
                pass
            self.assertEqual(self.lock.stat().st_ino, inode)

    def test_marker_blocks_reentry(self):
        with self.begin() as journal:
            (self.site / 'writer-handoff.json').write_bytes(b'{}')
            with self.assertRaisesRegex(module.Refused, 'full recovery journal'):
                self.acquire(journal)
            self.assertFalse(self.lock.exists())

    def test_wrong_path_and_preexisting_lock_refuse(self):
        with self.begin() as journal:
            wrong = self.base / 'unrelated.lock'
            with self.assertRaisesRegex(module.Refused, 'lock path differs'):
                journal.acquire_after_intent(wrong, lambda: self.observation, lambda: {'verified': True})
        self.assertFalse(wrong.exists())
        other = self.base / 'other'
        other.mkdir(mode=0o755)
        lock = other / 'writer.lock'
        lock.write_bytes(b'')
        site = other / 'site'
        site.mkdir(mode=0o755)
        with self.assertRaisesRegex(module.Refused, 'exists without'):
            module.LockBootstrapJournal.begin(site, lock, self.uid, self.gid,
                                              self.transaction, self.observation)
        self.assertFalse((other / 'site-ledger').exists())

    def test_corrupt_record_refuses_reopen(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        record.write_bytes(b'{}')
        with self.assertRaises(module.Refused):
            self.reopen()

    def test_protected_site_and_production_lock_tripwires(self):
        for target in (self.site / 'writer-handoff.json',
                       self.site / '..' / self.site.name / 'writer-handoff.json',
                       Path(str(self.site).upper()) / 'writer-handoff.json'):
            with self.subTest(target=target), self.assertRaisesRegex(
                    module.Refused, 'inside the protected handoff site'):
                module.LockBootstrapJournal.begin(self.site, target, self.uid, self.gid,
                                                  self.transaction, self.observation)
        for target in (module.LOCK, Path('/PRIVATE/var/db/openclaw-nats-writer.lock')):
            with self.subTest(target=target), self.assertRaisesRegex(
                    module.Refused, 'awaits lifecycle recovery'):
                module.LockBootstrapJournal.begin(self.site, target, self.uid, self.gid,
                                                  self.transaction, self.observation)
        self.assertFalse(self.ledger.exists())

    def test_lock_path_inside_ledger_refuses_before_begin(self):
        with self.assertRaisesRegex(module.Refused, 'inside the protected handoff site or ledger'):
            module.LockBootstrapJournal.begin(self.site, self.ledger / 'writer.lock',
                                              self.uid, self.gid, self.transaction, self.observation)
        self.assertFalse(self.ledger.exists())

    def test_staged_nonce_must_match_intent(self):
        with self.begin() as journal:
            saved = journal.records[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
            journal._append('lock-staged', inode=inode, nonce='d' * 64)
        with self.assertRaisesRegex(module.Refused, 'nonce differs from intent'):
            self.reopen()

    def test_macos_root_refuses_before_writing(self):
        with patch.object(module.sys, 'platform', 'darwin'), patch.object(
                module.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(module.Refused, 'awaits lifecycle recovery'):
                self.begin()
        self.assertFalse(self.ledger.exists())
        self.assertFalse(self.lock.exists())

    def test_macos_root_reopen_does_not_clean_pending_record(self):
        with self.begin() as journal:
            pending = journal.root / ('.pending-' + uuid.uuid4().hex)
            pending.write_bytes(b'interrupted')
            pending.chmod(0o600)
        with patch.object(module.sys, 'platform', 'darwin'), patch.object(
                module.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(module.Refused, 'awaits lifecycle recovery'):
                self.reopen()
        self.assertTrue(pending.exists())


if __name__ == '__main__':
    unittest.main()
