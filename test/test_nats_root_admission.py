import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'lib'))
sys.path.insert(0, str(REPO / 'test'))
sys.path.insert(0, str(REPO / 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'))

import nats_root_admission as module
import nats_root_journal
import nats_user_transfer
import test_nats_user_transfer as fixture_module
from preservation_journal import Journal


class BoundRootJournalTest(unittest.TestCase):
    def setUp(self):
        helper = fixture_module.UserTransferTest('test_root_refuses_live_owner_then_pins_exact_transfer')
        self.fixture, self.journal, self.transaction, self.transfer = helper.prepared(boot='a' * 64)
        self.addCleanup(helper.doCleanups)
        self.journal.close()
        root = tempfile.TemporaryDirectory(dir=REPO)
        self.addCleanup(root.cleanup)
        self.root_base = Path(root.name)
        self.site = self.root_base / 'root-site'
        self.site.mkdir(mode=0o755)
        self.lock = self.root_base / 'root-writer.lock'
        self.uid, self.gid = os.getuid(), os.getgid()
        for target, value in ((nats_user_transfer, 'a' * 64),
                              (module, 'a' * 64),
                              (nats_root_journal, 'a' * 64)):
            identity = patch.object(target, 'boot_identity', return_value=value)
            identity.start()
            self.addCleanup(identity.stop)

    def admission(self):
        return {'verified': True, 'masters': ['b' * 64]}

    def begin(self):
        return module.BoundRootJournal.begin(
            self.site, self.lock, self.uid, self.gid, self.transaction,
            self.fixture.node_lock, self.fixture.root, self.uid, self.admission)

    def reopen(self):
        return module.BoundRootJournal.reopen(
            self.site, self.uid, self.gid, self.transaction,
            self.fixture.node_lock, self.fixture.root, self.uid)

    def test_begin_binds_terminal_transfer_and_keeps_owner_excluded(self):
        with self.begin() as bound:
            beginning = bound.root.current[0]['data']
            saved = beginning['descriptor']
            self.assertEqual(saved['user_transfer_sha256'], self.transfer['sha256'])
            self.assertEqual(beginning['user_evidence'], {
                'baseline': self.journal.records[0], 'transfer': self.transfer})
            self.assertEqual(bound.root._read()[0]['data']['user_evidence'],
                             beginning['user_evidence'])
            with self.assertRaisesRegex(module.Refused, 'controller still holds'):
                nats_user_transfer.UserTransfer(
                    self.fixture.node_lock, self.fixture.root, self.uid, self.transaction)
            self.assertEqual(bound.observation(self.admission)['user_transfer']['head'],
                             self.transfer['sha256'])

    def test_reopen_revalidates_exact_user_transfer(self):
        with self.begin():
            pass
        with self.reopen() as bound:
            self.assertEqual(bound.user.recheck()['head'], self.transfer['sha256'])
        with self.reopen() as bound:
            receipt = bound.return_before_marker(
                self.lock, lambda context: {**context, 'verified': True})
            self.assertEqual(receipt['user_transfer_sha256'], self.transfer['sha256'])

    def test_rebooted_reentry_can_only_return_before_marker(self):
        with self.begin():
            pass
        with patch.object(module, 'boot_identity', return_value='b' * 64), patch.object(
                nats_root_journal, 'boot_identity', return_value='b' * 64), patch.object(
                nats_user_transfer, 'boot_identity', return_value='b' * 64):
            with self.reopen() as bound:
                self.assertTrue(bound.return_only)
                with self.assertRaisesRegex(module.Refused, 'only return'):
                    bound.acquire_after_intent(
                        self.lock, self.admission,
                        lambda context: {**context, 'verified': True})
                self.assertFalse(self.lock.exists())
                receipt = bound.return_before_marker(
                    self.lock, lambda context: {**context, 'verified': True})
                self.assertEqual(receipt['user_transfer_sha256'], self.transfer['sha256'])
                self.assertEqual(bound.root.current[-1]['data']['boot'], 'b' * 64)

    def test_physical_admission_drift_refuses_before_writer_lock_creation(self):
        with self.begin() as bound:
            with self.assertRaisesRegex(module.Refused, 'admission changed'):
                bound.acquire_after_intent(
                    self.lock, lambda: {'verified': True, 'masters': []},
                    lambda context: {**context, 'verified': True})
            self.assertFalse(self.lock.exists())

    def test_reopen_refuses_root_descriptor_for_another_user_head(self):
        observation = {'boot': 'a' * 64,
                       'user_transfer': {'verified': True,
                                         'root_transaction': self.transaction,
                                         'head': 'f' * 64,
                                         'baseline_sha256': self.journal.records[0]['sha256'],
                                         'journal_root': str(self.fixture.root.resolve())},
                       'admission': self.admission()}
        with nats_root_journal.LockBootstrapJournal.begin(
                self.site, self.lock, self.uid, self.gid,
                self.transaction, observation):
            pass
        with self.assertRaisesRegex(module.Refused, 'does not bind'):
            self.reopen()

    def test_reopen_refuses_matching_descriptor_without_root_owned_evidence(self):
        observation = {'boot': 'a' * 64,
                       'user_transfer': {'verified': True,
                                         'root_transaction': self.transaction,
                                         'head': self.transfer['sha256'],
                                         'baseline_sha256': self.journal.records[0]['sha256'],
                                         'journal_root': str(self.fixture.root.resolve())},
                       'admission': self.admission()}
        with nats_root_journal.LockBootstrapJournal.begin(
                self.site, self.lock, self.uid, self.gid,
                self.transaction, observation):
            pass
        with self.assertRaisesRegex(module.Refused, 'does not bind'):
            self.reopen()

    def test_closed_user_transfer_cannot_begin_successor_before_lock_exists(self):
        with Journal(self.fixture.root, boot='a' * 64, node_lock=self.fixture.node_lock) as user:
            user._append_durable('nats-transfer-closed',
                                 root_transaction=self.transaction, outcome='returned',
                                 root_ledger_sha256='a' * 64,
                                 root_receipt_sha256='b' * 64)
        with self.assertRaisesRegex(module.Refused, 'outside the forward window'):
            self.begin()
        self.assertFalse((self.root_base / 'root-site-ledger').exists())


if __name__ == '__main__':
    unittest.main()
