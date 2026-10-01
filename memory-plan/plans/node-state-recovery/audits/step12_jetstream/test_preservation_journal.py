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

from preservation_journal import FULL_NODE_SCOPE, Journal, Refused, TIMER_SCOPE, TIMER_UNITS, UNITS, encoded, matches, valid_record
from legacy_fixture import legacy_journal


HERE = pathlib.Path(__file__).resolve().parent
def inventory(active):
    prior = {name: {'loaded': False, 'running': False, 'disabled': False,
                    'class': 'absent', 'identity': {'installed': False}} for name in UNITS}
    for unit, state in active.items():
        prior[unit] = {'loaded': True, 'running': True, 'disabled': False, 'class': 'daemon',
                       'identity': {'plist_sha256': '0' * 64, 'argv': ['/owned/' + unit],
                                    'files': {'/owned/' + unit: '1' * 64}, 'dependencies': {},
                                    'working_directory': '/'}, **state}
    prior['nats-1'] = {**copy.deepcopy(prior['nats']), 'class': 'held',
                       'loaded': False, 'running': False, 'disabled': True}
    return prior


PRIOR = inventory({'nats': {}, 'mesh-agent': {}})


def timer_inventory():
    prior = {}
    for unit in TIMER_UNITS:
        prior[unit] = {'loaded': True, 'running': False, 'disabled': False,
                       'class': 'timer',
                       'identity': {'plist_sha256': '0' * 64, 'argv': ['/owned/' + unit],
                                    'files': {'/owned/' + unit: '1' * 64}, 'dependencies': {},
                                    'working_directory': '/'}}
    prior['scheduler-heartbeat']['execution_hold'] = {'cohort': sorted(TIMER_UNITS)}
    return prior


def full_node_inventory():
    prior = inventory({unit: {} for unit in UNITS if unit not in ('nats-1', 'federation-tick')})
    for unit in TIMER_UNITS:
        prior[unit].update(running=False, **{'class': 'timer'})
    prior['scheduler-heartbeat']['execution_hold'] = {'cohort': sorted(TIMER_UNITS)}
    prior['mesh-agent'].update(running=False, **{'class': 'on-demand'})
    prior['mesh-tool-discord']['class'] = 'known-broken'
    prior['federation-tick'] = {'loaded': False, 'running': False, 'disabled': True,
        'class': 'unloaded', 'identity': {
            'plist_sha256': '0' * 64, 'argv': ['/owned/federation-tick'],
            'files': {'/owned/federation-tick': '1' * 64}, 'dependencies': {},
            'working_directory': '/'}}
    return prior


