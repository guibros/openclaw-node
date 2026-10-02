import importlib.util
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
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
REAL_BOOT_IDENTITY = module.boot_identity


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
                                              'head': 'a' * 64, 'baseline_sha256': 'e' * 64,
                                              'journal_root': str(self.base / 'user-journal')},
                            'admission': {'verified': True, 'masters': ['b' * 64]}}
        boot_patch = patch.object(module, 'boot_identity', side_effect=lambda: self.observation['boot'])
        boot_patch.start()
        self.addCleanup(boot_patch.stop)

    def begin(self):
        return module.LockBootstrapJournal.begin(self.site, self.lock, self.uid, self.gid,
                                                 self.transaction, self.observation)

    def test_boot_identity_matches_preservation_journal_format(self):
        if sys.platform == 'darwin':
            value = subprocess.check_output(['/usr/sbin/sysctl', '-n', 'kern.bootsessionuuid'], text=True)
        else:
            value = Path('/proc/sys/kernel/random/boot_id').read_text()
        self.assertEqual(REAL_BOOT_IDENTITY(), hashlib.sha256(value.strip().encode()).hexdigest())

    def reopen(self):
        return module.LockBootstrapJournal(self.site, self.uid, self.gid)

    def acquire(self, journal, census=None, observe=None, seconds=10):
        return journal.acquire_after_intent(
            self.lock, observe or (lambda: self.observation),
            census or (lambda context: {**context, 'verified': True}), seconds=seconds)

    def returned(self, journal, boot='d' * 64):
        with patch.object(module, 'boot_identity', return_value=boot):
            return journal.return_before_marker(
                self.lock, lambda context: {**context, 'verified': True})

    def successor(self):
        transaction = str(uuid.uuid4())
        observation = {**self.observation, 'boot': 'd' * 64,
                       'user_transfer': {**self.observation['user_transfer'],
                                         'root_transaction': transaction}}
        self.observation = observation
        journal = module.LockBootstrapJournal.begin(
            self.site, self.lock, self.uid, self.gid, transaction, observation)
        return journal, observation

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
        with self.assertRaisesRegex(module.Refused, 'already has an active transaction'):
            self.begin()

    def test_readonly_inspection_of_absent_state_creates_nothing(self):
        self.site.rmdir()
        state = module.LockBootstrapJournal.inspect_readonly(
            self.site, self.uid, self.gid)
        self.assertEqual(state, {'scope': 'ledger-only',
                                 'site_directory': 'absent', 'ledger_directory': 'absent',
                                 'head': None, 'records': 0,
                                 'last_event': None, 'transaction': None})
        self.assertFalse(self.site.exists())
        self.assertFalse(self.ledger.exists())

    def test_readonly_inspection_validates_chain_without_writes(self):
        with self.begin() as journal:
            head = journal.records[-1]['sha256']
        record = self.ledger / '000000.json'
        before = record.stat().st_mtime_ns
        state = module.LockBootstrapJournal.inspect_readonly(
            self.site, self.uid, self.gid)
        self.assertEqual(state, {'scope': 'ledger-only',
                                 'site_directory': 'present', 'ledger_directory': 'present',
                                 'head': head, 'records': 1,
                                 'last_event': 'lock-create-intent',
                                 'transaction': self.transaction})
        self.assertEqual(record.stat().st_mtime_ns, before)

    def test_readonly_inspection_never_settles_pending_record(self):
        with self.begin() as journal:
            pending = journal.root / ('.pending-' + uuid.uuid4().hex)
            pending.write_bytes(b'interrupted')
            pending.chmod(0o600)
        with self.assertRaisesRegex(module.Refused, 'unresolved pending'):
            module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)
        self.assertTrue(pending.exists())
        pending.unlink()
        os.link(self.ledger / '000000.json', pending)
        with self.assertRaisesRegex(module.Refused, 'unresolved pending'):
            module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)
        self.assertTrue(pending.exists())

    def test_readonly_inspection_refuses_fifo_before_open(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        record.unlink()
        os.mkfifo(record, 0o600)
        opened_record = []
        original = os.open
        def observe_open(path, flags, *args, **kwargs):
            if path == record.name:
                opened_record.append(path)
            return original(path, flags, *args, **kwargs)
        with patch.object(module.os, 'open', side_effect=observe_open):
            with self.assertRaisesRegex(module.Refused, 'record identity differs'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)
        self.assertEqual(opened_record, [])

    def test_readonly_inspection_maps_malformed_json_to_refusal(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        record.write_bytes(b'[' * 1200 + b'0' + b']' * 1200)
        with self.assertRaises(module.Refused):
            module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)
        with patch.object(module.json, 'loads', side_effect=RecursionError('deep')):
            with self.assertRaisesRegex(module.Refused, 'record is unreadable'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_readonly_inspection_maps_rehashed_invalid_lock_to_refusal(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            self.returned(journal)
        record = self.ledger / '000003.json'
        saved = json.loads(record.read_bytes())
        saved['data']['lock'] = 5
        saved['sha256'] = module.digest({key: value for key, value in saved.items()
                                          if key != 'sha256'})
        record.write_bytes(module.encoded(saved))
        with self.assertRaises(module.Refused):
            module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)
        with patch.object(module.LockBootstrapJournal, '_validate', side_effect=TypeError('bad')):
            with self.assertRaisesRegex(module.Refused, 'ledger is unobservable'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_driver_refuses_rehashed_nondict_returned_lock(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            self.returned(journal)
        record = self.ledger / '000003.json'
        saved = json.loads(record.read_bytes())
        saved['data']['lock'] = 5
        saved['sha256'] = module.digest({key: value for key, value in saved.items()
                                          if key != 'sha256'})
        record.write_bytes(module.encoded(saved))
        with self.assertRaisesRegex(module.Refused, 'return receipt is incomplete'):
            self.reopen()

    def test_readonly_inspection_refuses_nonstring_transaction(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        saved = json.loads(record.read_bytes())
        saved['data']['descriptor']['transaction'] = True
        saved['sha256'] = module.digest({key: value for key, value in saved.items()
                                          if key != 'sha256'})
        record.write_bytes(module.encoded(saved))
        with self.assertRaises(module.Refused):
            module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_driver_refuses_nonstring_intent_transaction(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        saved = json.loads(record.read_bytes())
        saved['data']['descriptor']['transaction'] = True
        saved['sha256'] = module.digest({key: value for key, value in saved.items()
                                          if key != 'sha256'})
        record.write_bytes(module.encoded(saved))
        with self.assertRaisesRegex(module.Refused, 'transaction is invalid'):
            self.reopen()

    def test_driver_refuses_nonfinite_json_constants(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        original = record.read_bytes()
        for constant in (b'NaN', b'Infinity', b'-Infinity'):
            with self.subTest(constant=constant):
                record.write_bytes(original.replace(b'"sequence":0', b'"sequence":' + constant))
                with self.assertRaisesRegex(module.Refused, 'record is unreadable'):
                    self.reopen()

    def test_driver_refuses_recursive_json_and_chain_encoding(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        original = record.read_bytes()
        record.write_bytes(b'[' * 1200 + b'0' + b']' * 1200)
        with self.assertRaises(module.Refused):
            self.reopen()
        record.write_bytes(original)
        with patch.object(module, 'digest', side_effect=RecursionError('deep')):
            with self.assertRaisesRegex(module.Refused, 'journal chain differs'):
                self.reopen()

    def test_readonly_inspection_refuses_active_driver(self):
        with self.begin():
            with self.assertRaisesRegex(module.Refused, 'ledger is busy'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_readonly_inspection_rechecks_ledger_mode_after_open(self):
        with self.begin():
            pass
        original = os.open
        def change_mode(path, flags, *args, **kwargs):
            if Path(path) == self.ledger and flags & os.O_DIRECTORY:
                self.ledger.chmod(0o777)
            return original(path, flags, *args, **kwargs)
        with patch.object(module.os, 'open', side_effect=change_mode):
            with self.assertRaisesRegex(module.Refused, 'directory identity differs'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_readonly_inspection_rechecks_site_mode_after_open(self):
        with self.begin():
            pass
        original = os.open
        def change_mode(path, flags, *args, **kwargs):
            if Path(path) == self.site and flags & os.O_DIRECTORY:
                self.site.chmod(0o777)
            return original(path, flags, *args, **kwargs)
        with patch.object(module.os, 'open', side_effect=change_mode):
            with self.assertRaisesRegex(module.Refused, 'directory identity differs'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_readonly_inspection_refuses_stale_ledger_swapped_during_read(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            self.returned(journal)
        stale = self.base / 'stale-ledger'
        shutil.copytree(self.ledger, stale)
        successor, _ = self.successor()
        successor.close()
        original = module.LockBootstrapJournal._read
        displaced = self.base / 'active-ledger'
        def swap_before_read(journal, settle_pending=True):
            if not settle_pending:
                journal.root.rename(displaced)
                stale.rename(journal.root)
            return original(journal, settle_pending)
        with patch.object(module.LockBootstrapJournal, '_read', new=swap_before_read):
            with self.assertRaisesRegex(module.Refused, 'path changed'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)
        self.assertTrue(displaced.exists())

    def test_readonly_inspection_refuses_ledger_swapped_after_read(self):
        with self.begin():
            pass
        stale = self.base / 'stale-ledger'
        shutil.copytree(self.ledger, stale)
        original = module.LockBootstrapJournal._read
        displaced = self.base / 'active-ledger'
        def swap_after_read(journal, settle_pending=True):
            records = original(journal, settle_pending)
            if not settle_pending:
                journal.root.rename(displaced)
                stale.rename(journal.root)
            return records
        with patch.object(module.LockBootstrapJournal, '_read', new=swap_after_read):
            with self.assertRaisesRegex(module.Refused, 'record path changed|ledger changed'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_readonly_inspection_refuses_record_swapped_after_validation(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        stale = self.base / 'stale-record.json'
        shutil.copy2(record, stale)
        original = module.LockBootstrapJournal._validate
        def swap_after_validation(journal):
            result = original(journal)
            record.unlink()
            stale.rename(record)
            return result
        with patch.object(module.LockBootstrapJournal, '_validate', new=swap_after_validation):
            with self.assertRaisesRegex(module.Refused, 'record path changed'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_readonly_inspection_refuses_disappeared_ledger_as_refused(self):
        with self.begin():
            pass
        original = module.LockBootstrapJournal._validate
        displaced = self.base / 'displaced-ledger'
        def remove_after_validation(journal):
            result = original(journal)
            journal.root.rename(displaced)
            return result
        with patch.object(module.LockBootstrapJournal, '_validate', new=remove_after_validation):
            with self.assertRaisesRegex(module.Refused, 'unobservable'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)

    def test_readonly_inspection_refuses_fifo_record_without_waiting(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        record.unlink()
        os.mkfifo(record, 0o600)
        script = """import pathlib, sys
sys.path.insert(0, sys.argv[1])
from nats_root_journal import LockBootstrapJournal
LockBootstrapJournal.inspect_readonly(pathlib.Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
"""
        result = subprocess.run([sys.executable, '-c', script, str(REPO / 'lib'),
                                 str(self.site), str(self.uid), str(self.gid)],
                                capture_output=True, text=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('record identity differs', result.stderr)

    def test_readonly_inspection_refuses_directory_record_without_fd_leak(self):
        with self.begin():
            pass
        record = self.ledger / '000000.json'
        record.unlink()
        record.mkdir()
        before = len(os.listdir('/dev/fd'))
        for _ in range(3):
            with self.assertRaisesRegex(module.Refused, 'record identity differs'):
                module.LockBootstrapJournal.inspect_readonly(self.site, self.uid, self.gid)
        self.assertEqual(len(os.listdir('/dev/fd')), before)

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
            self.assertIn('ledger is busy', result.stderr)
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

    def test_intent_only_reentry_refuses_stage_with_foreign_link(self):
        with self.begin() as journal:
            saved = journal.records[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            journal._create_stage(stage, saved['lock_nonce'])
            os.link(stage, self.base / 'foreign-link')
        with self.reopen() as journal:
            with self.assertRaisesRegex(module.Refused, 'unpublished root writer stage has another link'):
                self.acquire(journal)
            self.assertFalse(self.lock.exists())
            self.assertEqual(len(journal.records), 1)

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
        for target in (self.ledger / 'writer.lock', self.base / 'site-outcomes' / 'writer.lock'):
            with self.subTest(target=target), self.assertRaisesRegex(
                    module.Refused, 'inside the protected handoff site or ledger'):
                module.LockBootstrapJournal.begin(self.site, target, self.uid, self.gid,
                                                  self.transaction, self.observation)
        self.assertFalse(self.ledger.exists())

    def test_staged_nonce_must_match_intent(self):
        with self.begin() as journal:
            saved = journal.records[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
            journal._append('lock-staged', inode=inode, nonce='d' * 64)
        with self.assertRaisesRegex(module.Refused, 'stage receipt differs from intent'):
            self.reopen()

    def test_intent_only_return_drops_unpublished_stage_and_allows_successor(self):
        with self.begin() as journal:
            saved = journal.current[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            journal._create_stage(stage, saved['lock_nonce'])
            receipt = self.returned(journal)
            self.assertEqual(receipt['outcome'], 'returned')
            self.assertEqual(receipt['user_journal_root'], str(self.base / 'user-journal'))
            self.assertEqual(receipt['user_baseline_sha256'], 'e' * 64)
            self.assertEqual(receipt['user_transfer_sha256'], 'a' * 64)
            self.assertIsNone(journal.current[-1]['data']['lock'])
            self.assertFalse(stage.exists())
            self.assertFalse(self.lock.exists())
            self.assertEqual(stat.S_IMODE((self.base / 'site-outcomes' /
                                            (self.transaction + '.json')).stat().st_mode), 0o644)
        with self.reopen() as journal:
            self.assertEqual(journal.read_returned_outcome(), receipt)
        successor, observation = self.successor()
        with successor:
            with self.acquire(successor, observe=lambda: observation):
                pass
            self.assertEqual(len(successor.current), 3)

    def test_intent_only_return_cleans_incomplete_stage(self):
        with self.begin() as journal:
            stage = journal._stage_path(journal.current[0]['data']['descriptor'])
            stage.write_bytes(b'')
            stage.chmod(0o644)
            self.returned(journal)
            self.assertFalse(stage.exists())
            self.assertFalse(self.lock.exists())

    def test_intent_only_return_refuses_foreign_stage_link(self):
        with self.begin() as journal:
            stage = journal._stage_path(journal.current[0]['data']['descriptor'])
            stage.write_bytes(b'partial-nonce')
            stage.chmod(0o644)
            os.link(stage, self.base / 'foreign-link')
            with self.assertRaisesRegex(module.Refused, 'unpublished root writer stage identity differs'):
                self.returned(journal)
            self.assertTrue(stage.exists())
            self.assertEqual(journal.current[-1]['event'], 'lock-create-intent')

    def test_intent_only_return_refuses_foreign_stage_content(self):
        with self.begin() as journal:
            stage = journal._stage_path(journal.current[0]['data']['descriptor'])
            stage.write_bytes(b'not-the-nonce')
            stage.chmod(0o644)
            with self.assertRaisesRegex(module.Refused, 'stage nonce differs'):
                self.returned(journal)
            self.assertTrue(stage.exists())

    def test_returned_outcome_directory_ignores_restrictive_umask(self):
        with self.begin() as journal:
            prior = os.umask(0o077)
            try:
                self.returned(journal)
            finally:
                os.umask(prior)
        self.assertEqual(stat.S_IMODE((self.base / 'site-outcomes').stat().st_mode), 0o755)

    def test_successor_reused_transaction_refuses_before_append(self):
        with self.begin() as journal:
            self.returned(journal, boot=self.observation['boot'])
        before = sorted(self.ledger.glob('*.json'))
        with self.assertRaisesRegex(module.Refused, 'transaction was reused'):
            self.begin()
        self.assertEqual(sorted(self.ledger.glob('*.json')), before)

    def test_forward_after_boot_change_refuses_before_stage(self):
        with self.begin() as journal, patch.object(module, 'boot_identity', return_value='e' * 64):
            with self.assertRaisesRegex(module.Refused, 'another boot'):
                self.acquire(journal)
            self.assertFalse(self.lock.exists())

    def test_begin_from_other_boot_refuses_before_ledger(self):
        with patch.object(module, 'boot_identity', return_value='e' * 64):
            with self.assertRaisesRegex(module.Refused, 'another boot'):
                self.begin()
        self.assertFalse(self.ledger.exists())

    def test_return_relinks_recorded_stage_and_successor_inherits_it(self):
        with self.begin() as journal:
            saved = journal.current[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
            journal._append('lock-staged', inode=inode, nonce=saved['lock_nonce'])
            os.link(stage, self.lock)
            self.lock.unlink()
            self.returned(journal)
            self.assertEqual(self.lock.stat().st_ino, inode)
            self.assertFalse(stage.exists())
            self.assertEqual(journal.current[-1]['data']['lock']['inode'], inode)
        successor, observation = self.successor()
        with successor:
            self.assertEqual(successor.current[0]['data']['inherited']['inode'], inode)
            self.assertEqual(successor.current[0]['data']['descriptor']['lock_nonce'], saved['lock_nonce'])
            with self.acquire(successor, observe=lambda: observation):
                pass
            self.assertEqual(self.lock.stat().st_ino, inode)
            self.assertEqual([row['event'] for row in successor.current],
                             ['lock-create-intent', 'lock-admitted'])

    def test_return_relinks_recorded_stage_but_waits_for_old_inode_holder(self):
        with self.begin() as journal:
            saved = journal.current[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
            journal._append('lock-staged', inode=inode, nonce=saved['lock_nonce'])
            os.link(stage, self.lock)
            fd = os.open(self.lock, os.O_RDONLY)
            fcntl.flock(fd, fcntl.LOCK_SH)
            self.lock.unlink()
            try:
                with patch.object(module, 'boot_identity', return_value='d' * 64):
                    with self.assertRaisesRegex(module.Refused, 'still holds'):
                        journal.return_before_marker(
                            self.lock, lambda context: {**context, 'verified': True}, seconds=0.15)
                self.assertEqual(self.lock.stat().st_ino, inode)
                self.assertEqual(journal.current[-1]['event'], 'lock-staged')
            finally:
                os.close(fd)
            self.returned(journal)
            self.assertEqual(self.lock.stat().st_ino, inode)

    def test_lost_recorded_inode_refuses_return_and_successor(self):
        with self.begin() as journal:
            saved = journal.current[0]['data']['descriptor']
            stage = journal._stage_path(saved)
            inode = journal._create_stage(stage, saved['lock_nonce'])
            journal._append('lock-staged', inode=inode, nonce=saved['lock_nonce'])
            journal._publish_stage(stage, self.lock, inode, saved['lock_nonce'])
            self.lock.unlink()
            with self.assertRaisesRegex(module.Refused, 'refusing recreation'):
                self.returned(journal)
            self.assertEqual(journal.current[-1]['event'], 'lock-staged')
        with self.assertRaisesRegex(module.Refused, 'already has an active transaction'):
            self.successor()

    def test_reboot_return_of_admitted_lock_keeps_inode(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            inode = self.lock.stat().st_ino
        with self.reopen() as journal:
            receipt = self.returned(journal, boot='e' * 64)
            self.assertEqual(journal.current[-1]['data']['boot'], 'e' * 64)
            self.assertEqual(journal.current[-1]['data']['lock']['inode'], inode)
            self.assertEqual(receipt['ledger_sha256'], journal.current[-1]['sha256'])
        successor, _ = self.successor()
        successor.close()
        self.assertEqual(self.lock.stat().st_ino, inode)

    def test_returned_record_republishes_missing_outcome_after_crash(self):
        with self.begin() as journal, patch.object(journal, 'publish_returned_outcome',
                                                    side_effect=OSError('killed before receipt')):
            with self.assertRaisesRegex(OSError, 'killed before receipt'):
                self.returned(journal)
            self.assertEqual([row['event'] for row in journal.current],
                             ['lock-create-intent', 'returned'])
        with self.reopen() as journal:
            receipt = journal.publish_returned_outcome()
            self.assertEqual(receipt['outcome'], 'returned')
            self.assertEqual(len(journal.records), 2)

    def test_successor_refuses_changed_returned_lock(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            self.returned(journal)
        self.lock.unlink()
        self.lock.write_bytes(b'replacement')
        self.lock.chmod(0o644)
        with self.assertRaises(module.Refused):
            self.successor()

    def test_return_waits_for_inherited_shared_holder(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            holder = subprocess.Popen(
                [sys.executable, '-c',
                 'import fcntl, os, sys, time\n'
                 'fd = os.open(sys.argv[1], os.O_RDONLY)\n'
                 'fcntl.flock(fd, fcntl.LOCK_SH)\n'
                 'print("holding", flush=True)\n'
                 'time.sleep(30)\n', str(self.lock)],
                stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(holder.stdout.readline().strip(), 'holding')
                with patch.object(module, 'boot_identity', return_value='d' * 64):
                    with self.assertRaisesRegex(module.Refused, 'still holds'):
                        journal.return_before_marker(
                            self.lock, lambda context: {**context, 'verified': True}, seconds=0.15)
                self.assertEqual(journal.current[-1]['event'], 'lock-admitted')
            finally:
                holder.terminate()
                holder.wait(timeout=5)
                holder.stdout.close()
            self.returned(journal)

    def test_marker_blocks_return_before_receipt(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            (self.site / 'writer-handoff.json').write_text('{}')
            with self.assertRaisesRegex(module.Refused, 'marker blocks'):
                self.returned(journal)
            self.assertEqual(journal.current[-1]['event'], 'lock-admitted')

    def test_tampered_public_outcome_blocks_successor(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            self.returned(journal)
        outcome = self.base / 'site-outcomes' / (self.transaction + '.json')
        outcome.write_text('{}')
        with self.assertRaisesRegex(module.Refused, 'differs from ledger'):
            self.successor()
        self.assertEqual(len(list(self.ledger.glob('*.json'))), 4)

    def test_intent_only_returned_record_cannot_name_a_lock(self):
        with self.begin() as journal:
            journal._append('returned', lock={'inode': 1, 'nonce': journal.current[0]['data']['descriptor']['lock_nonce'],
                                              'ctime_ns': 1}, boot='d' * 64, release_sha256='e' * 64)
        with self.assertRaisesRegex(module.Refused, 'return receipt is incomplete'):
            self.reopen()

    def test_multiple_successors_preserve_one_lock_inode(self):
        with self.begin() as journal:
            with self.acquire(journal):
                pass
            inode = self.lock.stat().st_ino
            self.returned(journal)
        for _ in range(3):
            successor, observation = self.successor()
            with successor:
                with self.acquire(successor, observe=lambda: observation):
                    pass
                self.returned(successor)
                self.assertEqual(self.lock.stat().st_ino, inode)
        with self.reopen() as journal:
            self.assertEqual(len(journal.records), 13)
            self.assertEqual(journal.current[-1]['event'], 'returned')

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
