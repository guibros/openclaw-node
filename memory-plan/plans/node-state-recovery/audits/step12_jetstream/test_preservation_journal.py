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
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from preservation_journal import CommittedRefusal, FULL_NODE_SCOPE, Journal, NATS_TRANSFER_UNITS, Refused, TIMER_SCOPE, TIMER_UNITS, UNITS, encoded, matches, valid_record
import preservation_journal
from preservation_checks import TAILSCALE_BINARY, TAILSCALE_LABEL, TAILSCALE_PLIST, TAILSCALE_WRAPPER
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
            'roots': ['/owned'], 'disabled_artifacts': {}, 'excluded': {}}


def tailscale_record():
    return {TAILSCALE_LABEL: {
        'plist': {'path': str(TAILSCALE_PLIST), 'sha256': '2' * 64},
        'wrapper': {'path': str(TAILSCALE_WRAPPER), 'sha256': '3' * 64},
        'app': {'path': str(TAILSCALE_BINARY), 'sha256': '4' * 64,
                'bundle_id': 'io.tailscale.ipn.macsys', 'version': '1.0',
                'team_id': 'W5364U7YZB', 'cdhash': '5' * 40},
        'launchd': {'domain': 'system', 'state': 'not running',
                    'runs': 1, 'last_exit_code': 0, 'disabled': False}, 'boot': '6' * 64}}


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-journal-owned-')
        self.parent = pathlib.Path(self.temp.name) / 'journals'
        self.parent.mkdir(mode=0o700)
        self.root = self.parent / 'journal'
        self.node_lock = pathlib.Path(self.temp.name) / 'node.lock'
        self.nats_marker = pathlib.Path(self.temp.name) / 'writer-handoff.json'
        self.nats_lock = pathlib.Path(self.temp.name) / 'writer.lock'
        self.nats_lock.write_bytes(b'owned writer lock')
        self.nats_lock.chmod(0o644)
        for name, path in (('NATS_WRITER_MARKER', self.nats_marker),
                           ('NATS_LEGACY_LOCK', self.nats_lock)):
            guarded = patch.object(preservation_journal, name, path)
            guarded.start()
            self.addCleanup(guarded.stop)
        root_uid = patch.object(preservation_journal, 'NATS_ROOT_UID', os.getuid())
        root_uid.start()
        self.addCleanup(root_uid.stop)

    def journal(self, prior=None, boot='boot-a', root=None):
        if prior is not None:
            return legacy_journal(root or self.root, prior, boot=boot, node_lock=self.node_lock)
        return Journal(root or self.root, boot=boot, node_lock=self.node_lock)

    def prepared_nats_transfer(self, excluded=None):
        prior = full_node_inventory()
        loaded = full_entrypoint_evidence(prior)
        loaded['excluded'] = copy.deepcopy(excluded or {})
        inventory_patch = patch('preservation_journal.capture_entrypoint_inventory',
                                side_effect=lambda _: copy.deepcopy(loaded))
        inventory_patch.start()
        self.addCleanup(inventory_patch.stop)
        marker = self.parent / 'writer-handoff.json'
        marker_patch = patch('preservation_journal.NATS_WRITER_MARKER', marker)
        marker_patch.start()
        self.addCleanup(marker_patch.stop)
        journal = Journal(self.root, prior, boot='boot-a', node_lock=self.node_lock,
                          scope=FULL_NODE_SCOPE)
        self.addCleanup(journal.close)
        hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
        for unit in ('nats', 'nats-2', 'nats-3'):
            journal.mutate(unit, 'unload',
                           lambda unit=unit: loaded['loaded']['gui'].remove('ai.openclaw.' + unit),
                           lambda: {'verified': True}, hold=hold)
        def observe(unit, saved):
            if unit == 'nats-1':
                return {**saved, 'verified': True}
            return {**saved, 'loaded': False, 'running': False, 'verified': True}
        return journal, hold, observe, marker

    def publish_nats_return(self, journal, transfer, **changes):
        outcomes = pathlib.Path(self.temp.name) / 'root-outcomes'
        outcomes.mkdir(mode=0o755, exist_ok=True)
        outcomes.chmod(0o755)
        outcomes_patch = patch('preservation_journal.NATS_ROOT_OUTCOMES', outcomes)
        uid_patch = patch('preservation_journal.NATS_ROOT_UID', os.getuid())
        outcomes_patch.start()
        uid_patch.start()
        self.addCleanup(outcomes_patch.stop)
        self.addCleanup(uid_patch.stop)
        receipt = {'transaction': transfer['root_transaction'], 'outcome': 'returned',
                   'ledger_sha256': 'f' * 64, 'user_journal_root': str(journal.root.resolve()),
                   'user_baseline_sha256': journal.records[0]['sha256'],
                   'user_transfer_sha256': transfer['sha256'], **changes}
        path = outcomes / (transfer['root_transaction'] + '.json')
        path.write_bytes(encoded(receipt))
        path.chmod(0o644)
        return path

    def test_nats_transfer_freezes_user_journal_before_root_outcome(self):
        journal, hold, observe, _ = self.prepared_nats_transfer()
        transaction = str(uuid.uuid4())
        record = journal.transfer_nats(transaction, hold, observe)
        self.assertEqual(record['root_transaction'], transaction)
        self.assertEqual(record['event'], 'nats-transfer-intent')
        before = len(journal.records)
        with self.assertRaisesRegex(Refused, 'transfer is open'):
            journal.append('failed', reason='late writer')
        with self.assertRaisesRegex(Refused, 'transfer is open'):
            journal.recover(lambda *_: self.fail('legacy restoration ran'),
                            lambda *_: self.fail('observation ran'),
                            lambda: self.fail('readiness ran'), hold=hold)
        self.assertEqual(len(journal.records), before)
        journal.close()
        with Journal(self.root, boot='boot-a', node_lock=self.node_lock) as reopened:
            self.assertEqual(reopened.nats_transfer_open()['sha256'], record['sha256'])
            with self.assertRaisesRegex(Refused, 'transfer is open'):
                reopened.append('recovery-started')

    def test_nats_transfer_refuses_marker_and_uncertified_unit(self):
        journal, hold, observe, marker = self.prepared_nats_transfer()
        before = len(journal.records)
        marker.write_text('{}')
        with self.assertRaisesRegex(Refused, 'marker already exists'):
            journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        marker.unlink()
        with self.assertRaisesRegex(Refused, 'writer is still active'):
            journal.transfer_nats(str(uuid.uuid4()), hold,
                                  lambda unit, saved: {**observe(unit, saved), 'running': unit == 'nats'})
        self.assertEqual(len(journal.records), before)

    def test_nats_return_requires_bound_root_receipt_and_forces_restore_only(self):
        journal, hold, observe, marker = self.prepared_nats_transfer()
        transfer = journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        receipt = self.publish_nats_return(journal, transfer)
        receipt.chmod(0o600)
        with self.assertRaisesRegex(Refused, 'outcome identity differs'):
            journal.complete_nats_outcome()
        receipt.chmod(0o644)
        self.publish_nats_return(journal, transfer, user_transfer_sha256='0' * 64)
        with self.assertRaisesRegex(Refused, 'does not bind'):
            journal.complete_nats_outcome()
        self.publish_nats_return(journal, transfer)
        marker.write_text('{}')
        with self.assertRaisesRegex(Refused, 'marker already exists'):
            journal.complete_nats_outcome()
        marker.unlink()
        closed = journal.complete_nats_outcome()
        self.assertEqual(closed['outcome'], 'returned')
        self.assertIsNone(journal.nats_transfer_open())
        marker.write_text('{}')
        with self.assertRaisesRegex(Refused, 'marker already exists'):
            journal.recover(lambda *_: self.fail('legacy restore ran behind marker'),
                            lambda *_: self.fail('observation ran behind marker'),
                            lambda: self.fail('readiness ran behind marker'), hold=hold)
        marker.unlink()
        with self.assertRaisesRegex(Refused, 'restore-only'):
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True}, hold=hold)
        journal.close()
        with Journal(self.root, boot='boot-a', node_lock=self.node_lock) as reopened:
            self.assertIsNone(reopened.nats_transfer_open())
            with self.assertRaisesRegex(Refused, 'restore-only'):
                reopened.require_forward()

    def test_nats_return_refuses_root_outcome_acl(self):
        journal, hold, observe, _ = self.prepared_nats_transfer()
        transfer = journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        self.publish_nats_return(journal, transfer)
        def listed(argv, **_):
            entry = ' 0: user:operator allow read,write\n' if argv[-1].endswith('.json') else ''
            return subprocess.CompletedProcess(argv, 0, stdout='root outcome\n' + entry)
        with patch.object(preservation_journal.sys, 'platform', 'darwin'), patch.object(
                preservation_journal.subprocess, 'run', side_effect=listed):
            with self.assertRaisesRegex(Refused, 'outcome path has an ACL'):
                journal.complete_nats_outcome()
        self.assertIsNotNone(journal.nats_transfer_open())

    def test_production_transfer_refuses_before_durable_intent(self):
        journal, hold, observe, _ = self.prepared_nats_transfer()
        before = len(journal.records)
        with patch.object(preservation_journal.sys, 'platform', 'darwin'), patch(
                'preservation_journal.NATS_WRITER_MARKER',
                pathlib.Path('/private/var/db/openclaw-nats/writer-handoff.json')):
            with self.assertRaisesRegex(Refused, 'production NATS transfer awaits'):
                journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        self.assertEqual(len(journal.records), before)

    def test_returned_legacy_restore_holds_shared_exclusion_and_checks_marker(self):
        lock = pathlib.Path(self.temp.name) / 'writer.lock'
        lock.write_bytes(b'nonce')
        lock.chmod(0o644)
        marker = pathlib.Path(self.temp.name) / 'writer-handoff.json'
        with patch('preservation_journal.NATS_LEGACY_LOCK', lock), patch(
                'preservation_journal.NATS_WRITER_MARKER', marker), patch(
                'preservation_journal.NATS_ROOT_UID', os.getuid()):
            with preservation_journal.nats_legacy_restore_guard():
                script = ('import fcntl,os,sys; '
                          'f=os.open(sys.argv[1],os.O_RDONLY); '
                          'fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)')
                blocked = subprocess.run([sys.executable, '-c', script, str(lock)],
                                         capture_output=True, text=True)
                self.assertNotEqual(blocked.returncode, 0)
                self.assertIn('BlockingIOError', blocked.stderr)
            marker.write_text('{}')
            with self.assertRaisesRegex(Refused, 'marker already exists'):
                with preservation_journal.nats_legacy_restore_guard():
                    self.fail('legacy restoration entered behind marker')

    def test_absent_or_replaced_legacy_lock_is_checked(self):
        self.nats_lock.unlink()
        with preservation_journal.nats_legacy_restore_guard():
            pass
        with self.assertRaisesRegex(Refused, 'lock appeared during restoration'):
            with preservation_journal.nats_legacy_restore_guard():
                self.nats_lock.write_bytes(b'owned writer lock')
        self.nats_lock.chmod(0o644)
        with self.assertRaisesRegex(Refused, 'writer lock changed during restoration'):
            with preservation_journal.nats_legacy_restore_guard():
                self.nats_lock.unlink()
                self.nats_lock.write_bytes(b'replaced writer lock')
                self.nats_lock.chmod(0o644)

    def test_unscoped_recovery_without_legacy_lock_can_finish(self):
        with self.journal(PRIOR) as journal:
            self.nats_lock.unlink()
            result = journal.recover(lambda *_: self.fail('restoration entered'),
                                     lambda unit, _: {**PRIOR[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertTrue(result['restored'], result)
            journal.resolve()

    def test_marker_before_resolve_row_refuses_without_terminal_commit(self):
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda *_: self.fail('restoration entered'),
                                     lambda unit, _: {**PRIOR[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertTrue(result['restored'], result)
            original = journal.check_entrypoints
            def publish_before_row(*args, **kwargs):
                evidence = original(*args, **kwargs)
                self.nats_marker.write_text('{}')
                return evidence
            with patch.object(journal, 'check_entrypoints', side_effect=publish_before_row):
                with self.assertRaisesRegex(Refused, 'marker already exists'):
                    journal.resolve()
            self.assertEqual(journal.records[-1]['event'], 'recovery-finished')

    def test_resolve_receipt_failure_reports_committed_terminal_row(self):
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda *_: self.fail('restoration entered'),
                                     lambda unit, _: {**PRIOR[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertTrue(result['restored'], result)
            with patch.object(journal, '_state', side_effect=Refused('receipt failed')):
                with self.assertRaisesRegex(CommittedRefusal, 'resolved committed at'):
                    journal.resolve()
            self.assertEqual(journal.records[-1]['event'], 'resolved')

    def test_marker_before_legacy_restart_prevents_the_restart(self):
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            original = journal.append
            restored = []
            def append(event, **data):
                row = original(event, **data)
                if event == 'restoration-intent' and data.get('unit') == 'nats':
                    self.nats_marker.write_text('{}')
                return row
            with patch.object(journal, 'append', side_effect=append):
                result = journal.recover(lambda unit, _: restored.append(unit),
                                         lambda unit, _: {**current[unit], 'verified': True},
                                         lambda: {'verified': True})
            self.assertEqual(restored, [])
            nats_error = next(error for error in result['errors'] if error['unit'] == 'nats')
            self.assertNotIn('after_commit', nats_error)

    def test_lock_appearing_before_legacy_restart_prevents_the_restart(self):
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            self.nats_lock.unlink()
            original = journal.append
            restored = []
            def append(event, **data):
                row = original(event, **data)
                if event == 'restoration-intent' and data.get('unit') == 'nats':
                    self.nats_lock.write_bytes(b'new root lock')
                return row
            with patch.object(journal, 'append', side_effect=append):
                result = journal.recover(lambda unit, _: restored.append(unit),
                                         lambda unit, _: {**current[unit], 'verified': True},
                                         lambda: {'verified': True})
            self.assertEqual(restored, [])
            nats_error = next(error for error in result['errors'] if error['unit'] == 'nats')
            self.assertNotIn('after_commit', nats_error)

    def test_marker_during_legacy_restart_reports_its_commit(self):
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            restored = []
            def restore(unit, prior):
                restored.append(unit)
                current[unit] = copy.deepcopy(prior)
                self.nats_marker.write_text('{}')
            result = journal.recover(restore,
                                     lambda unit, _: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertEqual(restored, ['nats'])
            nats_error = next(error for error in result['errors'] if error['unit'] == 'nats')
            self.assertEqual(nats_error['after_commit'], 'restore')

    def test_legacy_restart_exception_still_reports_possible_commit(self):
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            def restore(unit, _):
                self.assertEqual(unit, 'nats')
                raise OSError('restart outcome unknown')
            result = journal.recover(restore,
                                     lambda unit, _: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
            nats_error = next(error for error in result['errors'] if error['unit'] == 'nats')
            self.assertEqual(nats_error['after_commit'], 'restore')

    def test_old_unscoped_nats_journal_respects_root_exclusion(self):
        with self.journal(PRIOR) as journal:
            self.nats_lock.write_bytes(b'owned lock')
            self.nats_lock.chmod(0o644)
            script = ('import fcntl,os,sys; '
                      'fd=os.open(sys.argv[1],os.O_RDONLY); '
                      'fcntl.flock(fd,fcntl.LOCK_EX); '
                      'print("locked",flush=True); sys.stdin.read()')
            holder = subprocess.Popen([sys.executable, '-c', script, str(self.nats_lock)],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(holder.stdout.readline().strip(), 'locked')
                observed = []
                restored = []
                def observe(unit, _):
                    observed.append(unit)
                    return {**PRIOR[unit], 'verified': True}
                with patch('preservation_journal.NATS_ROOT_UID', os.getuid()):
                    result = journal.recover(lambda unit, _: restored.append(unit),
                                             observe,
                                             lambda: self.fail('old journal certified readiness'))
                self.assertFalse(result['restored'])
                self.assertEqual(restored, [])
                self.assertFalse(set(observed) & set(NATS_TRANSFER_UNITS))
                self.assertIn('nats', [error['unit'] for error in result['errors']])
            finally:
                holder.stdin.close()
                self.assertEqual(holder.wait(timeout=5), 0)
                holder.stdout.close()

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

    def test_full_scope_rechecks_entrypoints_but_restores_known_units_after_drift(self):
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
                    current = copy.deepcopy(prior)
                    current['gateway']['loaded'] = False
                    current['gateway']['running'] = False
                    restored = []
                    def restore(unit, saved):
                        restored.append(unit)
                        current[unit] = copy.deepcopy(saved)
                    hold = SimpleNamespace(journal=journal,
                        prepare=lambda *_: None, before_restore=lambda: None,
                        check_closed=lambda: None)
                    result = journal.recover(restore,
                        lambda unit, _: {**current[unit], 'verified': True},
                        lambda: {'verified': True}, hold=hold)
                self.assertIn('gateway', restored)
                self.assertFalse(result['restored'])
                self.assertIn('entrypoints', [row['unit'] for row in result['errors']])
                self.assertEqual(journal.records[-1]['event'], 'recovery-finished')

    def test_full_scope_recovery_refuses_root_marker_without_transfer(self):
        prior = full_node_inventory()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                before = len(journal.records)
                self.nats_marker.write_text('{}')
                with self.assertRaisesRegex(Refused, 'marker already exists'):
                    journal.recover(lambda *_: self.fail('restoration entered'),
                                    lambda *_: self.fail('observation entered'),
                                    lambda: self.fail('readiness entered'), hold=SimpleNamespace(journal=journal))
                self.assertEqual(len(journal.records), before)

    def test_full_scope_recovery_refuses_exclusive_writer_without_transfer(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        current['nats'].update(loaded=False, running=False)
        self.nats_lock.write_bytes(b'owned lock')
        self.nats_lock.chmod(0o644)
        script = ('import fcntl,os,sys; '
                  'fd=os.open(sys.argv[1],os.O_RDONLY); '
                  'fcntl.flock(fd,fcntl.LOCK_EX); '
                  'print("locked",flush=True); sys.stdin.read()')
        holder = subprocess.Popen([sys.executable, '-c', script, str(self.nats_lock)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'locked')
            with patch('preservation_journal.NATS_ROOT_UID', os.getuid()), patch(
                    'preservation_journal.capture_entrypoint_inventory',
                    return_value=full_entrypoint_evidence(prior)):
                with Journal(self.root, prior, node_lock=self.node_lock,
                             scope=FULL_NODE_SCOPE) as journal:
                    restored = []
                    observed = []
                    final_checks = []
                    hold = SimpleNamespace(journal=journal, prepare=lambda *_: None)
                    def observe(unit, _):
                        observed.append(unit)
                        return {**current[unit], 'verified': True}
                    def final_check():
                        final_checks.append(True)
                        return {'verified': True}
                    before = len(journal.records)
                    with self.assertRaisesRegex(Refused, 'exclusive exclusion'):
                        journal.recover(lambda unit, _: restored.append(unit),
                                        observe, final_check, hold=hold)
                    self.assertEqual(len(journal.records), before)
                    self.assertEqual(restored, [])
                    self.assertEqual(observed, [])
                    self.assertEqual(final_checks, [])
        finally:
            holder.stdin.close()
            self.assertEqual(holder.wait(timeout=5), 0)
            holder.stdout.close()

    def test_full_scope_holds_writer_exclusion_through_gate_reopen_and_resolution(self):
        prior = full_node_inventory()
        self.nats_lock.write_bytes(b'owned lock')
        self.nats_lock.chmod(0o644)
        script = ('import fcntl,os,sys; '
                  'fd=os.open(sys.argv[1],os.O_RDONLY); '
                  'fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)')
        def assert_excluded():
            probe = subprocess.run([sys.executable, '-c', script, str(self.nats_lock)],
                                   capture_output=True, text=True)
            self.assertNotEqual(probe.returncode, 0)
            self.assertIn('BlockingIOError', probe.stderr)
        def complete(observe, final_check, before_open=None):
            assert_excluded()
            observe('nats', prior['nats'])
            final_check()
            if before_open is not None:
                before_open()
            return {'verified': True}
        with patch('preservation_journal.NATS_ROOT_UID', os.getuid()), patch(
                'preservation_journal.capture_entrypoint_inventory',
                return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                                       complete=complete)
                result = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold)
                self.assertTrue(result['restored'])
                self.nats_marker.write_text('{}')
                with self.assertRaisesRegex(Refused, 'marker already exists'):
                    journal.resolve()
                self.assertEqual(journal.records[-1]['event'], 'recovery-finished')
                self.nats_marker.unlink()
                self.assertEqual(len(journal.resolve()), 64)

    def test_full_scope_refuses_loaded_inactive_or_restarted_job(self):
        prior = full_node_inventory()
        baseline = full_entrypoint_evidence(prior)
        current = copy.deepcopy(baseline)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                current['loaded']['gui'].append('ai.openclaw.federation-tick')
                with self.assertRaisesRegex(Refused, 'outside its original'):
                    journal.check_entrypoints()
                current = copy.deepcopy(baseline)
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None)
                def stop_viewer():
                    current['loaded']['gui'].remove('ai.openclaw.workplan-viewer')
                journal.mutate('workplan-viewer', 'stop', stop_viewer,
                               lambda: {'verified': True}, hold=hold)
                self.assertEqual(journal.records[-1]['evidence']['entrypoint_loaded'],
                                 current['loaded'])
                def unload_timer():
                    current['loaded']['gui'].remove('ai.openclaw.consolidation-scheduler')
                journal.mutate('consolidation-scheduler', 'unload', unload_timer,
                               lambda: {'verified': True}, hold=hold)
                self.assertEqual(journal.records[-1]['evidence']['entrypoint_loaded'],
                                 current['loaded'])
                current = copy.deepcopy(baseline)
                with self.assertRaisesRegex(Refused, 'changed inside'):
                    journal.check_entrypoints(forward=True)

    def test_full_scope_resolve_rechecks_loaded_jobs(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    complete=lambda *_: {'verified': True})
                result = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold)
                self.assertTrue(result['restored'])
                with self.assertRaisesRegex(Refused, 'continuous launchd and process watch'):
                    journal.seal()
                with self.assertRaisesRegex(Refused, 'continuous launchd and process watch'):
                    journal._finalize('sealed')
                with self.assertRaisesRegex(Refused, 'continuous launchd and process watch'):
                    journal.append('sealed')
                current['loaded']['gui'].remove('ai.openclaw.gateway')
                with self.assertRaisesRegex(Refused, 'were not restored'):
                    journal.resolve()
                self.assertEqual(journal.records[-1]['event'], 'recovery-finished')

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

    def test_excluded_system_job_is_durable_and_refuses_later_runs_or_identity_drift(self):
        prior = full_node_inventory()
        evidence = full_entrypoint_evidence(prior)
        evidence['excluded'] = tailscale_record()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=copy.deepcopy(evidence)):
            with Journal(self.root, prior, boot='boot-a', node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                self.assertEqual(journal.check_entrypoints(final=True)['excluded'],
                                 evidence['excluded'])
                for change in (
                    ('launchd', 'runs', 2), ('launchd', 'last_exit_code', 1),
                    ('plist', 'sha256', '7' * 64), ('wrapper', 'sha256', '8' * 64),
                    ('app', 'sha256', '9' * 64), (None, 'boot', 'a' * 64),
                ):
                    changed = copy.deepcopy(evidence)
                    record = changed['excluded'][TAILSCALE_LABEL]
                    if change[0] is None:
                        record[change[1]] = change[2]
                    else:
                        record[change[0]][change[1]] = change[2]
                    with self.subTest(change=change):
                        with patch('preservation_journal.capture_entrypoint_inventory',
                                   return_value=changed):
                            with self.assertRaisesRegex(Refused, 'excluded system job changed'):
                                journal.check_entrypoints(final=True)
                missing = copy.deepcopy(evidence)
                missing['excluded'] = {}
                with patch('preservation_journal.capture_entrypoint_inventory',
                           return_value=missing):
                    with self.assertRaisesRegex(Refused, 'excluded system job changed'):
                        journal.check_entrypoints(final=True)
        malformed = copy.deepcopy(evidence)
        del malformed['excluded']
        with self.assertRaisesRegex(Refused, 'inventory is absent'):
            preservation_journal.valid_entrypoint_inventory(malformed, prior)
        malformed = copy.deepcopy(evidence)
        malformed['excluded']['com.openclaw.agent'] = tailscale_record()[TAILSCALE_LABEL]
        with self.assertRaisesRegex(Refused, 'not approved'):
            preservation_journal.valid_entrypoint_inventory(malformed, prior)

    def test_excluded_job_reanchors_for_restore_only_after_reboot_or_app_update(self):
        prior = full_node_inventory()
        baseline = full_entrypoint_evidence(prior)
        baseline['excluded'] = tailscale_record()
        current = copy.deepcopy(baseline)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, boot='6' * 64, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE):
                pass
            current['excluded'][TAILSCALE_LABEL]['app']['sha256'] = 'a' * 64
            current['excluded'][TAILSCALE_LABEL]['launchd']['runs'] = 2
            current['excluded'][TAILSCALE_LABEL]['boot'] = '7' * 64
            with Journal(self.root, boot='7' * 64, node_lock=self.node_lock) as reopened:
                hold = SimpleNamespace(journal=reopened, prepare=lambda *_: None,
                    complete=lambda *_: {'verified': True})
                with self.assertRaisesRegex(Refused, 'excluded system job changed'):
                    reopened.check_entrypoints()
                result = reopened.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold)
                self.assertTrue(result['restored'])
                self.assertEqual(reopened.records[-1]['event'], 'recovery-finished')
                self.assertFalse(next(row for row in reopened.records
                    if row['event'] == 'recovery-started')['excluded_unchanged_since_baseline'])
                self.assertEqual(reopened.check_entrypoints(final=True)['excluded'],
                                 current['excluded'])
                reopened.resolve()

    def test_excluded_job_run_during_nats_transfer_is_durably_reported(self):
        journal, hold, observe, _ = self.prepared_nats_transfer(tailscale_record())
        transfer = journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        self.publish_nats_return(journal, transfer)
        current = copy.deepcopy(journal.entrypoint_inventory)
        current['loaded']['gui'] = sorted(set(current['loaded']['gui']) -
            {'ai.openclaw.nats', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3'})
        current['excluded'][TAILSCALE_LABEL]['launchd']['runs'] = 2
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            closed = journal.complete_nats_outcome()
            self.assertEqual(closed['outcome'], 'returned')
            recovery_hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                complete=lambda *_: {'verified': True})
            def final_check():
                current['loaded'] = copy.deepcopy(journal.entrypoint_inventory['loaded'])
                return {'verified': True}
            failed = journal.recover(lambda *_: self.fail('already restored'),
                lambda unit, _: {**journal.prior[unit], 'verified': True},
                lambda: {'verified': False}, hold=recovery_hold)
            self.assertFalse(failed['restored'])
            result = journal.recover(lambda *_: self.fail('already restored'),
                lambda unit, _: {**journal.prior[unit], 'verified': True},
                final_check, hold=recovery_hold)
            self.assertTrue(result['restored'], result)
            started = [row for row in journal.records if row['event'] == 'recovery-started']
            self.assertEqual([row['excluded_unchanged_since_baseline'] for row in started],
                             [False, False])
            self.assertTrue(all(row['entrypoint_excluded'][TAILSCALE_LABEL]['launchd']['runs'] == 2
                                for row in started))
            journal.resolve()


    def test_excluded_job_run_during_recovery_blocks_that_attempt_and_reanchors_on_retry(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        current['excluded'] = tailscale_record()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, boot='6' * 64, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    complete=lambda *_: {'verified': True})
                def final_check():
                    current['excluded'][TAILSCALE_LABEL]['launchd']['runs'] += 1
                    return {'verified': True}
                result = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    final_check, hold=hold)
                self.assertFalse(result['restored'])
                self.assertIn('final-state', [row['unit'] for row in result['errors']])
                with self.assertRaisesRegex(Refused, 'unrestored node'):
                    journal.resolve()
                retried = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold)
                self.assertTrue(retried['restored'])
                started = [row for row in journal.records if row['event'] == 'recovery-started']
                self.assertEqual([row['excluded_unchanged_since_baseline'] for row in started],
                                 [True, False])
                journal.resolve()

    def test_excluded_job_static_drift_cannot_reanchor_recovery(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        current['excluded'] = tailscale_record()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, boot='6' * 64, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                current['excluded'][TAILSCALE_LABEL]['plist']['sha256'] = 'a' * 64
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    complete=lambda *_: {'verified': True})
                result = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold)
                self.assertFalse(result['restored'])
                self.assertIn('entrypoints', [row['unit'] for row in result['errors']])

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
                    with self.assertRaises(CommittedRefusal):
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
                with self.assertRaises(CommittedRefusal):
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
