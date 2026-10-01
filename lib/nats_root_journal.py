import hashlib
import json
import os
import pathlib
import re
import stat
import uuid

from nats_root_lock import LOCK, Refused, _acquire, _create, protected_parent, require_no_acl, sync_dir, sync_fd


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def present(path):
    try:
        pathlib.Path(path).lstat()
        return True
    except FileNotFoundError:
        return False
    except OSError as error:
        raise Refused('root writer state is unobservable') from error


def directory(path, uid, gid, mode):
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_gid != gid
            or stat.S_IMODE(info.st_mode) != mode):
        raise Refused('root journal directory identity differs')
    require_no_acl(path)


def bootstrap_target(site, lock_path):
    target = pathlib.Path(lock_path).resolve(strict=False)
    site_path = pathlib.Path(site).resolve(strict=True)
    if target == site_path or site_path in target.parents:
        raise Refused('root writer lock cannot be inside the protected handoff site')
    if target == LOCK.resolve(strict=False):
        raise Refused('production root writer bootstrap awaits lifecycle recovery')
    return target


def record_file(path, uid, gid):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_gid != gid
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
        raise Refused('root journal record identity differs')
    require_no_acl(path)


def valid_descriptor(descriptor):
    if (not isinstance(descriptor, dict) or set(descriptor) !=
            {'transaction', 'user_transfer_sha256', 'admission_sha256', 'boot',
             'site', 'lock_path', 'uid', 'gid'}
            or not isinstance(descriptor['site'], str) or not pathlib.Path(descriptor['site']).is_absolute()
            or not isinstance(descriptor['lock_path'], str) or not pathlib.Path(descriptor['lock_path']).is_absolute()
            or not isinstance(descriptor['uid'], int) or descriptor['uid'] < 0
            or not isinstance(descriptor['gid'], int) or descriptor['gid'] < 0
            or not re.fullmatch(r'[0-9a-f]{64}', str(descriptor['user_transfer_sha256']))
            or not re.fullmatch(r'[0-9a-f]{64}', str(descriptor['admission_sha256']))
            or not re.fullmatch(r'[0-9a-f]{64}', str(descriptor['boot']))):
        raise Refused('root writer lock admission descriptor is incomplete')
    try:
        uuid.UUID(descriptor['transaction'])
    except (TypeError, ValueError) as error:
        raise Refused('root writer lock transaction is invalid') from error


def descriptor_from_observation(transaction, observation, site, lock_path, uid, gid):
    if (not isinstance(observation, dict) or set(observation) != {'boot', 'user_transfer', 'admission'}
            or not isinstance(observation['user_transfer'], dict)
            or not isinstance(observation['admission'], dict)
            or observation['user_transfer'].get('verified') is not True
            or observation['user_transfer'].get('root_transaction') != transaction
            or observation['admission'].get('verified') is not True):
        raise Refused('root writer lock admission observation is incomplete')
    descriptor = {'transaction': transaction, 'boot': observation['boot'],
                  'site': str(pathlib.Path(site).absolute()),
                  'lock_path': str(pathlib.Path(lock_path).absolute()),
                  'uid': uid, 'gid': gid,
                  'user_transfer_sha256': digest(observation['user_transfer']),
                  'admission_sha256': digest(observation['admission'])}
    valid_descriptor(descriptor)
    return descriptor


