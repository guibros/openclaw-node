import hashlib
import fcntl
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import uuid

from nats_root_lock import LOCK, Refused, _acquire, protected_parent, require_no_acl, sync_dir, sync_fd


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def boot_identity():
    if sys.platform == 'darwin':
        value = subprocess.check_output(['/usr/sbin/sysctl', '-n', 'kern.bootsessionuuid'], text=True)
    else:
        value = pathlib.Path('/proc/sys/kernel/random/boot_id').read_text()
    try:
        canonical = str(uuid.UUID(value.strip()))
    except ValueError as error:
        raise Refused('current boot identity is unavailable') from error
    return hashlib.sha256(canonical.encode()).hexdigest()


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
    target_name = str(target).casefold()
    site_name = str(site_path).casefold()
    ledger_name = str(site_path.parent / (site_path.name + '-ledger')).casefold()
    if (target_name == site_name or target_name.startswith(site_name + os.sep)
            or target_name == ledger_name or target_name.startswith(ledger_name + os.sep)):
        raise Refused('root writer lock cannot be inside the protected handoff site or ledger')
    if target_name == str(LOCK.resolve(strict=False)).casefold():
        raise Refused('production root writer bootstrap awaits lifecycle recovery')
    return target


def record_file(path, uid, gid):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_gid != gid
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
        raise Refused('root journal record identity differs')
    require_no_acl(path)


def record_file_public(path, uid, gid):
    try:
        info = path.lstat()
    except OSError as error:
        raise Refused('root writer outcome is absent or unobservable') from error
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_gid != gid
            or stat.S_IMODE(info.st_mode) != 0o644 or info.st_nlink != 1):
        raise Refused('root writer outcome identity differs')
    require_no_acl(path)


def valid_descriptor(descriptor):
    if (not isinstance(descriptor, dict) or set(descriptor) !=
            {'transaction', 'user_transfer_sha256', 'admission_sha256', 'boot', 'lock_nonce',
             'site', 'lock_path', 'uid', 'gid'}
            or not isinstance(descriptor['site'], str) or not pathlib.Path(descriptor['site']).is_absolute()
            or not isinstance(descriptor['lock_path'], str) or not pathlib.Path(descriptor['lock_path']).is_absolute()
            or not isinstance(descriptor['uid'], int) or descriptor['uid'] < 0
            or not isinstance(descriptor['gid'], int) or descriptor['gid'] < 0
            or not re.fullmatch(r'[0-9a-f]{64}', str(descriptor['user_transfer_sha256']))
            or not re.fullmatch(r'[0-9a-f]{64}', str(descriptor['admission_sha256']))
            or not re.fullmatch(r'[0-9a-f]{64}', str(descriptor['lock_nonce']))
            or not re.fullmatch(r'[0-9a-f]{64}', str(descriptor['boot']))):
        raise Refused('root writer lock admission descriptor is incomplete')
    try:
        uuid.UUID(descriptor['transaction'])
    except (TypeError, ValueError) as error:
        raise Refused('root writer lock transaction is invalid') from error


def descriptor_from_observation(transaction, observation, site, lock_path, uid, gid, nonce):
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
                  'uid': uid, 'gid': gid, 'lock_nonce': nonce,
                  'user_transfer_sha256': digest(observation['user_transfer']),
                  'admission_sha256': digest(observation['admission'])}
    valid_descriptor(descriptor)
    return descriptor


