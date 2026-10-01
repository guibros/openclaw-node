import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import uuid

from nats_root_journal import boot_identity, encoded
from nats_root_lock import Refused, require_no_acl


UNITS = frozenset((
    'consolidation-scheduler', 'federation-tick', 'gateway', 'health-watch',
    'lane-watchdog', 'log-rotate', 'memory-daemon', 'mesh-agent', 'mesh-bridge',
    'mesh-deploy-listener', 'mesh-health-publisher', 'mesh-task-daemon',
    'mesh-tool-discord', 'mission-control', 'nats', 'nats-1', 'nats-2', 'nats-3',
    'node-watch', 'observer', 'scheduler-heartbeat', 'transcript-archive',
    'workplan-viewer',
))
NATS = ('nats', 'nats-2', 'nats-3', 'nats-1')
TIMERS = frozenset(('scheduler-heartbeat', 'consolidation-scheduler', 'observer',
                    'transcript-archive', 'log-rotate'))
HEX = re.compile(r'[0-9a-f]{64}\Z')


def require(condition, message):
    if not condition:
        raise Refused(message)


def directory(path, uid):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == uid
            and stat.S_IMODE(info.st_mode) == 0o700,
            'user preservation directory identity differs')
    require_no_acl(path)
    return info


def read_owned(path, uid, directory_fd=None):
    name = path.name if directory_fd is not None else path
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == uid
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1,
                'user preservation file identity differs')
        require_no_acl(path)
        with os.fdopen(os.dup(fd), 'rb') as handle:
            return json.load(handle)
    except (ValueError, UnicodeError) as error:
        raise Refused('user preservation file is unreadable') from error
    finally:
        os.close(fd)


def valid_baseline(row):
    require(row.get('event') == 'baseline' and row.get('scope') == 'full-node'
            and isinstance(row.get('prior'), dict) and set(row['prior']) == UNITS,
            'user transfer lacks a full-node baseline')
    prior = row['prior']
    for unit, state in prior.items():
        expected = ('held' if unit == 'nats-1' else
                    'unloaded' if unit == 'federation-tick' else
                    'on-demand' if unit == 'mesh-agent' else
                    'known-broken' if unit == 'mesh-tool-discord' else
                    'timer' if unit in TIMERS else 'daemon')
        require(isinstance(state, dict) and state.get('class') == expected
                and all(isinstance(state.get(key), bool) for key in ('loaded', 'running', 'disabled')),
                'user transfer baseline service class differs: ' + unit)
        identity = state.get('identity')
        require(isinstance(identity, dict) and set(identity) ==
                {'plist_sha256', 'argv', 'files', 'dependencies', 'working_directory'}
                and isinstance(identity['plist_sha256'], str) and HEX.fullmatch(identity['plist_sha256'])
                and isinstance(identity['argv'], list) and identity['argv']
                and isinstance(identity['argv'][0], str)
                and pathlib.Path(identity['argv'][0]).is_absolute()
                and isinstance(identity['files'], dict) and identity['files']
                and all(isinstance(path, str) and pathlib.Path(path).is_absolute()
                        and isinstance(digest, str) and HEX.fullmatch(digest)
                        for path, digest in identity['files'].items())
                and isinstance(identity['dependencies'], dict)
                and all(isinstance(path, str) and pathlib.Path(path).is_absolute()
                        for path in identity['dependencies'].values())
                and isinstance(identity['working_directory'], str)
                and pathlib.Path(identity['working_directory']).is_absolute(),
                'user transfer baseline static identity differs: ' + unit)
        require((expected != 'daemon' or state['loaded'] and state['running'] and not state['disabled'])
                and (expected != 'timer' or state['loaded'] and not state['running'] and not state['disabled'])
                and (expected != 'on-demand' or state['loaded'] and not state['running'] and not state['disabled'])
                and (expected != 'known-broken' or state['loaded'] and not state['disabled'])
                and (expected != 'held' or not state['loaded'] and not state['running'] and state['disabled'])
                and (expected != 'unloaded' or not state['loaded'] and not state['running']),
                'user transfer baseline state differs: ' + unit)
    hold = prior['scheduler-heartbeat'].get('execution_hold')
    require(isinstance(hold, dict) and isinstance(hold.get('cohort'), list)
            and set(hold['cohort']) == TIMERS and len(hold['cohort']) == len(TIMERS)
            and prior['federation-tick']['disabled'],
            'user transfer lacks the full execution hold')
    inventory = row.get('entrypoint_inventory')
    labels = {'ai.openclaw.' + unit for unit in UNITS}
    require(isinstance(inventory, dict) and set(inventory) ==
            {'verified', 'installed', 'loaded', 'roots', 'disabled_artifacts'}
            and inventory['verified'] is True and isinstance(inventory['installed'], dict)
            and set(inventory['installed']) == labels and isinstance(inventory['loaded'], dict)
            and set(inventory['loaded']) == {'gui', 'user', 'system'},
            'user transfer entrypoint inventory differs')
    for unit in UNITS:
        installed = inventory['installed']['ai.openclaw.' + unit]
        require(isinstance(installed, dict) and set(installed) == {'path', 'sha256'}
                and isinstance(installed['path'], str)
                and pathlib.Path(installed['path']).is_absolute()
                and installed['sha256'] == prior[unit]['identity']['plist_sha256'],
                'user transfer installed entrypoint differs: ' + unit)
    loaded = inventory['loaded']
    require(all(isinstance(values, list) and len(values) == len(set(values))
                for values in loaded.values())
            and set().union(*(set(values) for values in loaded.values())) ==
            {'ai.openclaw.' + unit for unit in UNITS if prior[unit]['loaded']}
            and sum(len(values) for values in loaded.values()) ==
            sum(state['loaded'] for state in prior.values())
            and isinstance(inventory['roots'], list) and inventory['roots']
            and all(isinstance(path, str) and pathlib.Path(path).is_absolute()
                    for path in inventory['roots'])
            and isinstance(inventory['disabled_artifacts'], dict)
            and all(isinstance(path, str) and pathlib.Path(path).is_absolute()
                    and isinstance(digest, str) and HEX.fullmatch(digest)
                    for path, digest in inventory['disabled_artifacts'].items()),
            'user transfer loaded entrypoints differ')


