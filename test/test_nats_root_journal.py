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

    def test_intent_precedes_lock_creation_and_reopen_is_idempotent(self):
        journal = self.begin()
        self.assertFalse(self.lock.exists())
        self.assertEqual([row['event'] for row in journal.records], ['lock-create-intent'])
        observed = []
        with journal.acquire_after_intent(self.lock, lambda: observed.append('admission') or self.observation,
                                          lambda: observed.append('census') or {'verified': True}) as lock:
            self.assertEqual(observed, ['admission', 'census', 'census', 'admission'])
            lock.validate()
            self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode), 0o644)
        self.assertEqual([row['event'] for row in journal.records],
                         ['lock-create-intent', 'lock-created'])
        reopened = module.LockBootstrapJournal(self.site, self.uid, self.gid)
        with reopened.acquire_after_intent(self.lock, lambda: self.observation, lambda: {'verified': True}) as lock:
            lock.validate()
        self.assertEqual(reopened.records, journal.records)

    def test_failed_admission_does_not_create_lock(self):
        journal = self.begin()
        with self.assertRaisesRegex(module.Refused, 'admission changed'):
            journal.acquire_after_intent(self.lock,
                                         lambda: {**self.observation, 'admission': {'verified': True, 'masters': []}},
                                         lambda: {'verified': True})
        self.assertFalse(self.lock.exists())
        self.assertEqual(len(journal.records), 1)

    def test_reentry_refuses_another_lock_path(self):
        journal = self.begin()
        wrong = self.base / 'unrelated.lock'
        with self.assertRaisesRegex(module.Refused, 'lock path differs'):
            journal.acquire_after_intent(wrong, lambda: self.observation,
                                         lambda: {'verified': True})
        self.assertFalse(self.lock.exists())
        self.assertFalse(wrong.exists())
        self.assertEqual(len(journal.records), 1)

    def test_census_failure_reopens_same_intent(self):
        self.begin()
        reopened = module.LockBootstrapJournal(self.site, self.uid, self.gid)
        calls = 0
        def census():
            nonlocal calls
            calls += 1
            return {'verified': calls == 1}
        with self.assertRaisesRegex(module.Refused, 'census is not verified'):
            reopened.acquire_after_intent(self.lock, lambda: self.observation, census)
        self.assertTrue(self.lock.exists())
        self.assertEqual(len(reopened.records), 1)
        again = module.LockBootstrapJournal(self.site, self.uid, self.gid)
        with again.acquire_after_intent(self.lock, lambda: self.observation, lambda: {'verified': True}):
            pass
        self.assertEqual(len(again.records), 2)

    def test_admission_drift_under_exclusion_prevents_receipt(self):
        journal = self.begin()
        calls = 0
        def observe():
            nonlocal calls
            calls += 1
            return self.observation if calls == 1 else {
                **self.observation, 'admission': {'verified': True, 'masters': []}}
        with self.assertRaisesRegex(module.Refused, 'changed under exclusion'):
            journal.acquire_after_intent(self.lock, observe, lambda: {'verified': True})
        self.assertTrue(self.lock.exists())
        self.assertEqual(len(journal.records), 1)

    def test_preexisting_lock_refuses_before_journal(self):
        self.lock.write_bytes(b'')
        with self.assertRaisesRegex(module.Refused, 'exists without'):
            self.begin()
        self.assertFalse((self.site / 'journal').exists())

    def test_lock_path_cannot_publish_the_marker(self):
        for target in (self.site / 'writer-handoff.json',
                       self.site / '..' / self.site.name / 'writer-handoff.json'):
            with self.subTest(target=target), self.assertRaisesRegex(
                    module.Refused, 'inside the protected handoff site'):
                module.LockBootstrapJournal.begin(self.site, target, self.uid, self.gid,
                                                  self.transaction, self.observation)
        self.assertFalse((self.site / 'journal').exists())
        self.assertFalse((self.site / 'writer-handoff.json').exists())

    def test_production_lock_requires_lifecycle_recovery(self):
        for target in (module.LOCK, module.LOCK.parent / 'unused' / '..' / module.LOCK.name):
            with self.subTest(target=target), self.assertRaisesRegex(
                    module.Refused, 'awaits lifecycle recovery'):
                module.LockBootstrapJournal.begin(self.site, target, self.uid, self.gid,
                                                  self.transaction, self.observation)
        self.assertFalse((self.site / 'journal').exists())

    def test_transfer_for_another_transaction_refuses_before_journal(self):
        other = {**self.observation,
                 'user_transfer': {**self.observation['user_transfer'],
                                   'root_transaction': str(uuid.uuid4())}}
        with self.assertRaisesRegex(module.Refused, 'observation is incomplete'):
            module.LockBootstrapJournal.begin(self.site, self.lock, self.uid, self.gid,
                                              self.transaction, other)
        self.assertFalse((self.site / 'journal').exists())

    def test_modified_chain_refuses_reopen(self):
        self.begin()
        record = self.site / 'journal/000000.json'
        record.write_bytes(b'{}')
        with self.assertRaises(module.Refused):
            module.LockBootstrapJournal(self.site, self.uid, self.gid)

    def test_lock_replacement_refuses_after_receipt(self):
        journal = self.begin()
        with journal.acquire_after_intent(self.lock, lambda: self.observation,
                                          lambda: {'verified': True}):
            pass
        self.lock.unlink()
        self.lock.write_bytes(b'')
        self.lock.chmod(0o644)
        reopened = module.LockBootstrapJournal(self.site, self.uid, self.gid)
        with self.assertRaisesRegex(module.Refused, 'identity changed'):
            reopened.acquire_after_intent(self.lock, lambda: self.observation,
                                          lambda: {'verified': True})

    def test_lock_metadata_change_refuses_after_receipt(self):
        journal = self.begin()
        with journal.acquire_after_intent(self.lock, lambda: self.observation,
                                          lambda: {'verified': True}):
            pass
        saved = self.lock.stat().st_ctime_ns
        for _ in range(10):
            os.utime(self.lock, None)
            if self.lock.stat().st_ctime_ns != saved:
                break
            time.sleep(0.001)
        self.assertNotEqual(self.lock.stat().st_ctime_ns, saved)
        reopened = module.LockBootstrapJournal(self.site, self.uid, self.gid)
        with self.assertRaisesRegex(module.Refused, 'identity changed'):
            reopened.acquire_after_intent(self.lock, lambda: self.observation,
                                          lambda: {'verified': True})

    def test_shared_holder_prevents_lock_created_receipt(self):
        journal = self.begin()
        module._create(self.lock, self.uid, self.gid)
        fd = os.open(self.lock, os.O_RDONLY)
        fcntl.flock(fd, fcntl.LOCK_SH)
        try:
            with self.assertRaisesRegex(module.Refused, 'legacy NATS writer still holds'):
                journal.acquire_after_intent(self.lock, lambda: self.observation,
                                             lambda: {'verified': True}, seconds=0.01)
            self.assertEqual(len(journal.records), 1)
        finally:
            os.close(fd)

    def test_marker_presence_blocks_lock_bootstrap(self):
        journal = self.begin()
        (self.site / 'writer-handoff.json').write_bytes(b'{}')
        with self.assertRaisesRegex(module.Refused, 'full recovery journal'):
            journal.acquire_after_intent(self.lock, lambda: self.observation,
                                         lambda: {'verified': True})
        self.assertFalse(self.lock.exists())

    def test_marker_appearing_during_census_prevents_receipt(self):
        journal = self.begin()
        calls = 0
        def census():
            nonlocal calls
            calls += 1
            if calls == 2:
                (self.site / 'writer-handoff.json').write_bytes(b'{}')
            return {'verified': True}
        with self.assertRaisesRegex(module.Refused, 'handoff changed'):
            journal.acquire_after_intent(self.lock, lambda: self.observation, census)
        self.assertEqual(len(journal.records), 1)

    def test_abrupt_exit_reenters_intent_and_creation_gap(self):
        script = '''import json, os, pathlib, sys
sys.path.insert(0, sys.argv[1])
from nats_root_journal import LockBootstrapJournal, _create
site, lock = pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
if sys.argv[4] == 'intent':
    LockBootstrapJournal.begin(site, lock, os.getuid(), os.getgid(), sys.argv[5], json.loads(sys.argv[6]))
else:
    _create(lock, os.getuid(), os.getgid())
os._exit(19)
'''
        def killed(phase):
            return subprocess.run([sys.executable, '-c', script, str(REPO / 'lib'),
                                   str(self.site), str(self.lock), phase,
                                   self.transaction, json.dumps(self.observation)],
                                  capture_output=True, text=True)
        first = killed('intent')
        self.assertEqual(first.returncode, 19, first.stderr)
        self.assertFalse(self.lock.exists())
        reopened = module.LockBootstrapJournal(self.site, self.uid, self.gid)
        self.assertEqual(len(reopened.records), 1)
        second = killed('created')
        self.assertEqual(second.returncode, 19, second.stderr)
        recovered = module.LockBootstrapJournal(self.site, self.uid, self.gid)
        with recovered.acquire_after_intent(self.lock, lambda: self.observation,
                                            lambda: {'verified': True}):
            pass
        self.assertEqual(len(recovered.records), 2)


if __name__ == '__main__':
    unittest.main()