class LockBootstrapJournal:
    def __init__(self, site, uid, gid):
        if sys.platform == 'darwin' and os.geteuid() == 0:
            raise Refused('production root writer bootstrap awaits lifecycle recovery')
        self.site = pathlib.Path(site)
        self.root = self.site.parent / (self.site.name + '-ledger')
        self.uid = uid
        self.gid = gid
        protected_parent(self.site, uid, gid)
        directory(self.site, uid, gid, 0o755)
        protected_parent(self.root, uid, gid)
        directory(self.root, uid, gid, 0o700)
        self.fd = self._exclusive()
        try:
            self.records = self._read()
            self._validate()
        except BaseException:
            self.close()
            raise

    def _exclusive(self):
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise Refused('root writer ledger already has an active driver') from error
            if os.fstat(fd).st_ino != self.root.lstat().st_ino:
                raise Refused('root writer ledger changed during acquisition')
            return fd
        except BaseException:
            os.close(fd)
            raise

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _validate(self):
        if not self.records or self.records[0]['event'] != 'lock-create-intent':
            raise Refused('root writer lock intent is absent')
        segments = []
        for row in self.records:
            if row['event'] == 'lock-create-intent':
                if segments and segments[-1][-1]['event'] != 'returned':
                    raise Refused('root writer ledger has competing transactions')
                segments.append([])
            segments[-1].append(row)
        previous = None
        transactions = set()
        for segment in segments:
            begin = segment[0]['data']
            if not isinstance(begin, dict) or 'descriptor' not in begin:
                raise Refused('root writer lock intent is incomplete')
            valid_descriptor(begin['descriptor'])
            saved = begin['descriptor']
            if saved['transaction'] in transactions:
                raise Refused('root writer transaction was reused')
            transactions.add(saved['transaction'])
            if (saved['site'], saved['uid'], saved['gid']) != (str(self.site.absolute()), self.uid, self.gid):
                raise Refused('root writer lock intent identity differs')
            inherited = previous['data']['lock'] if previous is not None else None
            expected_begin = ({'descriptor'} if previous is None else
                              {'descriptor', 'predecessor', 'inherited'})
            if (set(begin) != expected_begin or previous is not None and
                    (begin['predecessor'] != previous['sha256'] or begin['inherited'] != inherited)):
                raise Refused('root writer lock predecessor identity differs')
            if inherited is not None and saved['lock_nonce'] != inherited['nonce']:
                raise Refused('successor did not inherit the writer lock nonce')
            events = [row['event'] for row in segment]
            active_events = events[:-1] if events[-1] == 'returned' else events
            allowed = ([['lock-create-intent'], ['lock-create-intent', 'lock-staged'],
                        ['lock-create-intent', 'lock-staged', 'lock-admitted']]
                       if inherited is None else
                       [['lock-create-intent'], ['lock-create-intent', 'lock-admitted']])
            if active_events not in allowed:
                raise Refused('root writer lock journal has an unknown state')
            staged = next((row['data'] for row in segment if row['event'] == 'lock-staged'), None)
            if staged is not None:
                if (set(staged) != {'inode', 'nonce'} or not isinstance(staged['inode'], int)
                        or staged['inode'] <= 0 or staged['nonce'] != saved['lock_nonce']):
                    raise Refused('root writer lock stage receipt differs from intent')
            admitted = next((row['data'] for row in segment if row['event'] == 'lock-admitted'), None)
            if admitted is not None:
                if (set(admitted) != {'inode', 'ctime_ns', 'census_sha256'}
                        or not isinstance(admitted['inode'], int) or admitted['inode'] <= 0
                        or not isinstance(admitted['ctime_ns'], int) or admitted['ctime_ns'] <= 0
                        or not re.fullmatch(r'[0-9a-f]{64}', str(admitted['census_sha256']))
                        or admitted['inode'] != (staged['inode'] if staged is not None else inherited['inode'])):
                    raise Refused('root writer lock admission receipt is incomplete')
            if events[-1] == 'returned':
                terminal = segment[-1]['data']
                lock = terminal.get('lock')
                if (set(terminal) != {'lock', 'boot', 'release_sha256'}
                        or not re.fullmatch(r'[0-9a-f]{64}', str(terminal['boot']))
                        or not re.fullmatch(r'[0-9a-f]{64}', str(terminal['release_sha256']))
                        or lock is not None and (set(lock) != {'inode', 'nonce', 'ctime_ns'}
                            or not isinstance(lock['inode'], int) or lock['inode'] <= 0
                            or not isinstance(lock['ctime_ns'], int) or lock['ctime_ns'] <= 0
                            or lock['nonce'] != saved['lock_nonce'])
                        or (staged is not None or inherited is not None) and lock is None
                        or staged is not None and lock['inode'] != staged['inode']
                        or inherited is not None and lock['inode'] != inherited['inode']):
                    raise Refused('root writer return receipt is incomplete')
                previous = segment[-1]
        self.current = segments[-1]

    @classmethod
    def begin(cls, site, lock_path, uid, gid, transaction, observation):
        if sys.platform == 'darwin' and os.geteuid() == 0:
            raise Refused('production root writer bootstrap awaits lifecycle recovery')
        site = pathlib.Path(site)
        protected_parent(site, uid, gid)
        directory(site, uid, gid, 0o755)
        if any(site.iterdir()):
            raise Refused('protected handoff site is not empty before bootstrap')
        bootstrap_target(site, lock_path)
        if present(site / 'writer-handoff.json'):
            raise Refused('root writer handoff is already published')
        root = site.parent / (site.name + '-ledger')
        if not present(root) and present(lock_path):
            raise Refused('root writer lock exists without a transaction intent')
        protected_parent(root, uid, gid)
        try:
            root.mkdir(mode=0o700)
            sync_dir(root.parent)
        except FileExistsError:
            pass
        directory(root, uid, gid, 0o700)
        journal = object.__new__(cls)
        journal.site, journal.root, journal.uid, journal.gid = site, root, uid, gid
        journal.fd = journal._exclusive()
        try:
            journal.records = journal._read()
            predecessor = None
            inherited = None
            if journal.records:
                journal._validate()
                if journal.current[-1]['event'] != 'returned':
                    raise Refused('root writer ledger already has an active transaction')
                journal.read_returned_outcome()
                predecessor = journal.current[-1]['sha256']
                inherited = journal.current[-1]['data']['lock']
            if inherited is None:
                if present(lock_path):
                    raise Refused('root writer lock exists without a transaction intent')
                nonce = uuid.uuid4().hex + uuid.uuid4().hex
            else:
                nonce = inherited['nonce']
                if (not present(lock_path)
                        or journal._stage_identity(pathlib.Path(lock_path), nonce, inherited['inode']) != inherited['inode']
                        or pathlib.Path(lock_path).lstat().st_nlink != 1
                        or pathlib.Path(lock_path).lstat().st_ctime_ns != inherited['ctime_ns']):
                    raise Refused('inherited root writer lock identity changed')
            descriptor = descriptor_from_observation(
                transaction, observation, site, lock_path, uid, gid, nonce)
            data = {'descriptor': descriptor} if predecessor is None else {
                'descriptor': descriptor, 'predecessor': predecessor, 'inherited': inherited}
            journal._append('lock-create-intent', **data)
            return journal
        except BaseException:
            journal.close()
            raise

    def _read(self):
        entries = sorted(self.root.iterdir())
        pending = [path for path in entries if re.fullmatch(r'\.pending-[0-9a-f]{32}', path.name)]
        for path in pending:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != self.uid or info.st_gid != self.gid
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink not in (1, 2)):
                raise Refused('root journal pending record identity differs')
            require_no_acl(path)
            if info.st_nlink == 2:
                try:
                    sequence = json.loads(path.read_bytes())['sequence']
                    final = self.root / f'{sequence:06d}.json'
                    if not isinstance(sequence, int) or final.lstat().st_ino != info.st_ino:
                        raise Refused('root journal pending record has no matching final record')
                except (OSError, ValueError, KeyError, TypeError) as error:
                    raise Refused('root journal pending record is ambiguous') from error
            path.unlink()
            sync_dir(self.root)
        files = [path for path in entries if path not in pending]
        if [path.name for path in files] != [f'{index:06d}.json' for index in range(len(files))]:
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
        if self.fd is None:
            raise Refused('root writer ledger is closed')
        if os.fstat(self.fd).st_ino != self.root.lstat().st_ino:
            raise Refused('root writer ledger changed during transaction')
        if self._read() != self.records:
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
        final = self.root / f'{len(self.records):06d}.json'
        os.link(pending, final, follow_symlinks=False)
        sync_dir(self.root)
        pending.unlink()
        sync_dir(self.root)
        self.records.append(record)
        if event == 'lock-create-intent':
            self.current = [record]
        else:
            self.current.append(record)
        if self._read() != self.records:
            raise Refused('root writer lock journal readback differs')
        return record

    def _stage_path(self, saved):
        return pathlib.Path(saved['lock_path']).parent / ('.openclaw-nats-lock-' + uuid.UUID(saved['transaction']).hex)

    def _stage_identity(self, path, nonce, expected=None):
        protected_parent(path, self.uid, self.gid)
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != self.uid or info.st_gid != self.gid
                or stat.S_IMODE(info.st_mode) != 0o644 or info.st_nlink not in (1, 2)
                or path.read_bytes() != nonce.encode()):
            raise Refused('root writer staged lock identity differs')
        require_no_acl(path)
        if expected is not None and info.st_ino != expected:
            raise Refused('root writer staged lock inode changed')
        return info.st_ino

    def _create_stage(self, path, nonce):
        if sys.platform == 'darwin' and os.geteuid() == 0:
            raise Refused('production root writer bootstrap awaits lifecycle recovery')
        protected_parent(path, self.uid, self.gid)
        prior_umask = os.umask(0o022)
        try:
            try:
                fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            finally:
                os.umask(prior_umask)
        except FileExistsError:
            info = path.lstat()
            if (stat.S_ISREG(info.st_mode) and info.st_uid == self.uid and info.st_gid == self.gid
                    and stat.S_IMODE(info.st_mode) == 0o644 and info.st_nlink == 1
                    and path.read_bytes() == b''):
                fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
                try:
                    os.write(fd, nonce.encode())
                    sync_fd(fd)
                finally:
                    os.close(fd)
                sync_dir(path.parent)
            inode = self._stage_identity(path, nonce)
            if path.lstat().st_nlink != 1:
                raise Refused('unpublished root writer stage has another link')
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                if os.fstat(fd).st_ino != inode:
                    raise Refused('root writer staged lock changed during resync')
                sync_fd(fd)
            finally:
                os.close(fd)
            sync_dir(path.parent)
            return inode
        try:
            os.fchmod(fd, 0o644)
            os.fchown(fd, self.uid, self.gid)
            os.write(fd, nonce.encode())
            sync_fd(fd)
        finally:
            os.close(fd)
        sync_dir(path.parent)
        return self._stage_identity(path, nonce)

    def _publish_stage(self, stage, target, inode, nonce):
        if present(stage):
            self._stage_identity(stage, nonce, inode)
            if not present(target):
                os.link(stage, target, follow_symlinks=False)
                sync_dir(target.parent)
            self._stage_identity(target, nonce, inode)
            if stage.lstat().st_ino != target.lstat().st_ino:
                raise Refused('root writer staged lock and published path differ')
            stage.unlink()
            sync_dir(target.parent)
        elif not present(target):
            raise Refused('recorded root writer lock inode is missing; refusing recreation')
        self._stage_identity(target, nonce, inode)
        if target.lstat().st_nlink != 1:
            raise Refused('root writer lock still has another link')

    def _census(self, callback, saved, phase, inode):
        context = {'transaction': saved['transaction'], 'boot': saved['boot'],
                   'phase': phase, 'inode': inode, 'nonce': saved['lock_nonce']}
        evidence = callback(dict(context))
        if (not isinstance(evidence, dict) or evidence.get('verified') is not True
                or any(evidence.get(key) != value for key, value in context.items())):
            raise Refused('old writer process census is not bound to this transaction and lock')
        return evidence

    def _outcome_path(self):
        return self.site.parent / (self.site.name + '-outcomes')

    def _returned_receipt(self):
        terminal = self.current[-1]
        if terminal['event'] != 'returned':
            raise Refused('root writer transaction has no returned outcome')
        return {'transaction': self.current[0]['data']['descriptor']['transaction'],
                'outcome': 'returned', 'ledger_sha256': terminal['sha256']}

    def _check_returned_lock(self):
        lock = self.current[-1]['data']['lock']
        path = pathlib.Path(self.current[0]['data']['descriptor']['lock_path'])
        if lock is None:
            if present(path):
                raise Refused('returned lock unexpectedly appeared')
        elif (not present(path) or self._stage_identity(path, lock['nonce'], lock['inode']) != lock['inode']
              or path.lstat().st_nlink != 1 or path.lstat().st_ctime_ns != lock['ctime_ns']):
            raise Refused('returned writer lock identity changed')

    def read_returned_outcome(self):
        receipt = self._returned_receipt()
        self._check_returned_lock()
        root = self._outcome_path()
        protected_parent(root, self.uid, self.gid)
        directory(root, self.uid, self.gid, 0o755)
        path = root / (receipt['transaction'] + '.json')
        record_file_public(path, self.uid, self.gid)
        try:
            published = json.loads(path.read_bytes())
        except (OSError, ValueError) as error:
            raise Refused('root writer returned outcome is unreadable') from error
        if published != receipt:
            raise Refused('root writer returned outcome differs from ledger')
        return receipt

    def publish_returned_outcome(self):
        if sys.platform == 'darwin' and os.geteuid() == 0:
            raise Refused('production root writer bootstrap awaits lifecycle recovery')
        receipt = self._returned_receipt()
        self._check_returned_lock()
        if present(self.site / 'writer-handoff.json'):
            raise Refused('root writer marker blocks returned outcome')
        root = self._outcome_path()
        protected_parent(root, self.uid, self.gid)
        try:
            root.mkdir(mode=0o755)
            sync_dir(root.parent)
        except FileExistsError:
            pass
        directory(root, self.uid, self.gid, 0o755)
        for pending in root.iterdir():
            if re.fullmatch(r'\.pending-[0-9a-f]{32}', pending.name):
                record_file_public(pending, self.uid, self.gid)
                pending.unlink()
                sync_dir(root)
        final = root / (receipt['transaction'] + '.json')
        if not present(final):
            pending = root / ('.pending-' + uuid.uuid4().hex)
            prior_umask = os.umask(0o022)
            try:
                fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            finally:
                os.umask(prior_umask)
            with os.fdopen(fd, 'wb') as handle:
                os.fchmod(handle.fileno(), 0o644)
                os.fchown(handle.fileno(), self.uid, self.gid)
                handle.write(encoded(receipt))
                handle.flush()
                sync_fd(handle.fileno())
            os.rename(pending, final)
            sync_dir(root)
        return self.read_returned_outcome()

    def return_before_marker(self, lock_path, verify_release, seconds=10):
        if sys.platform == 'darwin' and os.geteuid() == 0:
            raise Refused('production root writer bootstrap awaits lifecycle recovery')
        if not callable(verify_release):
            raise Refused('root writer return requires a verified boot and release check')
        current_boot = boot_identity()
        bootstrap_target(self.site, lock_path)
        if self.current[-1]['event'] == 'returned':
            return self.publish_returned_outcome()
        saved = self.current[0]['data']['descriptor']
        if str(pathlib.Path(lock_path).absolute()) != saved['lock_path']:
            raise Refused('root writer lock path differs from intent')
        if present(self.site / 'writer-handoff.json'):
            raise Refused('root writer marker blocks pre-bootstrap return')
        stage = self._stage_path(saved)
        target = pathlib.Path(lock_path)
        inherited = self.current[0]['data'].get('inherited')
        staged = next((row['data'] for row in self.current if row['event'] == 'lock-staged'), None)
        admitted = next((row['data'] for row in self.current if row['event'] == 'lock-admitted'), None)
        if staged is None and inherited is None:
            if present(target):
                raise Refused('unrecorded root writer lock blocks return')
            if present(stage):
                self._stage_identity(stage, saved['lock_nonce'])
                if stage.lstat().st_nlink != 1:
                    raise Refused('unpublished root writer stage has another link')
                stage.unlink()
                sync_dir(stage.parent)
            identity = None
            lock = None
        else:
            if staged is not None:
                self._publish_stage(stage, target, staged['inode'], staged['nonce'])
            elif present(stage):
                raise Refused('inherited writer lock has an unexpected staging name')
            lock = _acquire(target, self.uid, self.gid, seconds)
            expected = staged['inode'] if staged is not None else inherited['inode']
            if (lock.identity[1] != expected or admitted is not None and
                    (lock.identity[1], lock.identity[2]) != (admitted['inode'], admitted['ctime_ns'])
                    or inherited is not None and lock.identity[2] != inherited['ctime_ns']):
                lock.close()
                raise Refused('root writer lock identity changed before return')
            identity = {'inode': lock.identity[1], 'nonce': saved['lock_nonce'],
                        'ctime_ns': lock.identity[2]}
        try:
            context = {'transaction': saved['transaction'], 'boot': current_boot,
                       'phase': 'before-return', 'lock': identity}
            evidence = verify_release(json.loads(encoded(context)))
            if (not isinstance(evidence, dict) or evidence.get('verified') is not True
                    or any(evidence.get(key) != value for key, value in context.items())):
                raise Refused('root writer release was not verified')
            if lock is not None:
                lock.validate()
            if present(self.site / 'writer-handoff.json'):
                raise Refused('root writer marker appeared during return')
            self._append('returned', lock=identity, boot=current_boot,
                         release_sha256=digest(evidence))
        finally:
            if lock is not None:
                lock.close()
        return self.publish_returned_outcome()

    def acquire_after_intent(self, lock_path, observe_admission, process_census, seconds=10):
        if sys.platform == 'darwin' and os.geteuid() == 0:
            raise Refused('production root writer bootstrap awaits lifecycle recovery')
        if not callable(observe_admission) or not callable(process_census):
            raise Refused('root lock needs admission and process census checks')
        bootstrap_target(self.site, lock_path)
        if present(self.site / 'writer-handoff.json'):
            raise Refused('root writer handoff needs the full recovery journal')
        segment = self.current
        if segment[-1]['event'] == 'returned':
            raise Refused('returned root writer transaction cannot be readmitted')
        saved = segment[0]['data']['descriptor']
        inherited = segment[0]['data'].get('inherited')
        if str(pathlib.Path(lock_path).absolute()) != saved['lock_path']:
            raise Refused('root writer lock path differs from intent')
        observed = descriptor_from_observation(saved['transaction'], observe_admission(),
                                               self.site, lock_path, self.uid, self.gid,
                                               saved['lock_nonce'])
        if observed != saved:
            raise Refused('root lock admission changed')
        target = pathlib.Path(lock_path)
        stage = self._stage_path(saved)
        admitted = segment[-1]['event'] == 'lock-admitted'
        if not admitted:
            self._census(process_census, saved, 'before-publication',
                         segment[1]['data']['inode'] if len(segment) == 2 and inherited is None else
                         inherited['inode'] if inherited is not None else None)
            if present(self.site / 'writer-handoff.json'):
                raise Refused('root writer handoff changed before lock creation')
            if inherited is None:
                if len(segment) == 1:
                    if present(target):
                        raise Refused('root writer lock exists without a staged receipt')
                    inode = self._create_stage(stage, saved['lock_nonce'])
                    self._append('lock-staged', inode=inode, nonce=saved['lock_nonce'])
                staged = segment[1]['data']
                self._publish_stage(stage, target, staged['inode'], staged['nonce'])
            elif present(stage):
                raise Refused('inherited writer lock has an unexpected staging name')
        lock = _acquire(lock_path, self.uid, self.gid, seconds)
        try:
            expected_inode = inherited['inode'] if inherited is not None else segment[1]['data']['inode']
            if lock.identity[1] != expected_inode:
                raise Refused('root writer lock inode changed after staging')
            if inherited is not None and lock.identity[2] != inherited['ctime_ns']:
                raise Refused('inherited root writer lock identity changed')
            if admitted:
                receipt = segment[-1]['data']
                if (receipt['inode'], receipt['ctime_ns']) != lock.identity[1:]:
                    raise Refused('root writer lock identity changed after journaling')
            evidence = self._census(process_census, saved, 'under-exclusion', lock.identity[1])
            observed = descriptor_from_observation(saved['transaction'], observe_admission(),
                                                   self.site, lock_path, self.uid, self.gid,
                                                   saved['lock_nonce'])
            if observed != saved:
                raise Refused('root lock admission changed under exclusion')
            lock.validate()
            if present(self.site / 'writer-handoff.json'):
                raise Refused('root writer handoff changed during lock bootstrap')
            if not admitted:
                self._append('lock-admitted', inode=lock.identity[1], ctime_ns=lock.identity[2],
                             census_sha256=digest(evidence))
            return lock
        except BaseException:
            lock.close()
            raise