def full_entrypoint_evidence(prior):
    return {'verified': True,
            'installed': {'ai.openclaw.' + unit: {
                'path': '/owned/' + unit + '.plist',
                'sha256': state['identity']['plist_sha256']}
                for unit, state in prior.items()},
            'loaded': {'gui': sorted('ai.openclaw.' + unit for unit, state in prior.items()
                                   if state['loaded']), 'user': [], 'system': []},
            'roots': ['/owned'], 'disabled_artifacts': {}}


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-journal-owned-')
        self.parent = pathlib.Path(self.temp.name) / 'journals'
        self.parent.mkdir(mode=0o700)
        self.root = self.parent / 'journal'
        self.node_lock = pathlib.Path(self.temp.name) / 'node.lock'

    def journal(self, prior=None, boot='boot-a', root=None):
        if prior is not None:
            return legacy_journal(root or self.root, prior, boot=boot, node_lock=self.node_lock)
        return Journal(root or self.root, boot=boot, node_lock=self.node_lock)

    def test_new_unscoped_journal_refuses_before_creation(self):
        with self.assertRaisesRegex(Refused, 'explicit protected scope'):
            Journal(self.root, PRIOR, node_lock=self.node_lock)
        self.assertFalse(self.root.exists())

    def test_full_scope_cannot_skip_entrypoint_preflight(self):
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=Refused('unclassified loaded job')):
            with self.assertRaisesRegex(Refused, 'unclassified loaded job'):
                Journal(self.root, full_node_inventory(), node_lock=self.node_lock,
                        scope=FULL_NODE_SCOPE)
        self.assertFalse(self.root.exists())

    def test_full_scope_rechecks_entrypoints_before_forward_or_restore(self):
        prior = full_node_inventory()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                with patch('preservation_journal.capture_entrypoint_inventory',
                           side_effect=Refused('unclassified loaded job')):
                    with self.assertRaisesRegex(Refused, 'unclassified loaded job'):
                        journal.mutate('gateway', 'stop',
                                       lambda: self.fail('mutation reached'),
                                       lambda: self.fail('verification reached'))
                    with self.assertRaisesRegex(Refused, 'unclassified loaded job'):
                        journal.recover(lambda *_: self.fail('restore reached'),
                                        lambda *_: self.fail('observe reached'),
                                        lambda: self.fail('final check reached'))
                self.assertEqual([row['event'] for row in journal.records], ['baseline'])

    def tearDown(self):
        self.temp.cleanup()

    def test_production_scope_requires_every_approved_entry_and_saved_hold(self):
        prior = full_node_inventory()
        for unit in ('gateway', 'workplan-viewer', 'federation-tick'):
            with self.subTest(unit=unit):
                changed = copy.deepcopy(prior)
                changed[unit] = {'loaded': False, 'running': False, 'disabled': False,
                                 'class': 'absent', 'identity': {'installed': False}}
                with self.assertRaisesRegex(Refused, 'approved cohort'):
                    Journal(self.parent / ('refuse-' + unit), changed, node_lock=self.node_lock,
                            scope=FULL_NODE_SCOPE)
        changed = copy.deepcopy(prior)
        del changed['scheduler-heartbeat']['execution_hold']
        with self.assertRaisesRegex(Refused, 'execution hold'):
            Journal(self.parent / 'refuse-no-hold', changed, node_lock=self.node_lock,
                    scope=FULL_NODE_SCOPE)
        changed = copy.deepcopy(prior)
        changed['federation-tick']['disabled'] = False
        with self.assertRaisesRegex(Refused, 'must remain disabled'):
            Journal(self.parent / 'refuse-enabled-tick', changed, node_lock=self.node_lock,
                    scope=FULL_NODE_SCOPE)
        evidence = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory', return_value=evidence):
            with Journal(self.root, prior, boot='boot-a', node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                self.assertEqual(journal.scope, FULL_NODE_SCOPE)
                self.assertEqual(len(journal.prior), 23)
                self.assertEqual(journal.check_entrypoints(final=True), evidence)
        with self.journal() as reopened:
            self.assertEqual(reopened.scope, FULL_NODE_SCOPE)
            changed = copy.deepcopy(evidence)
            changed['loaded']['gui'].remove('ai.openclaw.gateway')
            with patch('preservation_journal.capture_entrypoint_inventory', return_value=changed):
                with self.assertRaisesRegex(Refused, 'were not restored'):
                    reopened.check_entrypoints(final=True)

    def test_full_inventory_covers_gateway_viewer_and_installed_unloaded_tick(self):
        self.assertTrue({'gateway', 'workplan-viewer', 'federation-tick'} <= UNITS)
        prior = copy.deepcopy(PRIOR)
        prior['federation-tick'] = {'loaded': False, 'running': False, 'disabled': True,
            'class': 'unloaded', 'identity': {
                'plist_sha256': '0' * 64, 'argv': ['/owned/federation-tick'],
                'files': {'/owned/federation-tick': '1' * 64}, 'dependencies': {},
                'working_directory': '/'}}
        with legacy_journal(self.root, prior, boot='boot-a', node_lock=self.node_lock) as journal:
            with self.assertRaisesRegex(Refused, 'held or unknown unit'):
                journal.mutate('federation-tick', 'stop', lambda: self.fail('must not mutate'),
                               lambda: {'verified': True})
        with self.journal() as reopened:
            current = copy.deepcopy(prior)
            current['federation-tick']['loaded'] = True
            restored = []
            result = reopened.recover(lambda *args: restored.append(args),
                lambda unit, saved: {**current[unit], 'verified': True},
                lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(result['errors'][0]['unit'], 'federation-tick')
            self.assertEqual(restored, [])
            self.assertFalse(any(row['event'] == 'unloaded-unit-verified'
                                 for row in reopened.records))
            current['federation-tick']['loaded'] = False
            current['federation-tick']['disabled'] = False
            result = reopened.recover(lambda *args: restored.append(args),
                lambda unit, saved: {**current[unit], 'verified': True},
                lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(result['errors'][0]['unit'], 'federation-tick')
            self.assertEqual(restored, [])
            current['federation-tick']['disabled'] = True
            result = reopened.recover(lambda *args: restored.append(args),
                lambda unit, saved: {**current[unit], 'verified': True},
                lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertEqual(restored, [])
            self.assertTrue(any(row['event'] == 'unloaded-unit-verified'
                                for row in reopened.records))

    def test_timer_commissioning_scope_is_durable_and_cannot_mutate_or_seal(self):
        with Journal(self.root, timer_inventory(), boot='boot-a', node_lock=self.node_lock,
                     scope=TIMER_SCOPE) as journal:
            self.assertEqual(journal.scope, TIMER_SCOPE)
            self.assertEqual(journal.records[0]['scope'], TIMER_SCOPE)
            with self.assertRaisesRegex(Refused, 'cannot mutate'):
                journal.mutate('observer', 'disable', lambda: self.fail('must not apply'),
                               lambda: {'verified': True})
            with self.assertRaisesRegex(Refused, 'cannot seal'):
                journal.seal()
            self.assertEqual(len(journal.records), 1)
        with self.journal(boot='boot-a') as reopened:
            self.assertEqual(reopened.scope, TIMER_SCOPE)
            self.assertEqual(set(reopened.prior), TIMER_UNITS)
            with self.assertRaisesRegex(Refused, 'cannot seal'):
                reopened.seal()

    def test_timer_subset_requires_explicit_scope_and_exact_cohort(self):
        with self.assertRaisesRegex(Refused, 'inventory'):
            self.journal(timer_inventory())
        prior = timer_inventory()
        prior.pop('observer')
        with self.assertRaisesRegex(Refused, 'inventory'):
            Journal(self.root, prior, node_lock=self.node_lock, scope=TIMER_SCOPE)
        prior = timer_inventory()
        prior['scheduler-heartbeat']['execution_hold']['cohort'].remove('observer')
        with self.assertRaisesRegex(Refused, 'omits a scheduled entry'):
            Journal(self.root, prior, node_lock=self.node_lock, scope=TIMER_SCOPE)

    def test_resolved_timer_scope_chains_to_full_node_baseline(self):
        with Journal(self.root, timer_inventory(), boot='boot-a', node_lock=self.node_lock,
                     scope=TIMER_SCOPE) as timer:
            finished = timer.append('recovery-finished', services_verified=True, errors=[])
            timer._state({**timer.active, 'status': 'restored', 'head': finished['sha256']})
            predecessor = timer.resolve()
        prior = full_node_inventory()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.parent / 'full-node', prior, boot='boot-a',
                         node_lock=self.node_lock, scope=FULL_NODE_SCOPE) as full:
                self.assertEqual(full.scope, FULL_NODE_SCOPE)
                self.assertEqual(set(full.prior), UNITS)
                self.assertEqual(full.records[0]['predecessor'],
                                 {'root': str(self.root.resolve()), 'head': predecessor})

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

    def test_failure_evidence_survives_reopen_before_service_restoration(self):
        raw = {'kernel_events': [{'ident': 123, 'filter': -10, 'flags': 0,
                                  'fflags': 0, 'data': 0}], 'bootout': None}
        with self.journal(PRIOR, boot='boot-a') as journal:
            def apply():
                raise Refused('owned refusal')
            with self.assertRaisesRegex(Refused, 'owned refusal'):
                journal.mutate('mesh-agent', 'stop', apply, lambda: self.fail('must not verify'),
                               failure_evidence=lambda error: raw)
        with self.journal(boot='boot-a') as reopened:
            self.assertEqual(reopened.records[-1]['event'], 'failed')
            self.assertEqual(reopened.records[-1]['evidence'], raw)
            self.assertEqual(reopened.records[-1]['error_type'], 'Refused')
            with self.assertRaisesRegex(Refused, 'reopened'):
                reopened.require_forward()

    def test_non_string_dictionary_keys_refuse_before_writing_a_poisoned_record(self):
        with self.journal(PRIOR) as journal:
            with self.assertRaisesRegex(TypeError, 'keys must be strings'):
                journal.append('owned-negative', evidence={'exits': {9998: {}, 10001: {}}})
            self.assertEqual(len(journal.records), 1)
            self.assertFalse((self.root / '000001.json').exists())
        with self.journal() as reopened:
            self.assertFalse(reopened.write_failed)
            self.assertEqual(len(reopened.records), 1)
        with self.assertRaisesRegex(TypeError, 'keys must be strings'):
            encoded({'nested': ([{'exits': {9998: {}, 10001: {}}}],)})

    def test_mixed_width_process_keys_survive_verified_and_failed_record_reopen(self):
        for action in ('verified', 'failed'):
            with self.subTest(action=action):
                root = self.parent / action
                evidence = {'verified': True, 'exits': {'9998': {'wait_status': 0},
                            '10001': {'wait_status': 0}},
                            'process_contracts': {'9998': {'allowed_signals': []},
                                                  '10001': {'allowed_signals': []}}}
                with self.journal(PRIOR, root=root) as journal:
                    def apply():
                        if action == 'failed':
                            raise Refused('owned stop failed')
                    if action == 'verified':
                        journal.mutate('mesh-agent', 'stop', apply, lambda: evidence)
                    else:
                        with self.assertRaisesRegex(Refused, 'owned stop failed'):
                            journal.mutate('mesh-agent', 'stop', apply, lambda: self.fail('must not verify'),
                                           failure_evidence=lambda error: evidence)
                with self.journal(root=root) as reopened:
                    self.assertFalse(reopened.write_failed)
                    self.assertEqual(len(reopened.records), 3)
                    self.assertEqual(reopened.records[-1]['event'], action)
                    self.assertEqual(reopened.records[-1]['evidence'], evidence)
                    for row in reopened.records:
                        valid_record(row)
                    result = reopened.recover(lambda *_: self.fail('ready owner must not restart'),
                        lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
                    self.assertTrue(result['restored'])
                    reopened.resolve()


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
from legacy_fixture import legacy_journal
root,state,ready,node_lock=map(pathlib.Path,sys.argv[1:5])
prior=json.loads(sys.argv[5])
with legacy_journal(root,prior,boot='boot-a',node_lock=node_lock) as journal:
 def apply():
  with state.open('w') as f:
   json.dump({**prior['mesh-agent'],'loaded':False,'running':False,'disabled':True},f);f.flush();os.fsync(f.fileno())
  ready.write_text('after-mutation-before-verification')
  while True:time.sleep(1)
 journal.mutate('mesh-agent','disable-and-unload',apply,lambda:{'verified':True})
'''
        ready = pathlib.Path(self.temp.name) / 'ready'
        child = subprocess.Popen([sys.executable, '-c', source, str(self.root), str(state), str(ready), str(self.node_lock), json.dumps(PRIOR)],
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
                                         lambda unit, prior: {**(json.loads(state.read_text()) if unit == 'mesh-agent' else prior), 'verified': True},
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

    def test_member_one_is_read_only_and_unknown_units_are_refused_at_creation(self):
        prior = copy.deepcopy(PRIOR)
        with self.journal(prior) as journal:
            with self.assertRaisesRegex(Refused, 'held or unknown'):
                journal.mutate('nats-1', 'enable', lambda: self.fail('held member changed'), lambda: {'verified': True})
            self.assertFalse(journal.pending_intents())
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            journal.resolve()
        prior['unknown'] = copy.deepcopy(PRIOR['mesh-agent'])
        with self.assertRaisesRegex(Refused, 'inventory'):
            self.journal(prior, root=self.parent / 'unknown')

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
        other = self.parent / 'other-journal'
        with self.journal(PRIOR) as journal:
            with self.assertRaisesRegex(Refused, 'node preservation lock'):
                self.journal(PRIOR, root=other)
            self.assertFalse(other.exists())
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                            lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            journal.resolve()
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
        prior = inventory({name: {} for name in names})
        stages = (('mesh-agent',), ('mesh-agent', 'nats-2'),
                  ('mesh-agent', 'nats-2', 'nats-3'), names)
        for index, changed in enumerate(stages):
            with self.subTest(stage=changed):
                current = copy.deepcopy(prior)
                for name in changed:
                    current[name].update(loaded=False, running=False)
                restored = []
                with self.journal(prior, root=self.parent / str(index)) as journal:
                    def restore(unit, wanted):
                        restored.append(unit)
                        current[unit].update(wanted)
                    result = journal.recover(restore, lambda unit, wanted: {**current[unit], 'verified': True},
                                             lambda: {'verified': True})
                self.assertTrue(result['restored'])
                self.assertEqual(current, prior)
                self.assertEqual(restored, [name for name in names if name in changed])
                with self.journal(root=self.parent / str(index)) as journal:
                    journal.recover(lambda *_: self.fail('ready owner restarted'), lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                    journal.resolve()

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
            self.journal(PRIOR, root=self.parent / 'new-window')

    def test_an_unresolved_window_blocks_a_new_root_until_strict_recovery(self):
        with self.journal(PRIOR):
            pass
        other = self.parent / 'later-window'
        with self.assertRaisesRegex(Refused, 'unresolved'):
            self.journal(PRIOR, root=other)
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            journal.resolve()
        with self.journal(PRIOR, root=other):
            pass

    def test_running_timer_or_stopped_daemon_cannot_be_a_new_baseline(self):
        for index, kind in enumerate(('timer', 'daemon')):
            state = copy.deepcopy(PRIOR['mesh-agent'])
            state.update({'class': kind, 'running': kind == 'timer'})
            with self.assertRaisesRegex(Refused, 'desired service state'):
                self.journal(inventory({'nats': {}, 'mesh-agent': state}), root=self.parent / str(index))

    def test_idle_on_demand_worker_is_an_exact_restoration_baseline(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'on-demand', 'running': False})
        self.assertTrue(matches(prior['mesh-agent'], prior['mesh-agent']))
        self.assertFalse(matches({**prior['mesh-agent'], 'running': True}, prior['mesh-agent']))
        with self.journal(prior) as journal:
            self.assertEqual(journal.prior['mesh-agent'], prior['mesh-agent'])
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('idle worker was restarted'),
                lambda unit, state: {**state, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['services_verified'])
            journal.resolve()

    def test_on_demand_class_refuses_a_running_or_unrelated_owner(self):
        for index, (unit, running) in enumerate((('mesh-agent', True), ('nats', False))):
            prior = copy.deepcopy(PRIOR)
            prior[unit].update({'class': 'on-demand', 'running': running})
            with self.assertRaisesRegex(Refused, 'desired service state'):
                self.journal(prior, root=self.parent / str(index))
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'known-broken', 'running': False})
        with self.assertRaisesRegex(Refused, 'optional integration'):
            self.journal(prior, root=self.parent / 'misclassified-worker')

    def test_running_on_demand_worker_is_not_a_restoration_target(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'on-demand', 'running': False})
        restored = []
        with self.journal(prior) as journal:
            result = journal.recover(lambda unit, _: restored.append(unit),
                lambda unit, state: {**state, 'running': True if unit == 'mesh-agent' else state['running'],
                                     'verified': True},
                lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(restored, [])
            self.assertIn({'unit': 'mesh-agent', 'reason': 'Refused'}, result['errors'])
            self.assertFalse(any(row['event'] == 'restoration-intent' and row.get('unit') == 'mesh-agent'
                                 for row in journal.records))

    def test_known_broken_running_state_is_unconstrained_and_not_restarted(self):
        prior = inventory({'nats': {}, 'mesh-tool-discord': {'class': 'known-broken', 'running': False}})
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
            self.journal(PRIOR, root=self.parent / 'later-window')

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

    def test_missing_receipt_refuses_new_root_but_intact_primary_restores(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        receipt.unlink()
        with self.assertRaisesRegex(Refused, 'missing'):
            self.journal(PRIOR, root=self.parent / 'another')
        self.assertFalse((self.parent / 'another').exists())
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        restored = []
        with self.journal() as journal:
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            result = journal.recover(restore, lambda unit, prior: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertEqual(restored, ['mesh-agent'])
            journal.resolve()
        with self.journal(PRIOR, root=self.parent / 'another'):
            pass

    def test_corrupt_receipt_is_retained_and_primary_restoration_rebuilds_copy(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        receipt.write_bytes(b'{corrupt')
        with self.assertRaisesRegex(Refused, 'corrupt'):
            self.journal(PRIOR, root=self.parent / 'another')
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
        saved = list(receipt.parent.glob('.corrupt-receipt-*'))
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0].read_bytes(), b'{corrupt')

    def test_unsupported_intact_baseline_refuses_without_quarantining_receipt(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        original = receipt.read_bytes()
        with patch('preservation_journal.valid_prior', side_effect=Refused('service class is absent')):
            with self.assertRaisesRegex(Refused, 'service class is absent'):
                self.journal()
        self.assertEqual(receipt.read_bytes(), original)
        self.assertEqual(list(receipt.parent.glob('.corrupt-receipt-*')), [])
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            journal.resolve()

    def test_crash_between_terminal_record_and_receipt_reconciles_without_reopening_window(self):
        for index, terminal in enumerate(('seal', 'resolve')):
            root = self.parent / ('terminal-' + str(index))
            with self.journal(PRIOR, root=root) as journal:
                journal.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
                with patch('preservation_journal.write_private', side_effect=OSError(errno.EIO, 'receipt gap')):
                    with self.assertRaises(OSError):
                        getattr(journal, terminal)()
            with self.assertRaisesRegex(Refused, 'sealed or resolved'):
                self.journal(root=root)
            state = json.loads(self.node_lock.with_name(self.node_lock.name + '.state.json').read_bytes())
            self.assertEqual(state['head'], json.loads(max(root.glob('[0-9]*.json')).read_bytes())['sha256'])
        with self.journal(PRIOR, root=self.parent / 'new'):
            pass

    def test_incomplete_inventory_and_held_daemon_cannot_create_a_window(self):
        with self.assertRaisesRegex(Refused, 'inventory'):
            self.journal({'nats': PRIOR['nats']})
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'held', 'loaded': False, 'running': False, 'disabled': True})
        with self.assertRaisesRegex(Refused, 'only member-1'):
            self.journal(prior)
        self.assertFalse(self.root.exists())

    def test_loaded_busy_timer_is_never_restored_and_can_be_reobserved(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'timer', 'running': False})
        current = copy.deepcopy(prior)
        current['mesh-agent']['running'] = True
        with self.journal(prior) as journal:
            result = journal.recover(lambda *_: self.fail('busy timer restarted'),
                lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True})
            self.assertFalse(result['restored'])
            current['mesh-agent']['running'] = False
            result = journal.recover(lambda *_: self.fail('ready timer restarted'),
                lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])

    def test_unserializable_observation_keeps_restoring_and_never_claims_durability(self):
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        diagnostics, restored, final = [], [], []
        with self.journal(PRIOR) as journal:
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            result = journal.recover(restore,
                lambda unit, wanted: {**current[unit], 'verified': True, 'not_json': {'owned'}},
                lambda: final.append(True) or {'verified': True}, diagnostics.append)
            self.assertEqual(restored, ['mesh-agent'])
            self.assertEqual(final, [True])
            self.assertFalse(result['restored'])
            self.assertTrue(result['services_verified'])
            self.assertFalse(result['evidence_durable'])
            self.assertTrue(diagnostics)

    def test_static_identity_is_required_and_stays_available_when_unloaded(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent']['identity'] = {'pid': 123}
        with self.assertRaisesRegex(Refused, 'static identity schema'):
            self.journal(prior)
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda unit, wanted: current[unit].update(wanted),
                lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])

    def test_identity_hashes_static_files_and_dependency_targets_without_loaded_job(self):
        import plistlib
        from preservation_journal import static_identity
        parent = pathlib.Path(self.temp.name)
        binary, entry, dependency = (parent / name for name in ('binary', 'entry.py', 'dependency.py'))
        for path in (binary, entry, dependency):
            path.write_bytes(b'owned original')
        alias = parent / 'dependency-link.py'
        alias.symlink_to(dependency)
        unit = parent / 'owned.plist'
        raw = plistlib.dumps({'ProgramArguments': [str(binary), str(entry)]})
        unit.write_bytes(raw)
        before = static_identity(unit, (entry,), {'owned': alias})
        unit.write_bytes(raw)
        self.assertEqual(static_identity(unit, (entry,), {'owned': alias}), before)
        dependency.write_bytes(b'owned changed')
        self.assertNotEqual(static_identity(unit, (entry,), {'owned': alias}), before)
        self.assertEqual(before['dependencies']['owned'], str(dependency.resolve()))
        self.assertEqual(before['working_directory'], '/')

    def test_receipt_readback_mismatch_prevents_forward_mutation(self):
        from preservation_journal import read_private
        def read(path):
            value = read_private(path)
            return {**value, 'status': 'restored'} if path.name.endswith('.state.json') else value
        with patch('preservation_journal.read_private', side_effect=read):
            with self.assertRaisesRegex(Refused, 'readback differs'):
                self.journal(PRIOR)
        self.assertFalse(self.root.exists())

    def test_receipt_write_failure_has_no_false_restored_claim_in_the_chain(self):
        from preservation_journal import read_private, write_private
        with self.journal(PRIOR) as journal:
            def write(path, value):
                if value.get('status') == 'restored':
                    raise OSError(errno.EIO, 'receipt write failure')
                return write_private(path, value)
            with patch('preservation_journal.write_private', side_effect=write):
                result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True}, lambda _: None)
            self.assertFalse(result['restored'])
            self.assertNotIn('restored', journal.records[-1])
            self.assertTrue(journal.records[-1]['services_verified'])
            self.assertEqual(read_private(journal.node_state)['status'], 'unresolved')

    def test_arbitrary_journal_parent_is_refused(self):
        with self.assertRaisesRegex(Refused, 'fixed persistent parent'):
            self.journal(PRIOR, root=pathlib.Path(self.temp.name) / 'escape')

    def test_lost_receipt_and_full_disk_still_allow_degraded_primary_restoration(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        receipt.unlink()
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with patch('preservation_journal.write_private', side_effect=OSError(errno.ENOSPC, 'owned full disk')):
            with self.journal() as journal:
                result = journal.recover(lambda unit, wanted: current[unit].update(wanted),
                    lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True}, lambda _: None)
                self.assertFalse(result['restored'])
                self.assertTrue(result['services_verified'])
                self.assertFalse(result['evidence_durable'])
        with self.assertRaisesRegex(Refused, 'missing'):
            self.journal(PRIOR, root=self.parent / 'another')

    def test_corrupt_receipt_retention_failure_still_restores_without_overwriting_it(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        receipt.write_bytes(b'{owned-corrupt')
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with patch('preservation_journal.os.rename', side_effect=OSError(errno.ENOSPC, 'cannot retain receipt')):
            with self.journal() as journal:
                result = journal.recover(lambda unit, wanted: current[unit].update(wanted),
                    lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True}, lambda _: None)
                self.assertFalse(result['restored'])
                self.assertTrue(result['services_verified'])
                self.assertFalse(result['evidence_durable'])
        self.assertEqual(receipt.read_bytes(), b'{owned-corrupt')

    def test_all_explicitly_absent_units_are_observed_without_installed_state_inference(self):
        prior = {unit: {'loaded': False, 'running': False, 'disabled': False, 'class': 'absent',
                        'identity': {'installed': False}} for unit in UNITS}
        observed = set()
        with self.journal(prior) as journal:
            def observe(unit, wanted):
                observed.add(unit)
                return {**wanted, 'verified': True}
            result = journal.recover(lambda *_: self.fail('absent unit installed'), observe, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertEqual(observed, UNITS)

    def test_existing_missing_receipt_with_two_unfinished_roots_is_ambiguous(self):
        from preservation_journal import write_private
        with self.journal(PRIOR) as journal:
            baseline, receipt = journal.records[0], journal.node_state
        other = self.parent / 'orphan'
        other.mkdir(mode=0o700)
        write_private(other / '000000.json', baseline)
        receipt.unlink()
        with self.assertRaisesRegex(Refused, 'ambiguous'):
            self.journal()

    def test_a_restored_but_unfinalized_window_cannot_be_superseded(self):
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
        with self.assertRaisesRegex(Refused, 'explicit finalization'):
            self.journal(PRIOR, root=self.parent / 'another')
        with self.journal() as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            journal.resolve()
        with self.journal(PRIOR, root=self.parent / 'another'):
            pass

    def test_lost_receipt_after_finalization_is_rebuilt_only_from_lineage_tip(self):
        roots = [self.parent / name for name in ('first', 'second')]
        for root in roots:
            with self.journal(PRIOR, root=root) as journal:
                journal.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                journal.seal()
                receipt = journal.node_state
        receipt.unlink()
        with self.assertRaisesRegex(Refused, 'current journal'):
            self.journal(root=roots[0])
        with self.assertRaisesRegex(Refused, 'sealed or resolved'):
            self.journal(root=roots[1])
        with self.journal(PRIOR, root=self.parent / 'third'):
            pass

    def test_a_terminal_receipt_gap_is_repaired_directly_before_the_next_window(self):
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            with patch('preservation_journal.write_private', side_effect=OSError(errno.EIO, 'receipt gap')):
                with self.assertRaises(OSError):
                    journal.seal()
        head = max(self.root.glob('[0-9]*.json')).read_bytes()
        with self.journal(PRIOR, root=self.parent / 'next'):
            pass
        self.assertEqual(max(self.root.glob('[0-9]*.json')).read_bytes(), head)

    def test_creation_interruptions_before_mkdir_and_after_baseline_are_restore_only(self):
        from preservation_journal import write_private
        for index, boundary in enumerate(('receipt', 'mkdir', 'baseline')):
            parent = pathlib.Path(self.temp.name) / ('creation-' + str(index))
            parent.mkdir(mode=0o700)
            root, lock = parent / 'journals/window', parent / 'node.lock'
            with legacy_journal(parent / 'journals/previous', PRIOR, boot='a', node_lock=lock) as previous:
                previous.recover(lambda *_: self.fail('previous ready owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                previous.seal()
            real_mkdir = pathlib.Path.mkdir
            def mkdir(path, *args, **kwargs):
                value = real_mkdir(path, *args, **kwargs)
                if path == root and boundary == 'mkdir':
                    raise OSError(errno.EIO, 'interrupted after mkdir')
                return value
            def write(path, value):
                write_private(path, value)
                if ((boundary == 'receipt' and value.get('phase') == 'initializing')
                        or (boundary == 'baseline' and path.name == '000000.json')):
                    raise OSError(errno.EIO, 'interrupted after durable setup write')
            with patch('preservation_journal.write_private', side_effect=write), \
                 patch('preservation_journal.pathlib.Path.mkdir', autospec=True, side_effect=mkdir):
                with self.assertRaises(OSError):
                    legacy_journal(root, PRIOR, boot='a', node_lock=lock)
            with Journal(root, boot='b', node_lock=lock) as journal:
                with self.assertRaisesRegex(Refused, 'reboot|reopened'):
                    journal.require_forward()
                result = journal.recover(lambda *_: self.fail('unchanged setup owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                self.assertTrue(result['restored'])
                journal.resolve()
            with legacy_journal(parent / 'journals/next', PRIOR, boot='b', node_lock=lock):
                pass

    def test_setup_repair_full_disk_restores_from_the_prepared_receipt(self):
        from preservation_journal import write_private
        def write(path, value):
            write_private(path, value)
            if value.get('phase') == 'initializing':
                raise OSError(errno.EIO, 'crash before mkdir')
        with patch('preservation_journal.write_private', side_effect=write):
            with self.assertRaises(OSError):
                self.journal(PRIOR)
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with patch('preservation_journal.write_private', side_effect=OSError(errno.ENOSPC, 'setup disk full')):
            with self.journal() as journal:
                result = journal.recover(lambda unit, wanted: current[unit].update(wanted),
                    lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True}, lambda _: None)
                self.assertTrue(result['services_verified'])
                self.assertFalse(result['evidence_durable'])
                self.assertFalse(result['restored'])

    def test_finder_metadata_is_ignored_but_unknown_entries_refuse_cleanly(self):
        (self.parent / '.DS_Store').write_bytes(b'owned Finder metadata')
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            journal.seal()
        with self.journal(PRIOR, root=self.parent / 'second') as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            journal.resolve()
        (self.parent / 'unknown-file').write_bytes(b'unknown')
        with self.assertRaisesRegex(Refused, 'unexpected entry'):
            self.journal(PRIOR, root=self.parent / 'third')

    def test_initializing_finder_metadata_preserves_restore_only_recovery(self):
        from preservation_journal import write_private
        for index, boundary in enumerate(('receipt', 'mkdir', 'baseline')):
            parent = pathlib.Path(self.temp.name) / ('finder-setup-' + str(index))
            parent.mkdir(mode=0o700)
            root, lock = parent / 'journals/window', parent / 'node.lock'
            with legacy_journal(parent / 'journals/previous', PRIOR, boot='a', node_lock=lock) as previous:
                previous.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                previous.seal()
            real_mkdir = pathlib.Path.mkdir
            def mkdir(path, *args, **kwargs):
                value = real_mkdir(path, *args, **kwargs)
                if path == root and boundary == 'mkdir':
                    raise OSError(errno.EIO, 'interrupted after mkdir')
                return value
            def write(path, value):
                write_private(path, value)
                if ((boundary == 'receipt' and value.get('phase') == 'initializing')
                        or (boundary == 'baseline' and path.name == '000000.json')):
                    raise OSError(errno.EIO, 'interrupted setup')
            with patch('preservation_journal.write_private', side_effect=write), \
                 patch('preservation_journal.pathlib.Path.mkdir', autospec=True, side_effect=mkdir):
                with self.assertRaises(OSError):
                    legacy_journal(root, PRIOR, boot='a', node_lock=lock)
            root.mkdir(mode=0o700, exist_ok=True)
            metadata = root / '.DS_Store'
            metadata.write_bytes(b'owned Finder metadata')
            with Journal(root, boot='b', node_lock=lock) as journal:
                with self.assertRaisesRegex(Refused, 'reboot|reopened'):
                    journal.require_forward()
                self.assertTrue(journal.recover(lambda *_: self.fail('unchanged owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})['restored'])
                journal.resolve()
            self.assertEqual(metadata.read_bytes(), b'owned Finder metadata')
            with legacy_journal(parent / 'journals/next', PRIOR, boot='b', node_lock=lock):
                pass

    def test_initializing_metadata_links_owners_and_unknown_entries_remain_fenced(self):
        from preservation_journal import write_private
        for index, kind in enumerate(('link', 'directory', 'foreign-owner', 'unknown')):
            parent = pathlib.Path(self.temp.name) / ('finder-refusal-' + str(index))
            parent.mkdir(mode=0o700)
            root, lock = parent / 'journals/window', parent / 'node.lock'
            def write(path, value):
                write_private(path, value)
                if value.get('phase') == 'initializing':
                    raise OSError(errno.EIO, 'interrupted setup')
            with patch('preservation_journal.write_private', side_effect=write):
                with self.assertRaises(OSError):
                    legacy_journal(root, PRIOR, boot='a', node_lock=lock)
            root.mkdir(mode=0o700)
            metadata = root / ('.DS_Store' if kind != 'unknown' else 'unknown-file')
            if kind == 'link':
                target = parent / 'outside'
                target.write_bytes(b'owned target')
                metadata.symlink_to(target)
            elif kind == 'directory':
                metadata.mkdir(mode=0o700)
            else:
                metadata.write_bytes(b'owned metadata')
            real_lstat = pathlib.Path.lstat
            def lstat(path):
                info = real_lstat(path)
                if path == metadata and kind == 'foreign-owner':
                    fields = list(info)
                    fields[4] = os.getuid() + 1
                    return os.stat_result(fields)
                return info
            with patch('preservation_journal.pathlib.Path.lstat', autospec=True, side_effect=lstat):
                with self.assertRaisesRegex(Refused, 'Finder metadata|unknown files'):
                    Journal(root, boot='b', node_lock=lock)
                next_root = parent / 'journals/next'
                with self.assertRaisesRegex(Refused, 'prior node recovery is unresolved'):
                    legacy_journal(next_root, PRIOR, boot='b', node_lock=lock)
                self.assertFalse(next_root.exists())
            self.assertTrue(os.path.lexists(metadata))

    def test_static_identity_hashes_entry_and_config_arguments_without_extra_files(self):
        import plistlib
        from preservation_journal import static_identity
        parent = pathlib.Path(self.temp.name)
        binary, entry, config = (parent / name for name in ('node', 'entry.js', 'nats.conf'))
        for path in (binary, entry, config):
            path.write_bytes(b'owned original')
        unit = parent / 'owned.plist'
        unit.write_bytes(plistlib.dumps({'ProgramArguments': [str(binary), 'entry.js', '--config', str(config)],
                                        'WorkingDirectory': str(parent)}))
        before = static_identity(unit)
        entry.write_bytes(b'changed entry')
        after_entry = static_identity(unit)
        self.assertNotEqual(after_entry, before)
        config.write_bytes(b'changed config')
        self.assertNotEqual(static_identity(unit), after_entry)
        with self.assertRaisesRegex(Refused, 'resolved entry files'):
            static_identity(unit, dependencies={'package': parent})

    def test_static_identity_binds_the_resolved_working_directory(self):
        import plistlib
        from preservation_journal import static_identity
        parent = pathlib.Path(self.temp.name)
        binary = parent / 'node'
        binary.write_bytes(b'owned binary')
        first, second, alias = (parent / name for name in ('first-cwd', 'second-cwd', 'cwd'))
        first.mkdir(); second.mkdir(); alias.symlink_to(first, target_is_directory=True)
        unit = parent / 'owned.plist'
        unit.write_bytes(plistlib.dumps({'ProgramArguments': [str(binary)], 'WorkingDirectory': str(alias)}))
        before = static_identity(unit)
        alias.unlink(); alias.symlink_to(second, target_is_directory=True)
        self.assertNotEqual(static_identity(unit), before)

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