class UserTransfer:
    def __init__(self, node_lock, journal_root, uid, transaction):
        self.node_lock = pathlib.Path(node_lock)
        self.journal_root = pathlib.Path(journal_root)
        self.uid = uid
        self.transaction = transaction
        self.fds = []
        self.locks = []
        try:
            require(isinstance(uid, int) and uid != 0 and uid >= 0,
                    'user transfer owner must be non-root')
            require(str(uuid.UUID(transaction)) == transaction,
                    'user transfer transaction is not canonical')
            directory(self.node_lock.parent, uid)
            directory(self.node_lock.parent / 'journals', uid)
            directory(self.journal_root, uid)
            require(self.journal_root.absolute().parent ==
                    (self.node_lock.parent / 'journals').absolute(),
                    'user transfer journal escaped the fixed parent')
            self.dirfd = os.open(self.journal_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self.fds.append(self.dirfd)
            self._directory_identity()
            self._lock(self.node_lock)
            self._lock(self.journal_root / '.lock')
            self.records = self._records()
            self._validate()
            self._lock_identities()
        except (OSError, subprocess.CalledProcessError, KeyError, TypeError,
                ValueError, RecursionError) as error:
            self.close()
            raise Refused('user preservation transfer is unobservable or malformed') from error
        except BaseException:
            self.close()
            raise

    def _directory_identity(self):
        opened = os.fstat(self.dirfd)
        named = directory(self.journal_root, self.uid)
        require((opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino),
                'user preservation journal directory changed')

    def _lock(self, path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        self.fds.append(fd)
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == self.uid
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1,
                'user preservation lock identity differs')
        require_no_acl(path)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Refused('user preservation controller still holds the node lock') from error
        named = path.lstat()
        require((info.st_dev, info.st_ino, info.st_ctime_ns) ==
                (named.st_dev, named.st_ino, named.st_ctime_ns),
                'user preservation lock changed during acquisition')
        self.locks.append((path, fd, (info.st_dev, info.st_ino, info.st_ctime_ns)))

    def _lock_identities(self):
        for path, fd, identity in self.locks:
            actual = os.fstat(fd)
            named = path.lstat()
            require((actual.st_dev, actual.st_ino, actual.st_ctime_ns) == identity
                    and (named.st_dev, named.st_ino, named.st_ctime_ns) == identity
                    and stat.S_ISREG(named.st_mode) and named.st_uid == self.uid
                    and stat.S_IMODE(named.st_mode) == 0o600 and named.st_nlink == 1,
                    'user preservation lock changed during root admission')
            require_no_acl(path)

    def _records(self):
        self._directory_identity()
        names = sorted(os.listdir(self.dirfd))
        if '.DS_Store' in names:
            finder = self.journal_root / '.DS_Store'
            info = finder.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == self.uid
                    and info.st_nlink == 1,
                    'user preservation Finder metadata identity differs')
            require_no_acl(finder)
            names.remove('.DS_Store')
        require(names == ['.lock', *(f'{index:06d}.json' for index in range(len(names) - 1))],
                'user preservation journal has pending or unknown entries')
        rows = []
        for index in range(len(names) - 1):
            row = read_owned(self.journal_root / f'{index:06d}.json', self.uid, self.dirfd)
            require(isinstance(row, dict), 'user preservation journal record is not an object')
            try:
                actual_hash = hashlib.sha256(encoded({key: value for key, value in row.items()
                                                      if key != 'sha256'})).hexdigest()
            except (TypeError, ValueError) as error:
                raise Refused('user preservation journal content is invalid') from error
            require(row.get('sequence') == index
                    and row.get('previous') == (rows[-1]['sha256'] if rows else None)
                    and isinstance(row.get('event'), str)
                    and isinstance(row.get('boot'), str)
                    and isinstance(row.get('at'), str)
                    and isinstance(row.get('sha256'), str) and HEX.fullmatch(row['sha256'])
                    and actual_hash == row['sha256'],
                    'user preservation journal chain differs')
            rows.append(row)
        require(rows, 'user preservation journal is empty')
        self._directory_identity()
        return rows

    def _validate(self):
        boot = boot_identity()
        require(all(row.get('boot') == boot for row in self.records),
                'user transfer is not from the current boot')
        require(all(row['event'] in ('baseline', 'intent', 'hold-published',
                                     'verified', 'nats-transfer-intent')
                    for row in self.records),
                'user transfer contains an event outside the forward window')
        baseline, transfer = self.records[0], self.records[-1]
        valid_baseline(baseline)
        require(transfer.get('event') == 'nats-transfer-intent'
                and set(transfer) == {'sequence', 'previous', 'event', 'boot', 'at',
                                      'root_transaction', 'units', 'baseline_sha256',
                                      'observations', 'hold_sha256', 'hold_evidence', 'sha256'}
                and transfer['root_transaction'] == self.transaction
                and transfer['units'] == list(NATS)
                and transfer['baseline_sha256'] == baseline['sha256']
                and isinstance(transfer['hold_sha256'], str)
                and HEX.fullmatch(transfer['hold_sha256'])
                and isinstance(transfer['hold_evidence'], dict)
                and hashlib.sha256(encoded(transfer['hold_evidence'])).hexdigest() ==
                transfer['hold_sha256']
                and isinstance(transfer['observations'], dict)
                and set(transfer['observations']) == set(NATS),
                'user transfer intent differs')
        require(sum(row['event'] == 'nats-transfer-intent' for row in self.records) == 1
                and not any(row['event'] == 'nats-transfer-closed' for row in self.records),
                'user transfer has competing intents or a prior outcome')
        closed = [row for row in self.records[:-1]
                  if row['event'] == 'verified' and row.get('unit') == 'scheduler-heartbeat'
                  and row.get('action') == 'close-execution-hold']
        require(len(closed) == 1 and isinstance(closed[0].get('intent'), int)
                and 0 <= closed[0]['intent'] < closed[0]['sequence'],
                'user transfer has no unique original execution hold')
        hold_intent = self.records[closed[0]['intent']]
        hold_fields = hold_intent.get('hold')
        require(hold_intent.get('event') == 'intent'
                and hold_intent.get('action') == 'close-execution-hold'
                and isinstance(hold_fields, dict)
                and hold_fields.get('baseline') == baseline['sha256']
                and hold_fields.get('protective') is False
                and isinstance(hold_fields.get('window'), str)
                and any(row['event'] == 'hold-published'
                        and row.get('intent') == hold_intent['sequence']
                        and row.get('adopted_for_restoration') is False
                        and isinstance(row.get('receipt'), dict)
                        and row['receipt'].get('marker') ==
                        {'window': hold_fields['window'], 'reason': hold_fields.get('reason')}
                        for row in self.records[:closed[0]['sequence']]),
                'user transfer original hold publication differs')
        original = closed[0].get('evidence')
        evidence = transfer['hold_evidence']
        require(isinstance(original, dict) and original.get('verified') is True
                and original.get('restoration_only') is False
                and original.get('kernel_file_watch') is True
                and isinstance(original.get('path_watch'), dict)
                and original['path_watch'].get('kernel_path_watch') is True
                and isinstance(original.get('watch_session_id'), str)
                and original['watch_session_id']
                and evidence.get('verified') is True
                and evidence.get('restoration_only') is False
                and evidence.get('kernel_file_watch') is True
                and isinstance(evidence.get('path_watch'), dict)
                and evidence['path_watch'].get('kernel_path_watch') is True
                and evidence.get('watch_session_id') == original['watch_session_id'],
                'user transfer original hold certificate differs')
        for unit in NATS:
            actual = transfer['observations'][unit]
            prior = baseline['prior'][unit]
            require(isinstance(actual, dict) and actual.get('verified') is True
                    and actual.get('identity') == prior['identity']
                    and all(isinstance(actual.get(key), bool)
                            for key in ('loaded', 'running', 'disabled'))
                    and not actual['loaded'] and not actual['running']
                    and (unit != 'nats-1' or actual['disabled'] == prior['disabled']),
                    'user transfer NATS observation differs: ' + unit)
            if unit != 'nats-1':
                require(any(row['event'] == 'verified' and row['sequence'] > closed[0]['sequence']
                            and row.get('unit') == unit
                            and row.get('action') in ('unload', 'disable-and-unload')
                            and isinstance(row.get('evidence'), dict)
                            and isinstance(row['evidence'].get('execution_hold'), dict)
                            and row['evidence']['execution_hold'].get('watch_session_id') ==
                            original['watch_session_id']
                            for row in self.records[:-1]),
                        'user transfer NATS stop receipt is absent: ' + unit)
        require(not any(row['event'] in ('failed', 'recovery-started', 'hold-superseded')
                        for row in self.records), 'user transfer continuity was broken')
        completed = {row['intent'] for row in self.records
                     if row['event'] == 'verified' and isinstance(row.get('intent'), int)}
        require(not any(row['event'] == 'intent' and row['sequence'] not in completed
                        for row in self.records), 'user transfer has an unfinished mutation')
        receipt = read_owned(self.node_lock.with_name(self.node_lock.name + '.state.json'), self.uid)
        require(isinstance(receipt, dict) and receipt.get('status') == 'unresolved'
                and receipt.get('journal_root') == str(self.journal_root.resolve())
                and receipt.get('baseline') == baseline,
                'user transfer node receipt differs')
        self.observation = {'verified': True, 'root_transaction': self.transaction,
                            'head': transfer['sha256'], 'baseline_sha256': baseline['sha256'],
                            'journal_root': str(self.journal_root.resolve())}

    def recheck(self):
        try:
            self._lock_identities()
            require(self._records() == self.records,
                    'user transfer journal changed after root admission')
            self._validate()
            return self.observation
        except (OSError, subprocess.CalledProcessError, KeyError, TypeError,
                ValueError, RecursionError) as error:
            raise Refused('user preservation transfer is unobservable or malformed') from error

    def close(self):
        while self.fds:
            os.close(self.fds.pop())

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
