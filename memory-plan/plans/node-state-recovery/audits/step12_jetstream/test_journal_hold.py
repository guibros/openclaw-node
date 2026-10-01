import copy
import fcntl
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from journal_hold import ANCHOR, JournaledHold, describe
from legacy_fixture import legacy_journal
from preservation_journal import FULL_NODE_SCOPE, Journal, TIMER_SCOPE, TIMER_UNITS, UNITS, matches


HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE.parents[4] / 'workspace-bin/service_gate.py'
spec = importlib.util.spec_from_file_location('hold_gate', SOURCE)
gate_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate_module)


def inventory():
    prior = {unit: {'class': 'absent', 'loaded': False, 'running': False, 'disabled': False,
                    'identity': {'installed': False}} for unit in UNITS}
    identity = {'plist_sha256': '0' * 64, 'argv': ['/owned/unit'], 'files': {'/owned/unit': '1' * 64},
                'dependencies': {}, 'working_directory': '/'}
    for unit in ('nats', 'mesh-agent', ANCHOR):
        prior[unit] = {'class': 'timer' if unit == ANCHOR else 'daemon', 'loaded': True,
                       'running': unit != ANCHOR, 'disabled': False, 'identity': identity}
    prior['nats-1'] = {**prior['nats'], 'class': 'held', 'loaded': False, 'running': False, 'disabled': True}
    return copy.deepcopy(prior)


class HoldTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-journal-hold-owned-')
        self.root = pathlib.Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.parent = self.root / 'journals'
        self.parent.mkdir(mode=0o700)
        self.journal_root = self.parent / 'owned'
        self.node_lock = self.root / 'node.lock'
        self.gate_root = self.root / 'gate'
        self.pin = gate_module.initialize(self.gate_root)
        self.gate = gate_module.Gate(self.gate_root, self.pin)
        self.prior = inventory()
        self.prior[ANCHOR]['execution_hold'] = describe(self.gate, [ANCHOR])
        self.current = copy.deepcopy(self.prior)
        self.physical = True
        self.calls = []
        self.journal = legacy_journal(self.journal_root, self.prior, boot='owned-boot', node_lock=self.node_lock)
        self.hold = JournaledHold(self.journal, self.gate, self.fast)
        self.children = []

    def tearDown(self):
        self.hold.close()
        self.journal.close()
        self.gate.close()
        for child in self.children:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            for handle in (child.stdout, child.stderr):
                if handle is not None:
                    handle.close()
        self.temp.cleanup()

    def observe(self, unit, prior):
        return {**copy.deepcopy(self.current[unit]), 'verified': self.current[unit].get('verified', True)}

    def final(self):
        return {'verified': self.physical}

    def fast(self):
        return {'verified': self.physical and all(matches(self.current[u], p)
                and self.current[u].get('verified', True) and self.current[u]['identity'] == p['identity']
                for u, p in self.prior.items()), 'baseline_sha256': self.journal.records[0]['sha256']}

    def restore(self, unit, prior):
        self.assertIsNotNone(self.gate.marker(), 'dependency restoration preceded a protective hold')
        self.calls.append(unit)
        self.current[unit] = copy.deepcopy(prior)

    def reopen_controller(self):
        self.hold.close()
        self.journal.close()
        self.gate.close()
        self.gate = gate_module.Gate(self.gate_root, self.prior[ANCHOR]['execution_hold']['pins'])
        self.journal = Journal(self.journal_root, boot='owned-boot', node_lock=self.node_lock)
        self.hold = JournaledHold(self.journal, self.gate, self.fast)

    def intent(self, protective=False):
        return self.journal.append('intent', unit=ANCHOR, action='owned-close', **self.hold._fields(protective))

    def published(self, persist=True, protective=False):
        intent = self.intent(protective)
        self.guard = self.gate.close_for_restoration(intent['hold']['window'], intent['hold']['reason'], 1,
            on_publication=(lambda receipt: self.hold._published(intent, receipt)) if persist else None)
        self.guard.close()
        return intent

    def assert_resolved_only(self):
        result = self.hold.recover(self.restore, self.observe, self.final)
        self.assertTrue(result['restored'], result)
        self.assertIsNone(self.gate.marker())
        with self.assertRaises(Exception):
            self.journal.seal()
        self.assertTrue(self.journal.resolve())

    def test_transfer_ends_original_hold_certification_in_same_process(self):
        self.journal.append('nats-transfer-intent', root_transaction='owned-fixture')
        with self.assertRaisesRegex(Exception, 'ended the certifying execution hold'):
            self.hold.check_forward()
        self.assertTrue(JournaledHold(self.journal, self.gate, self.fast).restore_only)

    def test_raw_journal_cannot_skip_a_baselined_hold(self):
        with self.assertRaisesRegex(Exception, 'forward facade'):
            self.journal.mutate('mesh-agent', 'stop', lambda: self.fail('must not run'), lambda: {'verified': True})
        with self.assertRaisesRegex(Exception, 'recovery facade'):
            self.journal.recover(self.restore, self.observe, self.final)
        self.assertEqual(len(self.journal.records), 1)
        self.assertEqual(self.calls, [])

    @unittest.skipUnless(sys.platform == 'darwin', 'timer commissioning requires the native gate observer')
    def test_five_timer_scope_closes_and_resolves_without_preservation_seal(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-timer-scope-owned-') as place:
            root = pathlib.Path(place).resolve()
            gate_root = root / 'gate'
            pins = gate_module.initialize(gate_root)
            with gate_module.Gate(gate_root, pins) as gate:
                prior = {}
                for unit in TIMER_UNITS:
                    prior[unit] = {'class': 'timer', 'loaded': True, 'running': False,
                                   'disabled': False,
                                   'identity': {'plist_sha256': '0' * 64,
                                                'argv': ['/owned/' + unit],
                                                'files': {'/owned/' + unit: '1' * 64},
                                                'dependencies': {}, 'working_directory': '/'}}
                prior[ANCHOR]['execution_hold'] = describe(gate, sorted(TIMER_UNITS))
                baseline = root / 'journals' / 'timer'
                with Journal(baseline, prior, boot='owned-boot', node_lock=root / 'node.lock',
                             scope=TIMER_SCOPE) as journal:
                    fast = lambda: {'verified': True, 'baseline_sha256': journal.records[0]['sha256']}
                    hold = JournaledHold(journal, gate, fast)
                    try:
                        hold.close_and_drain()
                        self.assertIsNotNone(gate.marker())
                        with self.assertRaisesRegex(Exception, 'cannot mutate'):
                            hold.mutate(ANCHOR, 'close-execution-hold',
                                        lambda: self.fail('must not apply'), lambda: {'verified': True})
                        observe = lambda unit, state: {**copy.deepcopy(state), 'verified': True}
                        result = hold.recover(lambda *_: self.fail('baseline already restored'),
                                              observe, lambda: {'verified': True})
                        self.assertTrue(result['restored'], result)
                        self.assertIsNone(gate.marker())
                        restored = [row for row in journal.records
                                    if row['event'] == 'execution-hold-restored'][-1]
                        self.assertFalse(restored['evidence']['history_certified'])
                        with self.assertRaisesRegex(Exception, 'cannot seal'):
                            journal.seal()
                        journal.resolve()
                    finally:
                        hold.close()

    def test_forward_work_before_close_is_refused(self):
        with self.assertRaisesRegex(Exception, 'original closed observer'):
            self.hold.mutate('mesh-agent', 'copy', lambda: self.fail('must not run'), lambda: {'verified': True})
        self.assertEqual(len(self.journal.records), 1)

    @unittest.skipUnless(sys.platform == 'darwin', 'continuous native observer is a Mac acceptance contract')
    def test_full_scope_hold_completion_does_not_certify_without_process_watch(self):
        self.hold.close_and_drain()
        self.journal.scope = FULL_NODE_SCOPE
        evidence = self.hold.complete(self.observe, self.final)
        self.assertFalse(evidence['history_certified'])
        self.assertTrue(evidence['gate_open'])

    @unittest.skipUnless(sys.platform == 'darwin', 'continuous native observer is a Mac acceptance contract')
    def test_original_native_observer_brackets_every_mutation_and_can_seal(self):
        self.hold.close_and_drain()
        evidence = self.hold.mutate('mesh-agent', 'copy', lambda: self.calls.append('copy'), lambda: {'verified': True})
        self.assertEqual(evidence['execution_hold']['watch_session_id'], self.hold.original_session)
        self.assertTrue(self.hold.recover(self.restore, self.observe, self.final)['restored'])
        self.assertTrue(self.journal.seal())

    @unittest.skipUnless(sys.platform == 'darwin', 'continuous native observer is a Mac acceptance contract')
    def test_marker_change_during_a_forward_operation_never_verifies_or_seals(self):
        self.hold.close_and_drain()
        def apply():
            (self.gate_root / 'closed.json').write_text(json.dumps({'window': 'bad', 'reason': 'bad'}))
        with self.assertRaises(Exception):
            self.hold.mutate('mesh-agent', 'copy', apply, lambda: {'verified': True})
        self.assertEqual(self.journal.records[-1]['event'], 'failed')
        with self.assertRaises(Exception):
            self.hold.mutate('mesh-agent', 'copy', lambda: self.fail('must not run'), lambda: {'verified': True})

    def test_intent_only_open_ready_is_ambiguous_and_never_certified(self):
        self.intent()
        self.reopen_controller()
        self.assert_resolved_only()
        row = next(row for row in self.journal.records if row['event'] == 'hold-ambiguous-open-ready')
        self.assertFalse(row['history_certified'])
        self.assertFalse(any(row['event'] == 'hold-published' for row in self.journal.records))

    def test_intent_only_open_unready_protects_before_dependency_restoration(self):
        self.intent()
        self.current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        self.reopen_controller()
        self.assert_resolved_only()
        self.assertEqual(self.calls, ['mesh-agent'])
        self.assertTrue(any(row.get('hold', {}).get('protective') for row in self.journal.records))

    def test_intent_only_partial_readiness_protects_but_does_not_open(self):
        self.intent()
        self.current['mesh-agent']['verified'] = False
        self.reopen_controller()
        result = self.hold.recover(self.restore, self.observe, self.final)
        self.assertFalse(result['restored'])
        self.assertIsNotNone(self.gate.marker())
        self.assertEqual(self.calls, [])
        self.assertEqual(self.journal.active['status'], 'unresolved')

    def test_ambiguous_open_ready_service_loss_is_protected_before_later_mutation(self):
        self.intent()
        self.reopen_controller()
        observe = self.observe
        reads = []
        def changed(unit, prior):
            if unit == 'mesh-agent':
                reads.append(unit)
                if len(reads) == 2:
                    self.current[unit].update(loaded=False, running=False, disabled=True)
            return observe(unit, prior)
        result = self.hold.recover(self.restore, changed, self.final)
        self.assertTrue(result['restored'], result)
        self.assertEqual(self.calls, ['mesh-agent'])
        self.assertIsNone(self.gate.marker())
        self.assertTrue(any(row.get('hold', {}).get('protective') for row in self.journal.records))

    def test_publication_gap_adopts_only_unique_matching_intent_for_restoration(self):
        self.published(persist=False)
        self.reopen_controller()
        self.hold.prepare(self.observe, self.final)
        evidence = self.hold.guard.check()
        self.assertTrue(evidence['restoration_only'])
        self.assertNotIn('verified', evidence)
        self.assertNotIn('watch_session_id', evidence)
        self.assertTrue(self.journal.records[-2]['adopted_for_restoration'])
        with self.assertRaisesRegex(Exception, 'cannot certify'):
            self.hold.mutate('mesh-agent', 'copy', lambda: self.fail('must not run'), lambda: {'verified': True})

    def test_persisted_receipt_missing_marker_always_gets_a_protective_new_hold(self):
        old = self.published()
        os.unlink(self.gate_root / 'closed.json')
        self.reopen_controller()
        self.hold.prepare(self.observe, self.final)
        self.assertNotEqual(self.gate.marker()['window'], old['hold']['window'])
        self.assertEqual(len(self.hold.intents()[1]), 1)
        self.assertTrue(self.hold.guard.check()['restoration_only'])

    def test_matching_saved_receipt_is_reattached_only_for_restoration(self):
        self.published()
        self.reopen_controller()
        self.assert_resolved_only()
        self.assertEqual(sum(row['event'] == 'hold-published' for row in self.journal.records), 1)

    def test_unowned_marker_refuses_all_dependency_mutation(self):
        with self.gate.close_for_restoration('foreign', 'foreign', 1):
            pass
        self.reopen_controller()
        with self.assertRaisesRegex(Exception, 'unique matching durable intent'):
            self.hold.recover(self.restore, self.observe, self.final)
        self.assertEqual(self.calls, [])
        self.assertIsNotNone(self.gate.marker())

    def test_mismatched_marker_refuses_receipt_gap_adoption(self):
        self.intent()
        with self.gate.close_for_restoration('other', 'other', 1):
            pass
        self.reopen_controller()
        with self.assertRaisesRegex(Exception, 'unique matching durable intent'):
            self.hold.recover(self.restore, self.observe, self.final)
        self.assertEqual(self.calls, [])

    def test_competing_intents_and_duplicate_nonce_are_refused(self):
        first = self.intent()
        self.intent()
        with self.assertRaisesRegex(Exception, 'competing live'):
            self.hold.prepare(self.observe, self.final)
        self.journal.append('hold-superseded', intent=first['sequence'])
        self.journal.append('intent', unit=ANCHOR, action='collision', hold=first['hold'])
        with self.assertRaisesRegex(Exception, 'duplicate execution hold window'):
            self.hold.prepare(self.observe, self.final)
        self.assertEqual(self.calls, [])

    def test_invalid_timer_cohort_refuses_without_gate_mutation(self):
        for cohort in ([], ['mesh-agent'], [ANCHOR, ANCHOR]):
            with self.subTest(cohort=cohort), self.assertRaises(Exception):
                describe(self.gate, cohort)
        self.assertIsNone(self.gate.marker())

    def test_lock_ctime_and_metadata_substitution_cannot_recapture_pins(self):
        for target in ('gate.lock', 'identity.json'):
            with self.subTest(target=target):
                path = self.gate_root / target
                path.chmod(0o600)
                with self.assertRaises(Exception):
                    self.hold.prepare(self.observe, self.final)
        self.assertEqual(self.calls, [])

    def test_saved_root_pin_difference_is_refused(self):
        self.hold.saved['pins']['root'] = '0:0'
        with self.assertRaisesRegex(Exception, 'baseline changed'):
            self.hold.prepare(self.observe, self.final)
        self.assertEqual(self.calls, [])

    def test_final_physical_failure_keeps_a_drained_hold_closed(self):
        self.published()
        self.reopen_controller()
        self.physical = False
        result = self.hold.recover(self.restore, self.observe, self.final)
        self.assertFalse(result['restored'])
        self.assertIsNotNone(self.gate.marker())
        self.assertFalse(any(row['event'] == 'hold-reopen-intent' for row in self.journal.records))

    def test_full_baseline_unmutated_worker_readiness_is_required(self):
        self.published()
        self.reopen_controller()
        self.current['mesh-agent']['verified'] = False
        result = self.hold.recover(self.restore, self.observe, self.final)
        self.assertFalse(result['restored'])
        self.assertIsNotNone(self.gate.marker())

    def test_fast_recheck_is_under_exclusive_lock_and_can_refuse_reopen(self):
        self.published()
        self.reopen_controller()
        def fast():
            fd = os.open(self.gate_root / 'gate.lock', os.O_RDONLY)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
            finally:
                os.close(fd)
            return {'verified': False, 'baseline_sha256': self.hold.baseline}
        self.hold.fast_check = fast
        result = self.hold.recover(self.restore, self.observe, self.final)
        self.assertFalse(result['restored'])
        self.assertIsNotNone(self.gate.marker())

    def fault_event(self, event, operation):
        original = self.journal.append
        def append(name, **data):
            if name == event:
                with patch('preservation_journal.sync_fd', side_effect=OSError('owned durable fault')):
                    return original(name, **data)
            return original(name, **data)
        with patch.object(self.journal, 'append', side_effect=append):
            with self.assertRaises(Exception):
                operation()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.journal.active['status'], 'unresolved')

    def test_failed_mark_failed_performs_zero_dependency_mutations(self):
        self.intent()
        self.current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        self.reopen_controller()
        self.fault_event('failed', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertIsNone(self.gate.marker())

    def test_failed_protective_intent_never_publishes_or_mutates_dependencies(self):
        self.intent()
        self.current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        self.reopen_controller()
        self.fault_event('intent', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertIsNone(self.gate.marker())

    def test_failed_publication_receipt_keeps_hold_closed_and_blocks_dependencies(self):
        self.intent()
        self.current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        self.reopen_controller()
        self.fault_event('hold-published', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertIsNotNone(self.gate.marker())

    def test_failed_reopen_intent_keeps_hold_closed(self):
        self.published()
        self.reopen_controller()
        self.fault_event('hold-reopen-intent', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertIsNotNone(self.gate.marker())

    def test_failed_supersession_does_not_create_competing_protective_intents(self):
        self.published()
        os.unlink(self.gate_root / 'closed.json')
        self.reopen_controller()
        self.fault_event('hold-superseded', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertEqual(len(self.hold.intents()[1]), 1)
        self.assertIsNone(self.gate.marker())

    def test_failed_full_reopen_readiness_record_keeps_hold_closed(self):
        self.published()
        self.reopen_controller()
        self.fault_event('hold-reopen-ready', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertIsNotNone(self.gate.marker())

    def test_failed_final_readiness_record_never_reopens(self):
        self.published()
        self.reopen_controller()
        self.fault_event('final-state-verified', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertIsNotNone(self.gate.marker())

    def test_failed_post_unlink_record_is_unresolved_and_recovery_recloses(self):
        self.published()
        self.reopen_controller()
        self.fault_event('hold-opened', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertIsNone(self.gate.marker())
        self.reopen_controller()
        self.hold.prepare(self.observe, self.final)
        self.assertIsNotNone(self.gate.marker())
        self.assertEqual(len(self.hold.intents()[1]), 1)

    def test_restore_intent_write_failure_aborts_without_degraded_service_mutations(self):
        self.published()
        self.reopen_controller()
        self.current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        self.fault_event('restoration-intent', lambda: self.hold.recover(self.restore, self.observe, self.final))
        self.assertIsNotNone(self.gate.marker())

    def controller(self, phase):
        self.hold.close()
        self.journal.close()
        self.gate.close()
        ready = self.root / 'controller-ready'
        source = '''import importlib.util,json,pathlib,sys,time
from preservation_journal import Journal
from journal_hold import JournaledHold,ANCHOR
root,gate_root,node_lock,ready=map(pathlib.Path,sys.argv[1:5])
spec=importlib.util.spec_from_file_location('gate',sys.argv[5]);g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
phase=sys.argv[6]
def wait():
 ready.write_text(phase)
 while True:time.sleep(.02)
with Journal(root,boot='owned-boot',node_lock=node_lock) as journal:
 with g.Gate(gate_root,journal.prior[ANCHOR]['execution_hold']['pins']) as gate:
  hold=JournaledHold(journal,gate,lambda:{'verified':True,'baseline_sha256':journal.records[0]['sha256']})
  observe=lambda unit,prior:{**prior,'verified':True}
  append=journal.append
  def checkpoint(event,**data):
   if phase=='before-receipt' and event=='hold-published':wait()
   if phase=='before-reopen' and event=='hold-reopen-intent':wait()
   if phase=='before-protective' and event=='intent':wait()
   value=append(event,**data)
   if phase=='after-protective-intent' and event=='intent':wait()
   if phase=='after-receipt' and event=='hold-published':wait()
   if phase=='after-drain' and event=='hold-restoration-drained':wait()
   if phase=='after-unlink' and event=='hold-opened':wait()
   return value
  journal.append=checkpoint
  hold.recover(lambda *_:None,observe,lambda:{'verified':True})
'''
        child = subprocess.Popen([sys.executable, '-c', source, str(self.journal_root), str(self.gate_root),
                                  str(self.node_lock), str(ready), str(SOURCE), phase], cwd=HERE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        end = time.monotonic() + 5
        while not ready.exists() and child.poll() is None and time.monotonic() < end:
            time.sleep(.01)
        self.assertTrue(ready.exists(), child.stderr.read().decode() if child.poll() is not None else phase)
        child.kill()
        self.assertLess(child.wait(timeout=5), 0)
        ready.unlink()
        self.gate = gate_module.Gate(self.gate_root, self.pin)
        self.journal = Journal(self.journal_root, boot='owned-boot', node_lock=self.node_lock)
        self.hold = JournaledHold(self.journal, self.gate, self.fast)

    def test_killed_owned_controllers_before_receipt_after_receipt_and_after_drain_restore_only(self):
        self.intent(protective=True)
        self.current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        for phase in ('before-protective', 'after-protective-intent', 'before-receipt', 'after-drain',
                      'before-reopen', 'after-unlink'):
            with self.subTest(phase=phase):
                self.controller(phase)
                self.assertLessEqual(len(self.hold.intents()[1]), 1)
                with self.assertRaises(Exception):
                    self.hold.mutate('mesh-agent', 'copy', lambda: self.fail('must not run'), lambda: {'verified': True})
        self.assert_resolved_only()

    def test_killed_owned_controller_after_persisted_receipt_restores_only(self):
        self.intent(protective=True)
        self.controller('after-receipt')
        self.assertEqual(len(self.hold.intents()[1]), 1)
        self.assert_resolved_only()

    def test_real_foreground_survives_controller_death_until_normal_drain(self):
        ready = self.root / 'foreground-ready'
        finish = self.root / 'foreground-finish'
        child = subprocess.Popen([sys.executable, '-I', '-S', str(SOURCE), 'run', str(self.gate_root),
            '--lock', self.pin['lock'], '--root-pin', self.pin['root'], '--', '/bin/sh', '-c',
            'echo ready > "$1"; while [ ! -e "$2" ]; do /bin/sleep .02; done',
            'owned', str(ready), str(finish)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        end = time.monotonic() + 5
        while not ready.exists() and child.poll() is None and time.monotonic() < end:
            time.sleep(.01)
        self.assertTrue(ready.exists())
        self.intent(protective=True)
        self.controller('after-receipt')
        self.assertIsNone(child.poll())
        self.hold.seconds = .05
        with self.assertRaisesRegex(Exception, 'did not drain'):
            self.hold.recover(self.restore, self.observe, self.final)
        self.assertEqual(self.calls, [])
        finish.touch(mode=0o600)
        self.assertEqual(child.wait(timeout=5), 0)
        self.reopen_controller()
        self.assert_resolved_only()

    def test_real_foreground_straggler_blocks_recovery_before_any_dependency_mutation(self):
        ready = self.root / 'foreground-ready'
        child = subprocess.Popen([sys.executable, '-I', '-S', str(SOURCE), 'run', str(self.gate_root),
            '--lock', self.pin['lock'], '--root-pin', self.pin['root'], '--', '/bin/sh', '-c',
            'echo ready > "$1"; exec /bin/sleep 30', 'owned', str(ready)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        end = time.monotonic() + 5
        while not ready.exists() and child.poll() is None and time.monotonic() < end:
            time.sleep(.01)
        self.assertTrue(ready.exists())
        self.intent()
        self.current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        self.reopen_controller()
        self.hold.seconds = .05
        with self.assertRaisesRegex(Exception, 'did not drain'):
            self.hold.recover(self.restore, self.observe, self.final)
        self.assertEqual(self.calls, [])
        self.assertIsNotNone(self.gate.marker())
        self.assertIsNone(child.poll())
        child.kill()
        child.wait(timeout=5)
        self.reopen_controller()
        self.assert_resolved_only()


@unittest.skipUnless(sys.platform == 'darwin', 'timer recovery requires the native gate observer')
class TimerScopeReopenTests(unittest.TestCase):
    def exercise(self, remove_marker):
        with tempfile.TemporaryDirectory(prefix='openclaw-timer-reopen-owned-') as place:
            root = pathlib.Path(place).resolve()
            gate_root = root / 'gate'
            pins = gate_module.initialize(gate_root)
            journal_root = root / 'journals/timer'
            node_lock = root / 'node.lock'
            prior = {}
            for unit in TIMER_UNITS:
                prior[unit] = {'class': 'timer', 'loaded': True, 'running': False,
                               'disabled': False,
                               'identity': {'plist_sha256': '0' * 64, 'argv': ['/owned/' + unit],
                                            'files': {'/owned/' + unit: '1' * 64},
                                            'dependencies': {}, 'working_directory': '/'}}
            with gate_module.Gate(gate_root, pins) as gate:
                prior[ANCHOR]['execution_hold'] = describe(gate, sorted(TIMER_UNITS))
                with Journal(journal_root, prior, boot='owned-boot', node_lock=node_lock,
                             scope=TIMER_SCOPE) as journal:
                    fast = lambda: {'verified': True, 'baseline_sha256': journal.records[0]['sha256']}
                    hold = JournaledHold(journal, gate, fast)
                    try:
                        hold.close_and_drain()
                    finally:
                        hold.close()
            if remove_marker:
                (gate_root / 'closed.json').unlink()
            with gate_module.Gate(gate_root, pins) as gate:
                with Journal(journal_root, boot='owned-boot', node_lock=node_lock) as journal:
                    self.assertTrue(journal.reopened)
                    fast = lambda: {'verified': True, 'baseline_sha256': journal.records[0]['sha256']}
                    hold = JournaledHold(journal, gate, fast)
                    try:
                        observe = lambda unit, state: {**copy.deepcopy(state), 'verified': True}
                        result = hold.recover(lambda *_: self.fail('timer baseline should match'),
                                              observe, lambda: {'verified': True})
                        self.assertTrue(result['restored'], result)
                        self.assertIsNone(gate.marker())
                        restored = [row for row in journal.records
                                    if row['event'] == 'execution-hold-restored'][-1]
                        self.assertTrue(restored['evidence']['restored_only'])
                        self.assertFalse(restored['evidence']['history_certified'])
                        if remove_marker:
                            self.assertTrue(any(row.get('hold', {}).get('protective')
                                                for row in journal.records))
                        self.assertTrue(journal.resolve())
                    finally:
                        hold.close()

    def test_closed_marker_reattaches_restore_only(self):
        self.exercise(False)

    def test_missing_marker_gets_protective_restore_only_close(self):
        self.exercise(True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
