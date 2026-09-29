import copy
import errno
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
for unit, state in PRIOR.items():
    state['class'] = 'daemon'
    state['identity'] = {'plist_sha256': '0' * 64, 'argv': ['/owned/' + unit],
                         'files': {'/owned/' + unit: '1' * 64}, 'dependencies': {}}


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-journal-owned-')
        self.root = pathlib.Path(self.temp.name) / 'journal'
        self.node_lock = pathlib.Path(self.temp.name) / 'node.lock'

    def journal(self, prior=None, boot='boot-a', root=None):
        return Journal(root or self.root, prior, boot=boot, node_lock=self.node_lock)

    def tearDown(self):
        self.temp.cleanup()

    def test_intent_is_durable_and_visible_before_mutation(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            def apply():
                row = json.loads((self.root / '000001.json').read_text())
                self.assertEqual(row['event'], 'intent')
                self.assertEqual(row['unit'], 'mesh-agent')
                self.assertEqual(row['action'], 'disable')
            journal.mutate('mesh-agent', 'disable', apply, lambda: {'verified': True})
            self.assertFalse(journal.pending_intents())
        with self.journal(boot='boot-a') as reopened:
            self.assertEqual(reopened.records[-1]['event'], 'verified')
            with self.assertRaisesRegex(Refused, 'reopened'):
                reopened.require_forward()
        for path in self.root.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_failed_fsync_never_calls_mutation(self):
        applied = []
        with self.journal(PRIOR, boot='boot-a') as journal:
            with patch('preservation_journal.os.fsync', side_effect=OSError('owned fault')):
                with self.assertRaises(OSError):
                    journal.mutate('mesh-agent', 'disable', lambda: applied.append(True), lambda: {'verified': True})
            self.assertFalse(applied)
            self.assertEqual(len(journal.records), 1)
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()

    def test_directory_sync_failure_cannot_overwrite_an_intent(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            with patch('preservation_journal.sync_dir', side_effect=OSError('owned directory fault')):
                with self.assertRaises(OSError):
                    journal.mutate('mesh-agent', 'disable', lambda: self.fail('must not run'), lambda: {'verified': True})
            persisted = (self.root / '000001.json').read_bytes()
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.append('anything')
            self.assertEqual((self.root / '000001.json').read_bytes(), persisted)
        with self.journal(boot='boot-a') as reopened:
            self.assertEqual(len(reopened.pending_intents()), 1)
            with self.assertRaisesRegex(Refused, 'only restore'):
                reopened.require_forward()

    def test_failed_verification_refuses_followup_mutation(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            with self.assertRaisesRegex(Refused, 'verified evidence'):
                journal.mutate('mesh-agent', 'disable', lambda: None, lambda: False)
            self.assertEqual(journal.records[-1]['event'], 'failed')
            with self.assertRaisesRegex(Refused, 'only restore'):
                journal.mutate('nats', 'unload', lambda: self.fail('must not run'), lambda: {'verified': True})

    def test_reboot_refuses_preservation_but_restores_original_state(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'disable', lambda: None, lambda: {'verified': True})
        restored = []
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        with self.journal(boot='boot-b') as journal:
            with self.assertRaisesRegex(Refused, 'reboot'):
                journal.require_forward()
            def restore(unit, prior):
                restored.append((unit, prior)); current[unit].update(prior)
            result = journal.recover(restore,
                                     lambda unit, prior: {**current[unit], 'verified': True}, lambda: {'verified': True})
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
root,state,ready,node_lock=map(pathlib.Path,sys.argv[1:5])
prior={'mesh-agent':json.loads(sys.argv[5])}
with Journal(root,prior,boot='boot-a',node_lock=node_lock) as journal:
 def apply():
  with state.open('w') as f:
   json.dump({**prior['mesh-agent'],'loaded':False,'running':False,'disabled':True},f);f.flush();os.fsync(f.fileno())
  ready.write_text('after-mutation-before-verification')
  while True:time.sleep(1)
 journal.mutate('mesh-agent','disable-and-unload',apply,lambda:{'verified':True})
'''
        ready = pathlib.Path(self.temp.name) / 'ready'
        child = subprocess.Popen([sys.executable, '-c', source, str(self.root), str(state), str(ready), str(self.node_lock), json.dumps(PRIOR['mesh-agent'])],
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
            with self.journal(boot='boot-b') as journal:
                self.assertEqual(len(journal.pending_intents()), 1)
                def restore(unit, prior):
                    intent = json.loads(max(self.root.glob('[0-9]*.json')).read_text())
                    self.assertEqual(intent['action'], 'restore-prior')
                    state.write_text(json.dumps(prior))
                result = journal.recover(restore,
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
        with self.journal(PRIOR, boot='boot-a'):
            result = subprocess.run([sys.executable, '-c',
                'from preservation_journal import Journal; import sys; Journal(sys.argv[1],node_lock=sys.argv[2])', str(self.root), str(self.node_lock)],
                cwd=HERE, capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('another process owns', result.stderr)

    def test_corruption_and_missing_record_refuse_replay(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.append('observation', verified=True)
        path = self.root / '000001.json'
        row = json.loads(path.read_text())
        row['verified'] = False
        path.write_text(json.dumps(row))
        with self.journal() as journal:
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True}, lambda _: None)
            self.assertFalse(result['restored'])
            self.assertTrue(result['services_verified'])
        path.rename(self.root / '000002.json')
        with self.journal() as journal:
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()

    def test_owner_privacy_and_symlinks_are_refused(self):
        with self.journal(PRIOR, boot='boot-a'):
            pass
        path = self.root / '000000.json'
        real = self.root / 'retained-original'
        path.rename(real)
        path.symlink_to(real)
        with self.journal() as journal:
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()

    def test_recovery_requires_original_states_and_dependency_order(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'unload', lambda: None, lambda: {'verified': True})
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True})
            resumed = []
            result = journal.recover( lambda unit, prior: resumed.append(unit),
                                     lambda unit, prior: {**prior, 'running': False, 'verified': True},
                                     lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(resumed, ['nats'])
            self.assertEqual(result['errors'][-1]['reason'], 'bus recovery was not verified')

    def test_recovery_observes_reboot_restored_units_without_restarting_them(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'unload', lambda: None, lambda: {'verified': True})
        with self.journal(boot='boot-b') as journal:
            result = journal.recover( lambda *args: self.fail('already restored unit was restarted'),
                                     lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertTrue(any(r['event'] == 'already-restored' for r in journal.records))

    def test_final_physical_hold_and_readiness_failure_is_not_restoration(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True})
            result = journal.recover( lambda *args: self.fail('ready bus was restarted'),
                                     lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': False})
            self.assertFalse(result['restored'])
            self.assertEqual(result['errors'][0]['unit'], 'final-state')

    def test_reboot_restores_a_worker_with_no_stop_intent(self):
        with self.journal(PRIOR):
            pass
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        restored = []
        with self.journal(boot='boot-b') as journal:
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            result = journal.recover(restore, lambda unit, prior: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
        self.assertTrue(result['restored'])
        self.assertEqual(restored, ['mesh-agent'])

    def test_final_hold_check_runs_even_when_bus_recovery_fails(self):
        final = []
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda *_: None,
                lambda unit, prior: {**prior, 'running': False, 'verified': True},
                lambda: final.append(True) or {'verified': False})
        self.assertFalse(result['restored'])
        self.assertEqual(final, [True])
        self.assertTrue(any(e['unit'] == 'final-state' for e in result['errors']))

    def test_tail_truncation_cannot_resume_a_window_or_skip_baseline_units(self):
        with self.journal(PRIOR) as journal:
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True})
        for name in ('000001.json', '000002.json'):
            (self.root / name).unlink()
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        restored = []
        with self.journal() as journal:
            with self.assertRaisesRegex(Refused, 'reopened'):
                journal.require_forward()
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            result = journal.recover(restore, lambda unit, prior: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
        self.assertTrue(result['restored'])
        self.assertEqual(restored, ['nats'])

    def test_member_one_is_read_only_and_unknown_units_do_not_block_other_recovery(self):
        prior = copy.deepcopy(PRIOR)
        prior['nats-1'] = {**copy.deepcopy(PRIOR['nats']), 'class': 'held',
                           'disabled': True, 'loaded': False, 'running': False}
        prior['unknown'] = copy.deepcopy(PRIOR['mesh-agent'])
        current = copy.deepcopy(prior)
        current['mesh-agent'].update(loaded=False, running=False)
        restored = []
        with self.journal(prior) as journal:
            with self.assertRaisesRegex(Refused, 'held or unknown'):
                journal.mutate('nats-1', 'enable', lambda: self.fail('held member changed'), lambda: {'verified': True})
            self.assertFalse(journal.pending_intents())
            def restore(unit, wanted):
                restored.append(unit)
                current[unit].update(wanted)
            result = journal.recover(restore, lambda unit, wanted: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
        self.assertFalse(result['restored'])
        self.assertEqual(restored, ['mesh-agent'])
        self.assertTrue(any(e['unit'] == 'unknown' for e in result['errors']))

    def test_full_disk_restores_baseline_without_claiming_durable_success(self):
        current = copy.deepcopy(PRIOR)
        for state in current.values():
            state.update(loaded=False, running=False)
        restored, diagnostics, final = [], [], []
        with self.journal(PRIOR) as journal:
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            with patch('preservation_journal.os.fsync', side_effect=OSError(errno.ENOSPC, 'owned full disk')):
                result = journal.recover(restore, lambda unit, prior: {**current[unit], 'verified': True},
                    lambda: final.append(True) or {'verified': True}, diagnostics.append)
            self.assertFalse(result['restored'])
            self.assertTrue(result['services_verified'])
            self.assertFalse(result['evidence_durable'])
            self.assertEqual(restored, ['nats', 'mesh-agent'])
            self.assertEqual(final, [True])
            self.assertTrue(diagnostics)
            self.assertNotIn('identity', json.dumps(diagnostics))
            with self.assertRaises(Refused):
                journal.require_forward()

    def test_different_journal_roots_share_one_node_lock(self):
        other = pathlib.Path(self.temp.name) / 'other-journal'
        with self.journal(PRIOR) as journal:
            with self.assertRaisesRegex(Refused, 'node preservation lock'):
                self.journal(PRIOR, root=other)
            self.assertFalse(other.exists())
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                            lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
        with self.journal(PRIOR, root=other):
            pass

    def test_immutable_entry_or_plist_changes_are_not_restored(self):
        current = copy.deepcopy(PRIOR)
        current['mesh-agent']['identity']['files']['/owned/mesh-agent'] = '2' * 64
        current['mesh-agent'].update(loaded=False, running=False)
        final = []
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda *_: self.fail('changed release was started'),
                lambda unit, prior: {**current[unit], 'verified': True},
                lambda: final.append(True) or {'verified': True})
        self.assertFalse(result['restored'])
        self.assertEqual(final, [True])
        self.assertEqual(result['errors'][0]['unit'], 'mesh-agent')

    def test_every_stop_stage_recovers_the_whole_baseline_in_dependency_order(self):
        names = ('nats', 'nats-2', 'nats-3', 'mesh-task-daemon', 'mesh-agent')
        prior = {name: copy.deepcopy(PRIOR['mesh-agent']) for name in names}
        stages = (('mesh-agent',), ('mesh-agent', 'nats-2'),
                  ('mesh-agent', 'nats-2', 'nats-3'), names)
        for index, changed in enumerate(stages):
            with self.subTest(stage=changed):
                current = copy.deepcopy(prior)
                for name in changed:
                    current[name].update(loaded=False, running=False)
                restored = []
                with self.journal(prior, root=pathlib.Path(self.temp.name) / str(index)) as journal:
                    def restore(unit, wanted):
                        restored.append(unit)
                        current[unit].update(wanted)
                    result = journal.recover(restore, lambda unit, wanted: {**current[unit], 'verified': True},
                                             lambda: {'verified': True})
                self.assertTrue(result['restored'])
                self.assertEqual(current, prior)
                self.assertEqual(restored, [name for name in names if name in changed])

    def test_missing_primary_baseline_uses_validated_copy_without_success_claim(self):
        with self.journal(PRIOR):
            pass
        (self.root / '000000.json').unlink()
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with self.journal() as journal:
            result = journal.recover(lambda unit, prior: current[unit].update(prior),
                lambda unit, prior: {**current[unit], 'verified': True}, lambda: {'verified': True}, lambda _: None)
        self.assertFalse(result['restored'])
        self.assertTrue(result['services_verified'])
        self.assertEqual(current, PRIOR)
        with self.assertRaisesRegex(Refused, 'unresolved'):
            self.journal(PRIOR, root=pathlib.Path(self.temp.name) / 'new-window')

    def test_an_unresolved_window_blocks_a_new_root_until_strict_recovery(self):
        with self.journal(PRIOR):
            pass
        other = pathlib.Path(self.temp.name) / 'later-window'
        with self.assertRaisesRegex(Refused, 'unresolved'):
            self.journal(PRIOR, root=other)
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
        with self.journal(PRIOR, root=other):
            pass

    def test_running_timer_or_stopped_daemon_cannot_be_a_new_baseline(self):
        for index, kind in enumerate(('timer', 'daemon')):
            state = copy.deepcopy(PRIOR['mesh-agent'])
            state.update({'class': kind, 'running': kind == 'timer'})
            with self.assertRaisesRegex(Refused, 'desired service state'):
                self.journal({'mesh-agent': state}, root=pathlib.Path(self.temp.name) / str(index))

    def test_known_broken_running_state_is_unconstrained_and_not_restarted(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent']['class'] = 'known-broken'
        with self.journal(prior) as journal:
            result = journal.recover(lambda *_: self.fail('known-broken loop was restarted'),
                lambda unit, state: {**state, 'running': unit == 'nats', 'verified': True}, lambda: {'verified': True})
        self.assertTrue(result['restored'])

    def test_sealed_journal_has_a_pinned_head_and_cannot_be_changed_or_reopened(self):
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                            lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            digest = journal.seal()
            self.assertEqual(digest, json.loads(max(self.root.glob('[0-9]*.json')).read_text())['sha256'])
            with self.assertRaisesRegex(Refused, 'sealed'):
                journal.append('late-change')
        with self.assertRaisesRegex(Refused, 'sealed'):
            self.journal()

    def test_missing_prior_record_prevents_a_later_window_from_inheriting_its_receipt(self):
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                            lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
        (self.root / '000001.json').unlink()
        with self.assertRaisesRegex(Refused, 'sequence has a gap'):
            self.journal(PRIOR, root=pathlib.Path(self.temp.name) / 'later-window')

    def test_failed_node_restoration_receipt_cannot_be_sealed(self):
        from preservation_journal import write_private
        with self.journal(PRIOR) as journal:
            def write(path, value):
                if value.get('status') == 'restored':
                    raise OSError(errno.EIO, 'owned receipt fault')
                return write_private(path, value)
            with patch('preservation_journal.write_private', side_effect=write):
                result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertTrue(result['services_verified'])
            with self.assertRaisesRegex(Refused, 'receipt is not durable'):
                journal.seal()

    def test_restoring_after_a_forward_failure_does_not_accept_the_failed_window(self):
        with self.journal(PRIOR) as journal:
            with self.assertRaises(Refused):
                journal.mutate('mesh-agent', 'unload', lambda: None, lambda: {'verified': False})
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            with self.assertRaisesRegex(Refused, 'failed forward window'):
                journal.seal()

    def test_closed_journal_cannot_restore_without_node_lock(self):
        journal = self.journal(PRIOR)
        journal.close()
        with self.assertRaisesRegex(Refused, 'node lock'):
            journal.recover(lambda *_: self.fail('unlocked mutation'), lambda *_: {}, lambda: {'verified': True})

    def test_mac_boot_identity_uses_uuid_and_fullsync_flushes_file_and_directory(self):
        from preservation_journal import boot_identity, sync_dir, sync_fd
        with patch('preservation_journal.sys.platform', 'darwin'), \
             patch('preservation_journal.subprocess.check_output', return_value='owned-uuid\n') as command:
            with patch.dict(os.environ, {'TZ': 'UTC'}):
                first = boot_identity()
            with patch.dict(os.environ, {'TZ': 'America/Montreal'}):
                self.assertEqual(boot_identity(), first)
            command.assert_called_with(['/usr/sbin/sysctl', '-n', 'kern.bootsessionuuid'], text=True)
        file = pathlib.Path(self.temp.name) / 'flush'
        file.write_bytes(b'owned')
        fd = os.open(file, os.O_RDONLY)
        try:
            with patch('preservation_journal.sys.platform', 'darwin'), \
                 patch('preservation_journal.fcntl.F_FULLFSYNC', 51, create=True), \
                 patch('preservation_journal.fcntl.fcntl') as flush:
                sync_fd(fd)
                sync_dir(pathlib.Path(self.temp.name))
                self.assertEqual(flush.call_count, 2)
        finally:
            os.close(fd)


if __name__ == '__main__':
    unittest.main()
