import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from preservation_journal import Journal, Refused


HERE = pathlib.Path(__file__).resolve().parent
PRIOR = {'nats': {'loaded': True, 'running': True, 'disabled': False},
         'mesh-agent': {'loaded': True, 'running': True, 'disabled': False}}


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-journal-owned-')
        self.root = pathlib.Path(self.temp.name) / 'journal'

    def tearDown(self):
        self.temp.cleanup()

    def test_intent_is_durable_and_visible_before_mutation(self):
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            def apply():
                row = json.loads((self.root / '000001.json').read_text())
                self.assertEqual(row['event'], 'intent')
                self.assertEqual(row['unit'], 'mesh-agent')
                self.assertEqual(row['action'], 'disable')
            journal.mutate('mesh-agent', 'disable', apply, lambda: {'verified': True})
            self.assertFalse(journal.pending_intents())
        with Journal(self.root, boot='boot-a') as reopened:
            self.assertEqual(reopened.records[-1]['event'], 'verified')
            reopened.require_forward()
        for path in self.root.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_failed_fsync_never_calls_mutation(self):
        applied = []
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            with patch('preservation_journal.os.fsync', side_effect=OSError('owned fault')):
                with self.assertRaises(OSError):
                    journal.mutate('mesh-agent', 'disable', lambda: applied.append(True), lambda: {'verified': True})
            self.assertFalse(applied)
            self.assertEqual(len(journal.records), 1)
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()

    def test_directory_sync_failure_cannot_overwrite_an_intent(self):
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            with patch('preservation_journal.sync_dir', side_effect=OSError('owned directory fault')):
                with self.assertRaises(OSError):
                    journal.mutate('mesh-agent', 'disable', lambda: self.fail('must not run'), lambda: {'verified': True})
            persisted = (self.root / '000001.json').read_bytes()
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.append('anything')
            self.assertEqual((self.root / '000001.json').read_bytes(), persisted)
        with Journal(self.root, boot='boot-a') as reopened:
            self.assertEqual(len(reopened.pending_intents()), 1)
            with self.assertRaisesRegex(Refused, 'incomplete durable intent'):
                reopened.require_forward()

    def test_failed_verification_refuses_followup_mutation(self):
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            with self.assertRaisesRegex(Refused, 'verified evidence'):
                journal.mutate('mesh-agent', 'disable', lambda: None, lambda: False)
            self.assertEqual(journal.records[-1]['event'], 'failed')
            with self.assertRaisesRegex(Refused, 'only restore'):
                journal.mutate('nats', 'unload', lambda: self.fail('must not run'), lambda: {'verified': True})

    def test_reboot_refuses_preservation_but_restores_original_state(self):
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'disable', lambda: None, lambda: {'verified': True})
        restored = []
        actual = {'loaded': False, 'running': False, 'disabled': True}
        with Journal(self.root, boot='boot-b') as journal:
            with self.assertRaisesRegex(Refused, 'reboot'):
                journal.require_forward()
            def restore(unit, prior):
                restored.append((unit, prior)); actual.update(prior)
            result = journal.recover(['mesh-agent'], restore,
                                     lambda unit, prior: {**actual, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertEqual(restored, [('mesh-agent', PRIOR['mesh-agent'])])
            with self.assertRaises(Refused):
                journal.require_forward()
        self.assertFalse((self.root / 'acceptance.json').exists())

    def test_owned_process_killed_after_mutation_recovers_incomplete_intent(self):
        state = pathlib.Path(self.temp.name) / 'owned-unit-state.json'
        state.write_text(json.dumps(PRIOR['mesh-agent']))
        source = '''import json,os,pathlib,sys,time
from preservation_journal import Journal
root,state,ready=map(pathlib.Path,sys.argv[1:])
prior={'mesh-agent':{'loaded':True,'running':True,'disabled':False}}
with Journal(root,prior,boot='boot-a') as journal:
 def apply():
  with state.open('w') as f:
   json.dump({'loaded':False,'running':False,'disabled':True},f);f.flush();os.fsync(f.fileno())
  ready.write_text('after-mutation-before-verification')
  while True:time.sleep(1)
 journal.mutate('mesh-agent','disable-and-unload',apply,lambda:{'verified':True})
'''
        ready = pathlib.Path(self.temp.name) / 'ready'
        child = subprocess.Popen([sys.executable, '-c', source, str(self.root), str(state), str(ready)],
                                 cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            end = time.monotonic() + 5
            while not ready.exists() and child.poll() is None and time.monotonic() < end:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), 'owned mutation boundary was not reached')
            child.kill()
            child.wait(timeout=5)
            self.assertEqual(child.returncode, -signal.SIGKILL)
            self.assertTrue(json.loads(state.read_text())['disabled'])
            with Journal(self.root, boot='boot-b') as journal:
                self.assertEqual(len(journal.pending_intents()), 1)
                def restore(unit, prior):
                    intent = json.loads(max(self.root.glob('[0-9]*.json')).read_text())
                    self.assertEqual(intent['action'], 'restore-prior')
                    state.write_text(json.dumps(prior))
                result = journal.recover(['mesh-agent'], restore,
                                         lambda unit, prior: {**json.loads(state.read_text()), 'verified': True},
                                         lambda: {'verified': True})
                self.assertTrue(result['restored'])
            self.assertEqual(json.loads(state.read_text()), PRIOR['mesh-agent'])
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stderr.close()

    def test_second_writer_is_refused(self):
        with Journal(self.root, PRIOR, boot='boot-a'):
            result = subprocess.run([sys.executable, '-c',
                'from preservation_journal import Journal; import sys; Journal(sys.argv[1])', str(self.root)],
                cwd=HERE, capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('another process owns', result.stderr)

    def test_corruption_and_missing_record_refuse_replay(self):
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            journal.append('observation', verified=True)
        path = self.root / '000001.json'
        row = json.loads(path.read_text())
        row['verified'] = False
        path.write_text(json.dumps(row))
        with self.assertRaisesRegex(Refused, 'content changed'):
            Journal(self.root, boot='boot-a')
        path.rename(self.root / '000002.json')
        with self.assertRaisesRegex(Refused, 'sequence has a gap'):
            Journal(self.root, boot='boot-a')

    def test_owner_privacy_and_symlinks_are_refused(self):
        with Journal(self.root, PRIOR, boot='boot-a'):
            pass
        path = self.root / '000000.json'
        real = self.root / 'retained-original'
        path.rename(real)
        path.symlink_to(real)
        with self.assertRaisesRegex(Refused, 'owner-private'):
            Journal(self.root, boot='boot-a')

    def test_recovery_requires_original_states_and_dependency_order(self):
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'unload', lambda: None, lambda: {'verified': True})
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True})
            with self.assertRaisesRegex(Refused, 'omits'):
                journal.recover(['mesh-agent'], lambda *args: None, lambda *args: {}, lambda: {'verified': True})
            with self.assertRaisesRegex(Refused, 'dependencies'):
                journal.recover(['mesh-agent', 'nats'], lambda *args: None, lambda *args: {}, lambda: {'verified': True})
            resumed = []
            result = journal.recover(['nats', 'mesh-agent'], lambda unit, prior: resumed.append(unit),
                                     lambda unit, prior: {**prior, 'running': False, 'verified': True},
                                     lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(resumed, ['nats'])
            self.assertEqual(result['errors'][-1]['reason'], 'bus recovery was not verified')

    def test_recovery_observes_reboot_restored_units_without_restarting_them(self):
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'unload', lambda: None, lambda: {'verified': True})
        with Journal(self.root, boot='boot-b') as journal:
            result = journal.recover(['mesh-agent'], lambda *args: self.fail('already restored unit was restarted'),
                                     lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertTrue(any(r['event'] == 'already-restored' for r in journal.records))

    def test_final_physical_hold_and_readiness_failure_is_not_restoration(self):
        with Journal(self.root, PRIOR, boot='boot-a') as journal:
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True})
            result = journal.recover(['nats'], lambda *args: self.fail('ready bus was restarted'),
                                     lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': False})
            self.assertFalse(result['restored'])
            self.assertEqual(result['errors'][0]['unit'], 'final-state')


if __name__ == '__main__':
    unittest.main()