class LockBootstrapJournal:
    def __init__(self, site, uid, gid):
        self.site = pathlib.Path(site)
        self.root = self.site / 'journal'
        self.uid = uid
        self.gid = gid
        protected_parent(self.site, uid, gid)
        directory(self.site, uid, gid, 0o755)
        directory(self.root, uid, gid, 0o700)
        self.records = self._read()
        if not self.records or self.records[0]['event'] != 'lock-create-intent':
            raise Refused('root writer lock intent is absent')
        if len(self.records) > 2 or (len(self.records) == 2 and self.records[1]['event'] != 'lock-created'):
            raise Refused('root writer lock journal has an unknown state')
        valid_descriptor(self.records[0]['data'].get('descriptor'))
        saved = self.records[0]['data']['descriptor']
        if (saved['site'], saved['uid'], saved['gid']) != (str(self.site.absolute()), uid, gid):
            raise Refused('root writer lock intent identity differs')
        if len(self.records) == 2:
            data = self.records[1]['data']
            if (set(data) != {'inode', 'ctime_ns', 'census_sha256'}
                    or not isinstance(data['inode'], int) or data['inode'] <= 0
                    or not isinstance(data['ctime_ns'], int) or data['ctime_ns'] <= 0
                    or not re.fullmatch(r'[0-9a-f]{64}', str(data['census_sha256']))):
                raise Refused('root writer lock receipt is incomplete')

    @classmethod
    def begin(cls, site, lock_path, uid, gid, transaction, observation):
        site = pathlib.Path(site)
        protected_parent(site, uid, gid)
        directory(site, uid, gid, 0o755)
        bootstrap_target(site, lock_path)
        if present(lock_path):
            raise Refused('root writer lock exists without a transaction intent')
        if present(site / 'writer-handoff.json'):
            raise Refused('root writer handoff is already published')
        descriptor = descriptor_from_observation(transaction, observation, site, lock_path, uid, gid)
        root = site / 'journal'
        root.mkdir(mode=0o700)
        sync_dir(site)
        journal = object.__new__(cls)
        journal.site, journal.root, journal.uid, journal.gid, journal.records = site, root, uid, gid, []
        directory(root, uid, gid, 0o700)
        journal._append('lock-create-intent', descriptor=descriptor)
        return journal

    def _read(self):
        files = sorted(self.root.iterdir())
        if [path.name for path in files] not in (['000000.json'], ['000000.json', '000001.json']):
            raise Refused('root writer lock journal is incomplete or contains unknown files')
        records = []
        for index, path in enumerate(files):
            record_file(path, self.uid, self.gid)
            try:
                record = json.loads(path.read_bytes())
            except (OSError, ValueError) as error:
                raise Refused('root writer lock record is unreadable') from error
            previous = records[-1]['sha256'] if records else None
            if not isinstance(record, dict) or set(record) != {'sequence', 'previous', 'event', 'data', 'sha256'}:
                raise Refused('root writer lock record schema differs')
            body = {key: value for key, value in record.items() if key != 'sha256'}
            if (record['sequence'] != index or record['previous'] != previous
                    or not isinstance(record['data'], dict)
                    or digest(body) != record['sha256']):
                raise Refused('root writer lock journal chain differs')
            records.append(record)
        return records

    def _append(self, event, **data):
        if self.records and self._read() != self.records or not self.records and any(self.root.iterdir()):
            raise Refused('root writer lock journal changed')
        body = {'sequence': len(self.records),
                'previous': self.records[-1]['sha256'] if self.records else None,
                'event': event, 'data': data}
        record = {**body, 'sha256': digest(body)}
        pending = self.root / ('.pending-' + uuid.uuid4().hex)
        fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(encoded(record))
            handle.flush()
            sync_fd(handle.fileno())
        os.rename(pending, self.root / f'{len(self.records):06d}.json')
        sync_dir(self.root)
        self.records.append(record)
        if self._read() != self.records:
            raise Refused('root writer lock journal readback differs')
        return record

    def acquire_after_intent(self, lock_path, observe_admission, process_census, seconds=10):
        if not callable(observe_admission) or not callable(process_census):
            raise Refused('root lock needs admission and process census checks')
        bootstrap_target(self.site, lock_path)
        if present(self.site / 'writer-handoff.json'):
            raise Refused('root writer handoff needs the full recovery journal')
        saved = self.records[0]['data']['descriptor']
        if str(pathlib.Path(lock_path).absolute()) != saved['lock_path']:
            raise Refused('root writer lock path differs from intent')
        if descriptor_from_observation(saved['transaction'], observe_admission(),
                                       self.site, lock_path, self.uid, self.gid) != saved:
            raise Refused('root lock admission changed')
        if len(self.records) == 1:
            before = process_census()
            if not isinstance(before, dict) or before.get('verified') is not True:
                raise Refused('old writer process census is not verified before creation')
            if present(self.site / 'writer-handoff.json'):
                raise Refused('root writer handoff changed before lock creation')
            _create(lock_path, self.uid, self.gid)
        lock = _acquire(lock_path, self.uid, self.gid, seconds)
        try:
            if len(self.records) == 2:
                if (self.records[1]['data']['inode'], self.records[1]['data']['ctime_ns']) != lock.identity[1:]:
                    raise Refused('root writer lock identity changed after journaling')
            evidence = process_census()
            if not isinstance(evidence, dict) or evidence.get('verified') is not True:
                raise Refused('old writer process census is not verified')
            if descriptor_from_observation(saved['transaction'], observe_admission(),
                                           self.site, lock_path, self.uid, self.gid) != saved:
                raise Refused('root lock admission changed under exclusion')
            lock.validate()
            if present(self.site / 'writer-handoff.json'):
                raise Refused('root writer handoff changed during lock bootstrap')
            if len(self.records) == 1:
                self._append('lock-created', inode=lock.identity[1], ctime_ns=lock.identity[2],
                             census_sha256=digest(evidence))
            return lock
        except BaseException:
            lock.close()
            raise
