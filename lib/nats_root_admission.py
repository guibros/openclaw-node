from nats_root_journal import LockBootstrapJournal, boot_identity
from nats_root_lock import Refused
from nats_user_transfer import UserTransfer


class BoundRootJournal:
    def __init__(self, root, user, transaction):
        self.root = root
        self.user = user
        self.transaction = transaction
        self._check_descriptor()

    @classmethod
    def begin(cls, site, lock_path, root_uid, root_gid, transaction,
              node_lock, user_journal_root, user_uid, observe_physical):
        user = UserTransfer(node_lock, user_journal_root, user_uid, transaction)
        try:
            observation = {'boot': boot_identity(), 'user_transfer': user.recheck(),
                           'admission': observe_physical()}
            root = LockBootstrapJournal.begin(site, lock_path, root_uid, root_gid,
                                               transaction, observation)
            try:
                return cls(root, user, transaction)
            except BaseException:
                root.close()
                raise
        except BaseException:
            user.close()
            raise

    @classmethod
    def reopen(cls, site, root_uid, root_gid, transaction,
               node_lock, user_journal_root, user_uid):
        user = UserTransfer(node_lock, user_journal_root, user_uid, transaction)
        try:
            root = LockBootstrapJournal(site, root_uid, root_gid)
            try:
                return cls(root, user, transaction)
            except BaseException:
                root.close()
                raise
        except BaseException:
            user.close()
            raise

    def _check_descriptor(self):
        saved = self.root.current[0]['data']['descriptor']
        observed = self.user.recheck()
        if (saved['transaction'] != self.transaction
                or saved['user_journal_root'] != observed['journal_root']
                or saved['user_baseline_sha256'] != observed['baseline_sha256']
                or saved['user_transfer_sha256'] != observed['head']
                or saved['boot'] != boot_identity()):
            raise Refused('root transaction does not bind the still-open user transfer')

    def observation(self, observe_physical):
        self._check_descriptor()
        return {'boot': boot_identity(), 'user_transfer': self.user.observation,
                'admission': observe_physical()}

    def acquire_after_intent(self, lock_path, observe_physical, process_census, seconds=10):
        self._check_descriptor()
        return self.root.acquire_after_intent(lock_path,
            lambda: self.observation(observe_physical), process_census, seconds)

    def return_before_marker(self, lock_path, verify_release, seconds=10):
        self._check_descriptor()
        return self.root.return_before_marker(lock_path, verify_release, seconds)

    def close(self):
        try:
            self.root.close()
        finally:
            self.user.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
