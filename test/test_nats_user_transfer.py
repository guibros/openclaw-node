import copy
import os
import json
from pathlib import Path
import sys
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[1]
AUDIT = REPO / 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'
sys.path.insert(0, str(REPO / 'lib'))
sys.path.insert(0, str(AUDIT))

import nats_user_transfer as module
import test_preservation_journal as fixture_module
import test_journal_hold as hold_fixture
from journal_hold import JournaledHold, describe


class UserTransferTest(unittest.TestCase):
    def prepared(self, extra_event=None):
        fixture = fixture_module.JournalTests('test_nats_transfer_freezes_user_journal_before_root_outcome')
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        self.addCleanup(fixture.doCleanups)
        prior = fixture_module.full_node_inventory()
        loaded = fixture_module.full_entrypoint_evidence(prior)
        inventory_patch = patch('preservation_journal.capture_entrypoint_inventory',
                                side_effect=lambda _: copy.deepcopy(loaded))
        inventory_patch.start()
        fixture.addCleanup(inventory_patch.stop)
        marker_patch = patch('preservation_journal.NATS_WRITER_MARKER',
                             fixture.parent / 'writer-handoff.json')
        marker_patch.start()
        fixture.addCleanup(marker_patch.stop)
        journal = fixture_module.Journal(fixture.root, prior, boot='boot-a',
                                         node_lock=fixture.node_lock,
                                         scope=fixture_module.FULL_NODE_SCOPE)
        fixture.addCleanup(journal.close)
        certificate = {'verified': True, 'restoration_only': False,
                       'kernel_file_watch': True,
                       'path_watch': {'kernel_path_watch': True},
                       'watch_session_id': 'owned-session'}
        hold = SimpleNamespace(journal=journal, check_forward=lambda: certificate)
        fields = {'baseline': journal.records[0]['sha256'], 'window': 'hold-' + 'a' * 64,
                  'reason': 'preservation execution hold', 'protective': False}
        intent = journal.append('intent', unit='scheduler-heartbeat',
                                action='close-execution-hold', hold=fields)
        journal.append('hold-published', intent=intent['sequence'],
                       receipt={'marker': {'window': fields['window'], 'reason': fields['reason']}},
                       adopted_for_restoration=False)
        journal.append('verified', intent=intent['sequence'], unit='scheduler-heartbeat',
                       action='close-execution-hold',
                       evidence={**certificate,
                                 'entrypoint_loaded': copy.deepcopy(loaded['loaded'])})
        for unit in ('nats', 'nats-2', 'nats-3'):
            journal.mutate(unit, 'unload',
                           lambda unit=unit: loaded['loaded']['gui'].remove('ai.openclaw.' + unit),
                           lambda: {'verified': True, 'execution_hold': certificate}, hold=hold)
        def observe(unit, saved):
            if unit == 'nats-1':
                return {**saved, 'verified': True}
            return {**saved, 'loaded': False, 'running': False, 'verified': True}
        transaction = str(uuid.uuid4())
        if extra_event is not None:
            journal.append(extra_event)
        transfer = journal.transfer_nats(transaction, hold, observe)
        return fixture, journal, transaction, transfer

    def test_root_refuses_live_owner_then_pins_exact_transfer(self):
        fixture, journal, transaction, transfer = self.prepared()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'controller still holds'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)
            journal.close()
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                self.assertEqual(reader.observation['head'], transfer['sha256'])
                self.assertEqual(reader.observation['baseline_sha256'], journal.records[0]['sha256'])
                self.assertEqual(reader.recheck(), reader.observation)

    def test_root_refuses_a_changed_head_and_wrong_boot(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        with patch.object(module, 'boot_identity', return_value='another-boot'):
            with self.assertRaisesRegex(module.Refused, 'current boot'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                extra = fixture.root / f'{len(journal.records):06d}.json'
                extra.write_text('{}')
                extra.chmod(0o600)
                with self.assertRaisesRegex(module.Refused, 'journal chain differs'):
                    reader.recheck()

    def test_root_refuses_pending_file_and_mismatched_node_receipt(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        pending = fixture.root / ('.pending-' + uuid.uuid4().hex)
        pending.write_bytes(b'partial')
        pending.chmod(0o600)
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'pending or unknown'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)
            pending.unlink()
            receipt = fixture.node_lock.with_name(fixture.node_lock.name + '.state.json')
            saved = json.loads(receipt.read_text())
            receipt.write_text(json.dumps({**saved, 'status': 'restored'}))
            receipt.chmod(0o600)
            with self.assertRaisesRegex(module.Refused, 'node receipt differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_requires_transfer_intent_to_be_the_last_record(self):
        fixture, journal, transaction, _ = self.prepared()
        journal._append_durable('verified', intent=999, unit='nats', action='unload',
                                evidence={'verified': True})
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'transfer intent differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_transfer_without_original_hold_certificate(self):
        fixture = fixture_module.JournalTests('test_nats_transfer_freezes_user_journal_before_root_outcome')
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        self.addCleanup(fixture.doCleanups)
        journal, hold, observe, _ = fixture.prepared_nats_transfer()
        transaction = str(uuid.uuid4())
        journal.transfer_nats(transaction, hold, observe)
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'no unique original execution hold'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_replaced_owner_lock_during_recheck(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                fixture.node_lock.rename(fixture.parent / 'old-node.lock')
                fixture.node_lock.write_bytes(b'')
                fixture.node_lock.chmod(0o600)
                with self.assertRaisesRegex(module.Refused, 'lock changed during root admission'):
                    reader.recheck()

    def test_root_tolerates_owner_finder_metadata(self):
        fixture, journal, transaction, transfer = self.prepared()
        journal.close()
        metadata = fixture.root / '.DS_Store'
        metadata.write_bytes(b'Finder metadata')
        metadata.chmod(0o640)
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                self.assertEqual(reader.observation['head'], transfer['sha256'])

    def test_root_refuses_unknown_forward_event(self):
        fixture, journal, transaction, _ = self.prepared('restoration-intent')
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'outside the forward window'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    @unittest.skipUnless(sys.platform == 'darwin', 'requires the native execution-hold observer')
    def test_root_reads_real_gate_and_hold_transfer(self):
        fixture = fixture_module.JournalTests('test_nats_transfer_freezes_user_journal_before_root_outcome')
        fixture.setUp()
        self.addCleanup(fixture.temp.cleanup)
        gate_root = Path(fixture.temp.name).resolve() / 'gate'
        pins = hold_fixture.gate_module.initialize(gate_root)
        with hold_fixture.gate_module.Gate(gate_root, pins) as gate:
            prior = fixture_module.full_node_inventory()
            prior['scheduler-heartbeat']['execution_hold'] = describe(
                gate, sorted(fixture_module.TIMER_UNITS))
            loaded = fixture_module.full_entrypoint_evidence(prior)
            with patch('preservation_journal.capture_entrypoint_inventory',
                       side_effect=lambda _: copy.deepcopy(loaded)), patch(
                       'preservation_journal.NATS_WRITER_MARKER',
                       fixture.parent / 'writer-handoff.json'):
                with fixture_module.Journal(fixture.root, prior, boot='boot-a',
                                            node_lock=fixture.node_lock,
                                            scope=fixture_module.FULL_NODE_SCOPE) as journal:
                    hold = JournaledHold(journal, gate,
                        lambda: {'verified': True,
                                 'baseline_sha256': journal.records[0]['sha256']})
                    try:
                        hold.close_and_drain()
                        for unit in ('nats', 'nats-2', 'nats-3'):
                            hold.mutate(unit, 'unload',
                                lambda unit=unit: loaded['loaded']['gui'].remove('ai.openclaw.' + unit),
                                lambda: {'verified': True})
                        transaction = str(uuid.uuid4())
                        transfer = journal.transfer_nats(transaction, hold,
                            lambda unit, saved: {**saved, 'verified': True,
                                'loaded': False, 'running': False})
                    finally:
                        hold.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                self.assertEqual(reader.observation['head'], transfer['sha256'])


if __name__ == '__main__':
    unittest.main()
