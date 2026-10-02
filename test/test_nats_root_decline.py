import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'lib'))
sys.path.insert(0, str(REPO / 'test'))
sys.path.insert(0, str(REPO / 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'))

import nats_root_admission
import nats_root_journal
import nats_user_transfer
import preservation_journal
import test_nats_user_transfer as fixture_module


class RootDeclineTest(unittest.TestCase):
    def setUp(self):
        helper = fixture_module.UserTransferTest('test_root_refuses_live_owner_then_pins_exact_transfer')
        self.fixture, self.journal, self.transaction, self.transfer = helper.prepared(
            boot='a' * 64)
        self.addCleanup(helper.doCleanups)
        self.journal.close()
        root = tempfile.TemporaryDirectory(dir=REPO)
        self.addCleanup(root.cleanup)
        self.base = Path(root.name)
        self.site = self.base / 'root-site'
        self.site.mkdir(mode=0o755)
        self.lock = self.base / 'root-writer.lock'
        self.uid, self.gid = os.getuid(), os.getgid()
        for target in (nats_user_transfer, nats_root_admission, nats_root_journal):
            mocked = patch.object(target, 'boot_identity', return_value='a' * 64)
            mocked.start()
            self.addCleanup(mocked.stop)
        for name, value in (('NATS_ROOT_OUTCOMES', self.base / 'root-site-outcomes'),
                            ('NATS_ROOT_UID', self.uid),
                            ('NATS_WRITER_MARKER', self.site / 'writer-handoff.json'),
                            ('NATS_LEGACY_LOCK', self.lock)):
            mocked = patch.object(preservation_journal, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)

    def absence(self, context):
        return {**context, 'verified': True, 'protected_jobs': []}

    def decline(self):
        return nats_root_admission.BoundRootJournal.decline(
            self.site, self.lock, self.uid, self.gid, self.transaction,
            self.fixture.node_lock, self.fixture.root, self.uid, self.absence)

    def raw_begin(self):
        observation = {'boot': 'a' * 64,
                       'user_transfer': {'verified': True,
                                         'root_transaction': self.transaction,
                                         'head': self.transfer['sha256'],
                                         'baseline_sha256': self.journal.records[0]['sha256'],
                                         'journal_root': str(self.fixture.root.resolve())},
                       'admission': {'verified': True, 'masters': []}}
        return nats_root_journal.LockBootstrapJournal.begin(
            self.site, self.lock, self.uid, self.gid, self.transaction, observation)

    def previous_return(self):
        transaction = str(uuid.uuid4())
        observation = {'boot': 'a' * 64,
                       'user_transfer': {'verified': True,
                                         'root_transaction': transaction,
                                         'head': 'f' * 64,
                                         'baseline_sha256': 'e' * 64,
                                         'journal_root': str(self.fixture.root.resolve())},
                       'admission': {'verified': True, 'masters': []}}
        with nats_root_journal.LockBootstrapJournal.begin(
                self.site, self.lock, self.uid, self.gid,
                transaction, observation) as root:
            with root.acquire_after_intent(
                    self.lock, lambda: observation,
                    lambda context: {**context, 'verified': True}):
                pass
            return root.return_before_marker(
                self.lock, lambda context: {**context, 'verified': True})

    def test_decline_is_terminal_and_user_closes_restore_only(self):
        receipt = self.decline()
        self.assertEqual(receipt['outcome'], 'declined')
        self.assertFalse(self.lock.exists())
        with nats_root_journal.LockBootstrapJournal(self.site, self.uid, self.gid) as root:
            self.assertEqual([row['event'] for row in root.records], ['transfer-declined'])
            self.assertEqual(root.current[0]['data']['user_evidence']['transfer'],
                             self.transfer)
            with self.assertRaisesRegex(nats_root_journal.Refused, 'declined'):
                root.acquire_after_intent(self.lock, self.absence, self.absence)
            with self.assertRaisesRegex(nats_root_journal.Refused, 'declined'):
                root.return_before_marker(self.lock, self.absence)
        with self.assertRaisesRegex(nats_root_journal.Refused, 'reused'):
            self.raw_begin()
        with preservation_journal.Journal(self.fixture.root, boot='a' * 64,
                                          node_lock=self.fixture.node_lock) as user:
            closed = user.complete_nats_outcome()
            self.assertEqual(closed['outcome'], 'declined')
            self.assertIsNone(user.nats_transfer_open())
            with self.assertRaisesRegex(preservation_journal.Refused, 'restore-only'):
                user.require_forward()

    def test_one_link_pending_intent_is_settled_before_decline(self):
        ledger = self.base / 'root-site-ledger'
        ledger.mkdir(mode=0o700)
        pending = ledger / ('.pending-' + uuid.uuid4().hex)
        pending.write_bytes(b'partial')
        pending.chmod(0o600)
        self.decline()
        self.assertFalse(pending.exists())
        with self.assertRaisesRegex(nats_root_journal.Refused, 'reused'):
            self.raw_begin()

    def test_published_root_intent_blocks_decline(self):
        with self.raw_begin() as root:
            final = root.root / '000000.json'
            os.link(final, root.root / ('.pending-' + uuid.uuid4().hex))
        with self.assertRaisesRegex(nats_root_journal.Refused, 'root intent exists'):
            self.decline()
        self.assertFalse((self.base / 'root-site-outcomes').exists())

    def test_crash_after_decline_record_republishes_same_receipt(self):
        with patch.object(nats_root_journal.LockBootstrapJournal, '_publish_outcome',
                          side_effect=OSError('injected crash')):
            with self.assertRaisesRegex(OSError, 'injected crash'):
                self.decline()
        with nats_root_journal.LockBootstrapJournal(self.site, self.uid, self.gid) as root:
            saved = root.current[0]['sha256']
        outcomes = self.base / 'root-site-outcomes'
        outcomes.mkdir(mode=0o755)
        pending = outcomes / ('.pending-' + uuid.uuid4().hex)
        pending.write_bytes(b'interrupted publication')
        pending.chmod(0o644)
        receipt = self.decline()
        self.assertEqual(receipt['ledger_sha256'], saved)
        self.assertFalse(pending.exists())
        self.assertEqual(self.decline(), receipt)

    def test_stale_root_outcome_refuses_before_decline_record(self):
        outcomes = self.base / 'root-site-outcomes'
        outcomes.mkdir(mode=0o755)
        stale = outcomes / (self.transaction + '.json')
        stale.write_text('{"outcome":"returned"}')
        stale.chmod(0o644)
        with self.assertRaisesRegex(nats_root_journal.Refused,
                                    'outcome already exists before decline intent'):
            self.decline()
        self.assertEqual(list((self.base / 'root-site-ledger').glob('*.json')), [])
        self.assertTrue(stale.exists())

    def test_previous_returned_lock_is_carried_into_decline(self):
        self.previous_return()
        receipt = self.decline()
        with nats_root_journal.LockBootstrapJournal(self.site, self.uid, self.gid) as root:
            self.assertEqual(root.current[0]['event'], 'transfer-declined')
            self.assertEqual(root.current[0]['data']['lock']['inode'], self.lock.stat().st_ino)
            self.assertEqual(root.read_declined_outcome(), receipt)

    def test_new_transaction_can_follow_published_decline(self):
        declined = self.decline()
        transaction = str(uuid.uuid4())
        observation = {'boot': 'a' * 64,
                       'user_transfer': {'verified': True,
                                         'root_transaction': transaction,
                                         'head': 'f' * 64,
                                         'baseline_sha256': 'e' * 64,
                                         'journal_root': str(self.fixture.root.resolve())},
                       'admission': {'verified': True, 'masters': []}}
        with nats_root_journal.LockBootstrapJournal.begin(
                self.site, self.lock, self.uid, self.gid,
                transaction, observation) as successor:
            self.assertEqual(successor.current[0]['data']['predecessor'],
                             declined['ledger_sha256'])
            self.assertIsNone(successor.current[0]['data']['inherited'])

    def test_successor_inherits_lock_after_decline_carried_a_return(self):
        self.previous_return()
        declined = self.decline()
        transaction = str(uuid.uuid4())
        observation = {'boot': 'a' * 64,
                       'user_transfer': {'verified': True,
                                         'root_transaction': transaction,
                                         'head': 'f' * 64,
                                         'baseline_sha256': 'e' * 64,
                                         'journal_root': str(self.fixture.root.resolve())},
                       'admission': {'verified': True, 'masters': []}}
        with nats_root_journal.LockBootstrapJournal.begin(
                self.site, self.lock, self.uid, self.gid,
                transaction, observation) as successor:
            saved = successor.current[0]['data']
            self.assertEqual(saved['predecessor'], declined['ledger_sha256'])
            self.assertEqual(saved['inherited']['inode'], self.lock.stat().st_ino)
            self.assertEqual(saved['descriptor']['lock_nonce'], saved['inherited']['nonce'])

    def test_changed_previous_lock_refuses_decline(self):
        self.previous_return()
        self.lock.write_bytes(b'changed')
        with self.assertRaisesRegex(nats_root_journal.Refused, 'identity differs'):
            self.decline()

    def test_marker_and_unexplained_stage_refuse_decline(self):
        marker = self.site / 'writer-handoff.json'
        marker.write_text('{}')
        with self.assertRaisesRegex(nats_root_journal.Refused, 'marker'):
            self.decline()
        marker.unlink()
        stage = self.base / '.openclaw-nats-lock-foreign'
        stage.write_text('foreign')
        with self.assertRaisesRegex(nats_root_journal.Refused, 'stage'):
            self.decline()
        self.assertEqual(list((self.base / 'root-site-ledger').glob('*.json')), [])

    def test_marker_appearing_during_absence_check_never_records_decline(self):
        def changes(context):
            (self.site / 'writer-handoff.json').write_text('{}')
            return {**context, 'verified': True}
        with self.assertRaisesRegex(nats_root_journal.Refused, 'changed during'):
            nats_root_admission.BoundRootJournal.decline(
                self.site, self.lock, self.uid, self.gid, self.transaction,
                self.fixture.node_lock, self.fixture.root, self.uid, changes)
        self.assertEqual(list((self.base / 'root-site-ledger').glob('*.json')), [])

    def test_prior_boot_decline_uses_fresh_absence_evidence(self):
        with patch.object(nats_root_admission, 'boot_identity', return_value='b' * 64), patch.object(
                nats_root_journal, 'boot_identity', return_value='b' * 64), patch.object(
                nats_user_transfer, 'boot_identity', return_value='b' * 64):
            receipt = self.decline()
        self.assertEqual(receipt['outcome'], 'declined')
        with nats_root_journal.LockBootstrapJournal(self.site, self.uid, self.gid) as root:
            self.assertEqual(root.current[0]['data']['transfer_boot'], 'a' * 64)
            self.assertEqual(root.current[0]['data']['decline_boot'], 'b' * 64)
        with preservation_journal.Journal(self.fixture.root, boot='b' * 64,
                                          node_lock=self.fixture.node_lock) as user:
            closed = user.complete_nats_outcome()
            self.assertEqual(closed['outcome'], 'declined')
            self.assertEqual(closed['boot'], 'b' * 64)

    def test_malformed_admission_window_can_still_decline(self):
        extra = fixture_module.UserTransferTest('test_root_refuses_live_owner_then_pins_exact_transfer')
        fixture, journal, transaction, _ = extra.prepared(
            extra_event='restoration-intent', boot='a' * 64)
        self.addCleanup(extra.doCleanups)
        journal.close()
        receipt = nats_root_admission.BoundRootJournal.decline(
            self.site, self.lock, self.uid, self.gid, transaction,
            fixture.node_lock, fixture.root, self.uid, self.absence)
        self.assertEqual(receipt['outcome'], 'declined')


if __name__ == '__main__':
    unittest.main()
