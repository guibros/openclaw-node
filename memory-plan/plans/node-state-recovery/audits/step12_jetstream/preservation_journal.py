import datetime
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import plistlib
import re
import stat
import subprocess
import sys
import uuid

from preservation_checks import (RESUME_ORDER, Refused, capture_entrypoint_inventory,
                                 require, valid_tailscale_exclusion)


UNITS = frozenset((*RESUME_ORDER, 'nats-1', 'federation-tick'))
TIMER_UNITS = frozenset(('scheduler-heartbeat', 'consolidation-scheduler', 'observer',
                         'transcript-archive', 'log-rotate'))
TIMER_SCOPE = 'timer-commissioning'
FULL_NODE_SCOPE = 'full-node'
TERMINAL = ('sealed', 'resolved')
NATS_TRANSFER_UNITS = ('nats', 'nats-2', 'nats-3', 'nats-1')
NATS_WRITER_MARKER = pathlib.Path('/private/var/db/openclaw-nats/writer-handoff.json')
NATS_ROOT_OUTCOMES = pathlib.Path('/private/var/db/openclaw-nats-outcomes')
NATS_ROOT_UID = 0
NATS_LEGACY_LOCK = pathlib.Path('/private/var/db/openclaw-nats-writer.lock')


class CommittedRefusal(Exception):
    pass


def require_no_nats_marker():
    try:
        NATS_WRITER_MARKER.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise Refused('protected NATS marker is unobservable') from error
    raise Refused('protected NATS marker already exists')


def require_no_outcome_acl(path):
    if sys.platform == 'darwin':
        result = subprocess.run(['/bin/ls', '-lde', str(path)], capture_output=True,
                                text=True, check=True)
        require(result.stdout and not any(' allow ' in line
                                          for line in result.stdout.splitlines()[1:]),
                'root NATS outcome path has an ACL')


def read_nats_root_outcome(transaction):
    try:
        info = NATS_ROOT_OUTCOMES.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == NATS_ROOT_UID
                and stat.S_IMODE(info.st_mode) == 0o755,
                'root NATS outcome directory identity differs')
        require_no_outcome_acl(NATS_ROOT_OUTCOMES)
        directory = os.open(NATS_ROOT_OUTCOMES, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            opened = os.fstat(directory)
            require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino),
                    'root NATS outcome directory changed')
            fd = os.open(transaction + '.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
            with os.fdopen(fd, 'rb') as handle:
                file_info = os.fstat(handle.fileno())
                require(stat.S_ISREG(file_info.st_mode) and file_info.st_uid == NATS_ROOT_UID
                        and stat.S_IMODE(file_info.st_mode) == 0o644 and file_info.st_nlink == 1,
                        'root NATS outcome identity differs')
                require_no_outcome_acl(NATS_ROOT_OUTCOMES / (transaction + '.json'))
                receipt = json.load(handle)
        finally:
            os.close(directory)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise Refused('root NATS outcome is absent or unreadable') from error
    require(isinstance(receipt, dict) and set(receipt) ==
            {'transaction', 'outcome', 'ledger_sha256', 'user_journal_root',
             'user_baseline_sha256', 'user_transfer_sha256'}
            and receipt['transaction'] == transaction
            and receipt['outcome'] in ('returned', 'declined')
            and all(re.fullmatch(r'[0-9a-f]{64}', str(receipt[key])) for key in
                    ('ledger_sha256', 'user_baseline_sha256', 'user_transfer_sha256')),
            'root NATS outcome receipt is incomplete')
    return receipt


@contextlib.contextmanager
def nats_legacy_restore_guard():
    require_no_nats_marker()
    try:
        named = NATS_LEGACY_LOCK.lstat()
    except FileNotFoundError:
        def check():
            try:
                NATS_LEGACY_LOCK.lstat()
            except FileNotFoundError:
                pass
            except OSError as error:
                raise Refused('legacy NATS writer lock is unobservable') from error
            else:
                raise Refused('legacy NATS writer lock appeared during restoration')
            require_no_nats_marker()
        yield check
        check()
        return
    except OSError as error:
        raise Refused('legacy NATS writer lock is unobservable') from error
    require(stat.S_ISREG(named.st_mode) and named.st_uid == NATS_ROOT_UID
            and stat.S_IMODE(named.st_mode) == 0o644 and named.st_nlink == 1,
            'legacy NATS writer lock identity differs')
    try:
        fd = os.open(NATS_LEGACY_LOCK, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise Refused('legacy NATS writer lock is unobservable') from error
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino, opened.st_ctime_ns) ==
                (named.st_dev, named.st_ino, named.st_ctime_ns),
                'legacy NATS writer lock changed')
        try:
            fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Refused('root NATS writer currently holds exclusive exclusion') from error
        def check():
            current = NATS_LEGACY_LOCK.lstat()
            require((current.st_dev, current.st_ino, current.st_ctime_ns) ==
                    (opened.st_dev, opened.st_ino, opened.st_ctime_ns),
                    'legacy NATS writer lock changed during restoration')
            require_no_nats_marker()
        check()
        yield check
        check()
    finally:
        os.close(fd)


def boot_identity():
    if sys.platform == 'darwin':
        value = subprocess.check_output(['/usr/sbin/sysctl', '-n', 'kern.bootsessionuuid'], text=True)
    else:
        value = pathlib.Path('/proc/sys/kernel/random/boot_id').read_text()
    return hashlib.sha256(value.strip().encode()).hexdigest()


def string_keys(value):
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise TypeError('journal dictionary keys must be strings')
        for item in value.values():
            string_keys(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            string_keys(item)


def encoded(value):
    string_keys(value)
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sync_fd(fd):
    os.fsync(fd)
    if sys.platform == 'darwin':
        fcntl.fcntl(fd, fcntl.F_FULLFSYNC)


def sync_dir(root):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        sync_fd(fd)
    finally:
        os.close(fd)


def read_private(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o600, 'journal record is not owner-private')
    return json.loads(path.read_bytes())


def finder_metadata(path):
    if path.name != '.DS_Store':
        return False
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid(), 'unexpected Finder metadata owner or link')
    return True


def write_private(path, value):
    pending = path.parent / ('.pending-' + uuid.uuid4().hex)
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(encoded(value))
        handle.flush()
        sync_fd(handle.fileno())
    os.rename(pending, path)
    sync_dir(path.parent)


def valid_record(record):
    require(isinstance(record, dict) and isinstance(record.get('sha256'), str), 'journal record is incomplete')
    body = {k: v for k, v in record.items() if k != 'sha256'}
    require(hashlib.sha256(encoded(body)).hexdigest() == record['sha256'], 'journal record content changed')
    return record


def static_identity(plist_path, files=(), dependencies=None):
    raw = pathlib.Path(plist_path).read_bytes()
    plist = plistlib.loads(raw)
    argv = plist['ProgramArguments']
    dependencies = {name: str(pathlib.Path(path).resolve(strict=True))
                    for name, path in (dependencies or {}).items()}
    require(all(pathlib.Path(path).is_file() for path in dependencies.values()),
            'dependencies must be resolved entry files; include package.json in files')
    cwd = pathlib.Path(plist.get('WorkingDirectory', '/'))
    arguments = [pathlib.Path(arg) if pathlib.Path(arg).is_absolute() else cwd / arg for arg in argv]
    paths = {pathlib.Path(path).resolve(strict=True) for path in (argv[0], *files, *dependencies.values())}
    paths.update(path.resolve(strict=True) for path in arguments if path.is_file())
    return {'plist_sha256': hashlib.sha256(raw).hexdigest(), 'argv': argv,
            'working_directory': str(cwd.resolve(strict=True)),
            'files': {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
            'dependencies': dependencies}


def matches(actual, prior):
    keys = ('loaded', 'disabled') if prior['class'] == 'known-broken' else ('loaded', 'running', 'disabled')
    return all(actual.get(k) == prior[k] for k in keys)


def valid_prior(prior, scope=None):
    expected = TIMER_UNITS if scope == TIMER_SCOPE else UNITS
    require(scope in (None, TIMER_SCOPE, FULL_NODE_SCOPE)
            and isinstance(prior, dict) and set(prior) == expected,
            'prior service inventory is incomplete or unknown')
    for unit, state in prior.items():
        require(isinstance(state, dict), 'prior service state is incomplete')
        require(all(isinstance(state.get(k), bool) for k in ('loaded', 'running', 'disabled')),
                'prior service state is incomplete')
        kind = state.get('class')
        require(kind in ('daemon', 'on-demand', 'timer', 'known-broken', 'held', 'unloaded', 'absent'),
                'service class is absent')
        identity = state.get('identity')
        if kind == 'absent':
            require(identity == {'installed': False}
                    and not any(state[k] for k in ('loaded', 'running', 'disabled')),
                    'absent service state is inconsistent')
            continue
        require(isinstance(identity, dict) and set(identity) ==
                {'plist_sha256', 'argv', 'files', 'dependencies', 'working_directory'},
                'prior static identity schema is incomplete')
        require(re.fullmatch(r'[0-9a-f]{64}', str(identity['plist_sha256']))
                and isinstance(identity['argv'], list) and identity['argv']
                and all(isinstance(arg, str) for arg in identity['argv'])
                and pathlib.Path(identity['argv'][0]).is_absolute()
                and isinstance(identity['working_directory'], str)
                and pathlib.Path(identity['working_directory']).is_absolute()
                and isinstance(identity['files'], dict) and identity['files']
                and all(pathlib.Path(path).is_absolute() and re.fullmatch(r'[0-9a-f]{64}', str(digest))
                        for path, digest in identity['files'].items())
                and isinstance(identity['dependencies'], dict)
                and all(isinstance(path, str) and pathlib.Path(path).is_absolute()
                        for path in identity['dependencies'].values()), 'prior static identity schema is incomplete')
        require((unit == 'nats-1') == (kind == 'held'), 'only member-1 may be declared held')
        require(kind != 'known-broken' or unit == 'mesh-tool-discord',
                'only the declared optional integration may be known-broken')
        require(kind != 'unloaded' or unit == 'federation-tick',
                'only the declared inactive timer may be installed but unloaded')
        require((kind != 'daemon' or state['loaded'] and state['running'] and not state['disabled'])
                and (kind != 'on-demand' or unit == 'mesh-agent' and state['loaded']
                     and not state['running'] and not state['disabled'])
                and (kind != 'timer' or state['loaded'] and not state['running'] and not state['disabled'])
                and (kind != 'known-broken' or state['loaded'] and not state['disabled'])
                and (kind != 'held' or not state['loaded'] and not state['running'] and state['disabled'])
                and (kind != 'unloaded' or not state['loaded'] and not state['running']),
                'baseline does not match the declared desired service state')
        if scope == TIMER_SCOPE:
            require(kind == 'timer' and (unit == 'scheduler-heartbeat') == ('execution_hold' in state),
                    'timer commissioning baseline includes an unrelated unit or lacks its hold')
    if scope == FULL_NODE_SCOPE:
        for unit in UNITS:
            kind = ('held' if unit == 'nats-1' else
                    'unloaded' if unit == 'federation-tick' else
                    'on-demand' if unit == 'mesh-agent' else
                    'known-broken' if unit == 'mesh-tool-discord' else
                    'timer' if unit in TIMER_UNITS else 'daemon')
            require(prior[unit]['class'] == kind,
                    'full-node service class differs from the approved cohort: ' + unit)
        require(prior['federation-tick']['disabled'],
                'installed federation tick must remain disabled across reboot')
    if scope in (TIMER_SCOPE, FULL_NODE_SCOPE):
        require('execution_hold' in prior['scheduler-heartbeat'],
                'full execution hold is absent from the service baseline')
        hold = prior['scheduler-heartbeat']['execution_hold']
        cohort = hold.get('cohort') if isinstance(hold, dict) else None
        require(isinstance(cohort, list) and len(cohort) == len(TIMER_UNITS)
                and set(cohort) == TIMER_UNITS, 'timer commissioning hold omits a scheduled entry')


def valid_entrypoint_inventory(evidence, prior):
    require(isinstance(evidence, dict) and evidence.get('verified') is True
            and set(evidence) == {'verified', 'installed', 'loaded', 'roots',
                                  'disabled_artifacts', 'excluded'},
            'full-node entrypoint inventory is absent')
    installed = evidence['installed']
    loaded = evidence['loaded']
    excluded = evidence['excluded']
    valid_tailscale_exclusion(excluded)
    require(isinstance(installed, dict) and set(installed) ==
            {'ai.openclaw.' + unit for unit in UNITS},
            'full-node installed entrypoints differ from the baseline')
    require(isinstance(loaded, dict) and set(loaded) == {'gui', 'user', 'system'}
            and all(isinstance(value, list) and len(value) == len(set(value))
                    for value in loaded.values()),
            'full-node loaded entrypoints are incomplete')
    expected_loaded = {'ai.openclaw.' + unit for unit, state in prior.items() if state['loaded']}
    require(set().union(*map(set, loaded.values())) == expected_loaded
            and sum(map(len, loaded.values())) == len(expected_loaded),
            'full-node loaded entrypoints differ from the baseline')
    require(not set(excluded) & (set(installed) | set().union(*map(set, loaded.values()))),
            'excluded system job is also in the managed cohort')
    require(isinstance(evidence['roots'], list) and evidence['roots']
            and all(isinstance(root, str) and pathlib.Path(root).is_absolute()
                    for root in evidence['roots'])
            and isinstance(evidence['disabled_artifacts'], dict)
            and all(pathlib.Path(path).is_absolute()
                    and re.fullmatch(r'[0-9a-f]{64}', str(digest))
                    for path, digest in evidence['disabled_artifacts'].items()),
            'full-node entrypoint roots or disabled artifacts are incomplete')
    for unit in UNITS:
        entry = installed['ai.openclaw.' + unit]
        require(isinstance(entry, dict) and set(entry) == {'path', 'sha256'}
                and isinstance(entry['path'], str) and pathlib.Path(entry['path']).is_absolute()
                and entry['sha256'] == prior[unit]['identity']['plist_sha256'],
                'full-node installed plist differs from the saved service identity')


class Journal:
    def __init__(self, root, prior=None, boot=None, node_lock=None, scope=None):
        self.root = pathlib.Path(root)
        self.boot = boot if boot is not None else boot_identity()
        self.lock = None
        self.node_lock = None
        self.write_failed = False
        self.receipt_writable = True
        self.sealed = False
        created = not self.root.exists()
        self.reopened = not created
        node_lock = pathlib.Path(node_lock) if node_lock is not None else pathlib.Path.home() / '.openclaw/preservation/node.lock'
        node_lock.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = node_lock.parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'node lock directory is not owner-private')
        self.node_lock = self._lock(node_lock)
        self.node_state = node_lock.with_name(node_lock.name + '.state.json')
        try:
            self.journals = node_lock.parent / 'journals'
            self.journals.mkdir(mode=0o700, exist_ok=True)
            info = self.journals.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                    and stat.S_IMODE(info.st_mode) == 0o700, 'journal parent is not owner-private')
            require(self.root.parent.resolve() == self.journals.resolve() and not self.root.is_symlink(),
                    'journal must be a direct child of the fixed persistent parent')
            self.active = None
            if os.path.lexists(self.node_state):
                try:
                    active = read_private(self.node_state)
                    valid_record(active['baseline'])
                except (ValueError, KeyError, TypeError, Refused, OSError):
                    require(not created, 'node receipt is corrupt; reopen the current journal to rebuild it, then create a new window')
                    info = self.node_state.lstat()
                    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                            and stat.S_IMODE(info.st_mode) == 0o600, 'corrupt receipt is not owner-private')
                    saved = self.node_state.with_name('.corrupt-receipt-' + uuid.uuid4().hex)
                    try:
                        os.rename(self.node_state, saved)
                        sync_dir(self.node_state.parent)
                    except OSError:
                        self.write_failed = True
                        self.receipt_writable = False
                else:
                    valid_prior(active['baseline']['prior'], active['baseline'].get('scope'))
                    if active['baseline'].get('scope') == FULL_NODE_SCOPE:
                        valid_entrypoint_inventory(active['baseline'].get('entrypoint_inventory'),
                                                   active['baseline']['prior'])
                    require(active['status'] in ('unresolved', 'restored'), 'node receipt status is invalid')
                    require(pathlib.Path(active['journal_root']).parent.resolve() == self.journals.resolve(),
                            'node receipt root escaped the persistent parent')
                    self.active = active
            if self.active is None:
                require(not created or not self._roots(),
                        'node receipt is missing; existing journals need restoration')
                if not created:
                    require(self._lineage_tip() == self.root.resolve(),
                            'only the current journal may rebuild a lost receipt')
            if (self.active is not None and self.active.get('phase') == 'initializing'
                    and self.active['journal_root'] == str(self.root.resolve())):
                require(prior is None, 'interrupted creation must reopen for restoration only')
                try:
                    self._finish_initialization()
                except OSError:
                    self.write_failed = True
                    self.reopened = True
                    self.records = [self.active['baseline']]
                    self.prior = json.loads(encoded(self.records[0]['prior']))
                    self.scope = self.records[0].get('scope')
                    self.entrypoint_inventory = self.records[0].get('entrypoint_inventory')
                    return
                created = False
                self.reopened = True
            if self.active is not None:
                require(not created or self.active['status'] == 'restored', 'prior node recovery is unresolved')
                require(created or self.active['journal_root'] == str(self.root.resolve()),
                        'another journal owns the node recovery inventory')
                records = self._read(pathlib.Path(self.active['journal_root'])) if created else None
                if records is not None:
                    self._receipt_head(records)
                    require(records[-1]['event'] in TERMINAL, 'prior journal needs explicit finalization')
                    for other in self._roots():
                        if str(other.resolve()) != self.active['journal_root']:
                            rows = self._read(other)
                            require(rows and rows[-1]['event'] in TERMINAL,
                                    'unindexed journal requires manual resolution')
            self._open(created, prior, scope)
        except BaseException:
            self.close()
            raise

    def _lock(self, path):
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        handle = os.fdopen(fd, 'r+')
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                    and stat.S_IMODE(info.st_mode) == 0o600, 'journal lock is not owner-private')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise Refused('another process owns the node preservation lock') from error
            return handle
        except BaseException:
            handle.close()
            raise

    def _open(self, created, prior, scope):
        if created:
            require(scope in (TIMER_SCOPE, FULL_NODE_SCOPE),
                    'new journal requires an explicit protected scope')
            require(prior is not None, 'new journal requires the complete prior state')
            valid_prior(prior, scope)
            entrypoints = capture_entrypoint_inventory(UNITS) if scope == FULL_NODE_SCOPE else None
            if scope == FULL_NODE_SCOPE:
                valid_entrypoint_inventory(entrypoints, prior)
            predecessor = ({'root': self.active['journal_root'], 'head': self.active['head']}
                           if self.active is not None else None)
            self.records = []
            fields = {'scope': scope} if scope is not None else {}
            if entrypoints is not None:
                fields['entrypoint_inventory'] = entrypoints
            initial = self._record('baseline', prior=prior, predecessor=predecessor, **fields)
            self._state({'journal_root': str(self.root.resolve()), 'baseline': initial,
                         'status': 'unresolved', 'phase': 'initializing',
                         'holder': {'pid': os.getpid(), 'boot': self.boot}})
            self.root.mkdir(mode=0o700)
            sync_dir(self.root.parent)
        info = self.root.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'journal directory is not owner-private')
        self.lock = self._lock(self.root / '.lock')
        try:
            self.records = self._read()
            require(created or self.records and self.records[0]['event'] == 'baseline', 'journal baseline is absent')
        except (Refused, OSError):
            require(not created and self.active is not None, 'validated baseline copy is absent')
            self.records = [self.active['baseline']]
            self.write_failed = True
        if created:
            write_private(self.root / '000000.json', initial)
            self.records = [initial]
            require(read_private(self.root / '000000.json') == self.records[0], 'baseline readback differs')
            self._state({**self.active, 'phase': 'initialized'})
        else:
            require(prior is None, 'cannot replace a journal baseline')
            require(scope is None, 'cannot replace a journal scope')
            require(self.records and self.records[0]['event'] == 'baseline', 'journal baseline is absent')
            valid_prior(self.records[0]['prior'], self.records[0].get('scope'))
            if self.records[0].get('scope') == FULL_NODE_SCOPE:
                valid_entrypoint_inventory(self.records[0].get('entrypoint_inventory'),
                                           self.records[0]['prior'])
            if self.active is None:
                self.active = {'journal_root': str(self.root.resolve()), 'baseline': self.records[0],
                               'status': 'restored' if self.records[-1]['event'] in TERMINAL else 'unresolved',
                               'holder': {'pid': os.getpid(), 'boot': self.boot}}
                if self.records[-1]['event'] in TERMINAL:
                    self.active['head'] = self.records[-1]['sha256']
                try:
                    self._state(self.active)
                except (OSError, Refused, TypeError, ValueError):
                    self.write_failed = True
            require(self.active['baseline'] == self.records[0], 'baseline copy differs')
            if self.records[-1]['event'] in TERMINAL:
                self._receipt_head(self.records)
                raise Refused('sealed or resolved journal receipt repaired; create a new window, no writing to this chain')
        self.prior = json.loads(encoded(self.records[0]['prior']))
        self.scope = self.records[0].get('scope')
        self.entrypoint_inventory = self.records[0].get('entrypoint_inventory')

    def check_entrypoints(self, final=False, forward=False, expected_loaded=None):
        if self.scope != FULL_NODE_SCOPE:
            return None
        current = capture_entrypoint_inventory(UNITS)
        saved = self.entrypoint_inventory
        require(all(current[key] == saved[key] for key in
                    ('installed', 'roots', 'disabled_artifacts')),
                'full-node installed entrypoint identity changed')
        recovery = next((row for row in reversed(self.records)
                         if row['event'] == 'recovery-started'), None)
        excluded_anchor = (recovery.get('entrypoint_excluded') if recovery is not None
                           else saved['excluded'])
        require(isinstance(excluded_anchor, dict),
                'full-node recovery exclusion anchor is absent')
        valid_tailscale_exclusion(excluded_anchor)
        require(set(excluded_anchor) == set(saved['excluded'])
                and all(excluded_anchor[label]['plist'] == saved['excluded'][label]['plist']
                        and excluded_anchor[label]['wrapper'] == saved['excluded'][label]['wrapper']
                        for label in excluded_anchor)
                and current['excluded'] == excluded_anchor,
                'full-node excluded system job changed inside the active window')
        require(all(set(current['loaded'][domain]) <= set(saved['loaded'][domain])
                    for domain in ('gui', 'user', 'system')),
                'full-node job loaded outside its original domain or state')
        if forward:
            previous = next((row['evidence']['entrypoint_loaded'] for row in reversed(self.records)
                             if row['event'] == 'verified'
                             and 'entrypoint_loaded' in row.get('evidence', {})), saved['loaded'])
            expected = expected_loaded if expected_loaded is not None else previous
            require(current['loaded'] == expected,
                    'full-node loaded jobs changed inside the forward window')
        if final:
            require(current['loaded'] == saved['loaded'],
                    'full-node loaded entrypoints were not restored')
        return current

    def _state(self, value):
        require(self.receipt_writable, 'corrupt receipt could not be durably retained')
        write_private(self.node_state, value)
        require(read_private(self.node_state) == value, 'node receipt readback differs')
        self.active = value

    def _receipt_head(self, records):
        require(records, 'prior node restoration head differs')
        require(records[0] == self.active['baseline'], 'baseline copy differs')
        last = records[-1]
        if (last['event'] in TERMINAL and last['previous'] == self.active.get('head')
                and self.active['status'] == 'restored'):
            self._state({**self.active, 'head': last['sha256']})
        require(last['sha256'] == self.active.get('head'), 'prior node restoration head differs')

    def _lineage_tip(self):
        histories = {root.resolve(): self._read(root) for root in self._roots()}
        referenced = set()
        for root, records in histories.items():
            require(records and records[0]['event'] == 'baseline', 'ambiguous journal baseline is absent')
            parent = records[0].get('predecessor')
            if parent is not None:
                prior = pathlib.Path(parent['root'])
                require(prior in histories and histories[prior][-1]['event'] in TERMINAL
                        and histories[prior][-1]['sha256'] == parent['head'], 'ambiguous journal lineage differs')
                referenced.add(prior)
        tips = set(histories) - referenced
        require(len(tips) == 1, 'ambiguous prior journal requires manual resolution')
        tip = tips.pop()
        require(all(root == tip or records[-1]['event'] in TERMINAL for root, records in histories.items()),
                'ambiguous unfinished journals require manual resolution')
        return tip

    def _roots(self):
        roots = []
        for path in self.journals.iterdir():
            if finder_metadata(path):
                continue
            info = path.lstat()
            require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', path.name)
                    and stat.S_ISDIR(info.st_mode), 'unexpected entry in the journal parent')
            roots.append(path)
        return roots

    def _finish_initialization(self):
        self.root.mkdir(mode=0o700, exist_ok=True)
        info = self.root.lstat()
        require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
                and info.st_uid == os.getuid(), 'journal directory is not owner-private')
        with self._lock(self.root / '.lock'):
            require(all(finder_metadata(path) or path.name == '.lock' or path.name.startswith('.pending-')
                        or re.fullmatch(r'\d{6}\.json', path.name) for path in self.root.iterdir()),
                    'initializing journal contains unknown files')
            records = self._read()
            require(not records or records == [self.active['baseline']],
                    'initializing journal contains post-baseline operations')
            if not records:
                write_private(self.root / '000000.json', self.active['baseline'])
            require(read_private(self.root / '000000.json') == self.active['baseline'], 'baseline readback differs')
            sync_dir(self.root.parent)
            self._state({**self.active, 'phase': 'initialized'})

    def _read(self, root=None):
        records = []
        root = root or self.root
        info = root.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'journal directory is not owner-private')
        files = sorted(p for p in root.iterdir() if re.fullmatch(r'\d{6}\.json', p.name))
        previous = None
        for index, path in enumerate(files):
            require(path.name == f'{index:06d}.json', 'journal sequence has a gap')
            try:
                record = read_private(path)
                digest = record.pop('sha256')
                require(record['sequence'] == index and record['previous'] == previous,
                        'journal chain is inconsistent')
                require(hashlib.sha256(encoded(record)).hexdigest() == digest, 'journal record content changed')
            except (ValueError, KeyError, TypeError) as error:
                raise Refused('journal record is incomplete') from error
            record['sha256'] = digest
            records.append(record)
            previous = digest
        return records

    def _record(self, event, **data):
        require(not set(data) & {'sequence', 'previous', 'sha256', 'event', 'boot', 'at'},
                'journal metadata cannot be replaced')
        record = {'sequence': len(self.records), 'previous': self.records[-1]['sha256'] if self.records else None,
                  'event': event, 'boot': self.boot,
                  'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **data}
        record['sha256'] = hashlib.sha256(encoded(record)).hexdigest()
        return record

    def append(self, event, **data):
        require(self.lock is not None, 'journal is closed')
        require(not self.sealed, 'sealed journal cannot be changed')
        require(not self.nats_transfer_open(), 'NATS transfer is open; await a root outcome')
        return self._append_durable(event, **data)

    def _append_durable(self, event, **data):
        require(self.lock is not None and not self.sealed, 'journal is closed or sealed')
        require(event != 'sealed' or self.scope != FULL_NODE_SCOPE,
                'full-node seal requires a continuous launchd and process watch')
        require(not self.write_failed, 'failed durable write requires reopening the journal')
        self.write_failed = True
        record = self._record(event, **data)
        pending = self.root / ('.pending-' + uuid.uuid4().hex)
        fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(encoded(record))
            handle.flush()
            sync_fd(handle.fileno())
        os.rename(pending, self.root / f'{len(self.records):06d}.json')
        sync_dir(self.root)
        self.records.append(record)
        self.write_failed = False
        return record

    def nats_transfer_open(self):
        rows = [row for row in self.records if row['event'] == 'nats-transfer-intent']
        closed = [row for row in self.records if row['event'] == 'nats-transfer-closed']
        require(len(rows) <= 1, 'competing NATS transfer intents')
        require(len(closed) <= 1 and (not closed or rows), 'NATS transfer closure is ambiguous')
        if not rows:
            return None
        row = rows[0]
        require(set(row) == {'sequence', 'previous', 'event', 'boot', 'at', 'root_transaction',
                             'units', 'baseline_sha256', 'observations', 'hold_sha256',
                             'hold_evidence', 'sha256'}
                and row['units'] == list(NATS_TRANSFER_UNITS)
                and row['baseline_sha256'] == self.records[0]['sha256']
                and isinstance(row['observations'], dict)
                and set(row['observations']) == set(NATS_TRANSFER_UNITS)
                and isinstance(row['hold_evidence'], dict)
                and re.fullmatch(r'[0-9a-f]{64}', str(row['hold_sha256']))
                and hashlib.sha256(encoded(row['hold_evidence'])).hexdigest() == row['hold_sha256'],
                'NATS transfer record is incomplete')
        try:
            require(str(uuid.UUID(row['root_transaction'])) == row['root_transaction'],
                    'NATS transfer transaction is not canonical')
        except (TypeError, ValueError) as error:
            raise Refused('NATS transfer transaction is invalid') from error
        if closed:
            terminal = closed[0]
            require(terminal['sequence'] == row['sequence'] + 1
                    and set(terminal) == {'sequence', 'previous', 'event', 'boot', 'at',
                                          'root_transaction', 'outcome', 'root_ledger_sha256',
                                          'root_receipt_sha256', 'sha256'}
                    and terminal['root_transaction'] == row['root_transaction']
                    and terminal['outcome'] in ('returned', 'declined')
                    and all(re.fullmatch(r'[0-9a-f]{64}', str(terminal[key])) for key in
                            ('root_ledger_sha256', 'root_receipt_sha256')),
                    'NATS transfer closure is incomplete')
            return None
        require(row is self.records[-1], 'NATS transfer intent is no longer terminal')
        return row

    def complete_nats_outcome(self):
        require(self.scope == FULL_NODE_SCOPE and self.node_lock is not None,
                'NATS outcome requires the full-node preservation owner')
        require(not self.write_failed and self._read() == self.records,
                'NATS outcome requires the exact durable user journal')
        transfer = self.nats_transfer_open()
        require(transfer is not None, 'NATS transfer is not awaiting a root outcome')
        require_no_nats_marker()
        receipt = read_nats_root_outcome(transfer['root_transaction'])
        require(receipt['user_journal_root'] == str(self.root.resolve())
                and receipt['user_baseline_sha256'] == self.records[0]['sha256']
                and receipt['user_transfer_sha256'] == transfer['sha256'],
                'root NATS outcome does not bind this user transfer')
        require_no_nats_marker()
        return self._append_durable('nats-transfer-closed',
                                    root_transaction=transfer['root_transaction'],
                                    outcome=receipt['outcome'],
                                    root_ledger_sha256=receipt['ledger_sha256'],
                                    root_receipt_sha256=hashlib.sha256(encoded(receipt)).hexdigest())

    def transfer_nats(self, root_transaction, hold, observe):
        require(not (sys.platform == 'darwin' and NATS_WRITER_MARKER ==
                     pathlib.Path('/private/var/db/openclaw-nats/writer-handoff.json')),
                'production NATS transfer awaits root decline and journal validation')
        require(self.scope == FULL_NODE_SCOPE and self.node_lock is not None,
                'NATS transfer requires the full-node preservation owner')
        require(hold is not None and hold.journal is self and callable(observe),
                'NATS transfer requires the original execution hold and observations')
        try:
            require(str(uuid.UUID(root_transaction)) == root_transaction,
                    'NATS transfer transaction is not canonical')
        except (TypeError, ValueError) as error:
            raise Refused('NATS transfer transaction is invalid') from error
        self.require_forward()
        require(self.nats_transfer_open() is None, 'NATS transfer already exists')
        require_no_nats_marker()
        entrypoints = self.check_entrypoints(forward=True)
        hold_evidence = hold.check_forward()
        names = {'ai.openclaw.' + unit for unit in NATS_TRANSFER_UNITS}
        require(not any(names & set(labels) for labels in entrypoints['loaded'].values()),
                'legacy NATS job is still loaded')
        observations = {}
        for unit in NATS_TRANSFER_UNITS:
            prior = self.prior[unit]
            actual = observe(unit, prior)
            require(isinstance(actual, dict) and actual.get('verified') is True
                    and actual.get('identity') == prior['identity']
                    and all(isinstance(actual.get(key), bool) for key in ('loaded', 'running', 'disabled')),
                    'NATS transfer observation is incomplete: ' + unit)
            if unit == 'nats-1':
                require(matches(actual, prior), 'held member-1 changed before transfer')
            else:
                require(not actual['loaded'] and not actual['running'],
                        'legacy NATS writer is still active: ' + unit)
                require(any(row['event'] == 'verified' and row.get('unit') == unit
                            and row.get('action') in ('unload', 'disable-and-unload')
                            for row in self.records),
                        'legacy NATS stop has no verified journal receipt: ' + unit)
            observations[unit] = actual
        require_no_nats_marker()
        hold.check_forward()
        self.check_entrypoints(forward=True)
        return self.append('nats-transfer-intent', root_transaction=root_transaction,
                           units=list(NATS_TRANSFER_UNITS), baseline_sha256=self.records[0]['sha256'],
                           observations=observations,
                           hold_sha256=hashlib.sha256(encoded(hold_evidence)).hexdigest(),
                           hold_evidence=hold_evidence)

    def pending_intents(self):
        completed = {r['intent'] for r in self.records if r['event'] == 'verified'}
        return [r for r in self.records if r['event'] == 'intent' and r['sequence'] not in completed]

    def require_forward(self):
        require(not any(row['event'] == 'nats-transfer-intent' for row in self.records),
                'returned NATS transfer is restore-only')
        require(not self.write_failed, 'failed durable write requires reopening the journal')
        require(self.boot == self.records[0]['boot'], 'reboot invalidated preservation; restore prior services only')
        require(not self.reopened, 'reopened preservation may only restore prior services')
        require(not any(r['event'] in ('failed', 'recovery-started') for r in self.records),
                'interrupted preservation may only restore prior services')
        require(not self.pending_intents() and not list(self.root.glob('.pending-*')),
                'incomplete durable intent may only restore prior services')

    def mutate(self, unit, action, apply, verify, failure_evidence=None, intent_fields=None, hold=None):
        require(self.scope != TIMER_SCOPE or unit == 'scheduler-heartbeat'
                and action == 'close-execution-hold' and not any(r['event'] == 'intent' for r in self.records)
                and isinstance(intent_fields, dict) and 'hold' in intent_fields,
                'timer commissioning cannot mutate other services or forward work')
        require(unit in self.prior, 'unit was not in the prior-state inventory')
        require(unit in RESUME_ORDER, 'held or unknown unit cannot be mutated')
        require(self.prior[unit]['class'] != 'held', 'held unit cannot be mutated')
        require(self.prior[unit]['class'] != 'absent', 'absent unit cannot be mutated')
        self.require_forward()
        self.check_entrypoints(forward=True)
        held = 'execution_hold' in self.prior['scheduler-heartbeat']
        require((hold is not None) == held and (not held or hold.journal is self),
                'baselined execution hold requires its forward facade')
        if held:
            hold.check_forward()
        fields = intent_fields or {}
        require(isinstance(fields, dict) and not set(fields) & {'unit', 'action'},
                'intent fields cannot replace the mutation owner')
        intent = self.append('intent', unit=unit, action=action, **fields)
        try:
            apply()
            if held:
                hold.check_forward()
            expected = next((row['evidence']['entrypoint_loaded'] for row in reversed(self.records)
                             if row['event'] == 'verified'
                             and 'entrypoint_loaded' in row.get('evidence', {})),
                            self.entrypoint_inventory['loaded'] if self.scope == FULL_NODE_SCOPE else None)
            if self.scope == FULL_NODE_SCOPE and action in ('stop', 'unload', 'disable-and-unload'):
                expected = {domain: sorted(set(labels) - {'ai.openclaw.' + unit})
                            for domain, labels in expected.items()}
            before_verify = self.check_entrypoints(forward=True, expected_loaded=expected)
            evidence = verify()
            require(isinstance(evidence, dict) and evidence.get('verified') is True,
                    'mutation lacks verified evidence')
            if self.scope == FULL_NODE_SCOPE:
                after_verify = self.check_entrypoints(forward=True, expected_loaded=expected)
                require(after_verify['loaded'] == before_verify['loaded'],
                        'full-node job changed during mutation verification')
                evidence = {**evidence, 'entrypoint_loaded': after_verify['loaded']}
            self.append('verified', intent=intent['sequence'], unit=unit, action=action, evidence=evidence)
            return evidence
        except Exception as error:
            if not self.write_failed:
                detail = {} if failure_evidence is None else {'evidence': failure_evidence(error)}
                self.append('failed', intent=intent['sequence'], unit=unit, action=action,
                            error_type=type(error).__name__, **detail)
            raise

    def recover(self, restore, observe, final_check, diagnostics=None, hold=None):
        require(self.nats_transfer_open() is None, 'NATS transfer is open; await a root outcome')
        nats_guarded = self.scope == FULL_NODE_SCOPE or (self.scope is None and any(
            self.prior[unit]['class'] != 'absent' for unit in NATS_TRANSFER_UNITS))
        if nats_guarded:
            require_no_nats_marker()
        require(self.node_lock is not None and (self.lock is not None or self.write_failed),
                'recovery requires the node lock')
        require(not self.sealed, 'sealed journal cannot restore services')
        require(callable(final_check), 'recovery requires final physical ownership checks')
        held = 'execution_hold' in self.prior['scheduler-heartbeat']
        require((hold is not None) == held and (not held or hold.journal is self),
                'baselined execution hold requires its journal recovery facade')
        if held:
            guard = nats_legacy_restore_guard() if nats_guarded else contextlib.nullcontext()
            with guard:
                hold.prepare(observe, final_check)
        errors = []
        diagnostics = diagnostics or (lambda row: print(json.dumps(row), file=sys.stderr, flush=True))
        def record(event, **data):
            try:
                self.append(event, **data)
            except (OSError, Refused, TypeError, ValueError, OverflowError) as error:
                self.write_failed = True
                if held:
                    raise
                if not any(e['unit'] == 'journal' for e in errors):
                    errors.append({'unit': 'journal', 'reason': type(error).__name__})
                try:
                    diagnostics({'event': event, 'unit': data.get('unit'), 'evidence_durable': False,
                                 'error_type': type(error).__name__})
                except Exception:
                    if not any(e['unit'] == 'diagnostics' for e in errors):
                        errors.append({'unit': 'diagnostics', 'reason': 'undurable diagnostics unavailable'})
        try:
            self._state({**self.active, 'status': 'unresolved',
                         'holder': {'pid': os.getpid(), 'boot': self.boot}})
        except (OSError, Refused, TypeError, ValueError) as error:
            self.write_failed = True
            if held:
                raise
            errors.append({'unit': 'journal', 'reason': type(error).__name__})
        excluded_anchor = None
        excluded_unchanged = False
        if self.scope == FULL_NODE_SCOPE:
            try:
                excluded_anchor = capture_entrypoint_inventory(UNITS)['excluded']
                excluded_unchanged = excluded_anchor == self.entrypoint_inventory['excluded']
            except Exception:
                pass
        exclusion = ({'entrypoint_excluded': excluded_anchor,
                      'excluded_unchanged_since_baseline': excluded_unchanged}
                     if self.scope == FULL_NODE_SCOPE else {})
        record('recovery-started', original_boot=self.records[0]['boot'], **exclusion)
        try:
            self.check_entrypoints()
        except Exception as error:
            errors.append({'unit': 'entrypoints', 'reason': type(error).__name__,
                           'detail': str(error)})
        buses_ready = True
        for unit in (u for u in RESUME_ORDER if u in self.prior):
            if not unit.startswith('nats') and not buses_ready:
                errors.append({'unit': unit, 'reason': 'bus recovery was not verified'})
                continue
            prior = self.prior[unit]
            def verify():
                actual = observe(unit, prior)
                require(actual.get('identity') == prior['identity'], 'immutable service identity changed')
                require(matches(actual, prior), 'prior service state was not restored')
                require(actual.get('verified') is True, 'service readiness was not verified')
                return actual
            committed = None
            try:
                guard = (nats_legacy_restore_guard() if nats_guarded
                         and unit in NATS_TRANSFER_UNITS else contextlib.nullcontext())
                with guard as precommit:
                    actual = observe(unit, prior)
                    require(all(isinstance(actual.get(k), bool) for k in ('loaded', 'running', 'disabled')),
                            'actual service state is incomplete')
                    require(actual.get('identity') == prior['identity'], 'immutable service identity changed')
                    record('recovery-observed', unit=unit, evidence=actual)
                    if matches(actual, prior):
                        require(actual.get('verified') is True, 'existing service readiness was not verified')
                        record('already-restored', unit=unit, evidence=actual)
                        continue
                    require(prior['class'] not in ('held', 'absent'), 'held or absent unit needs manual restoration')
                    require(not (prior['class'] == 'timer' and actual['loaded'] and actual['running']),
                            'timer is busy; re-observe after its current run')
                    require(not (prior['class'] == 'on-demand' and actual['loaded'] and actual['running']),
                            'on-demand worker is running; operator handoff required')
                    if held:
                        hold.before_restore()
                    record('restoration-intent', unit=unit, action='restore-prior')
                    if precommit is not None:
                        precommit()
                        committed = 'restore'
                    restore(unit, prior)
                    if held:
                        hold.check_closed()
                    evidence = verify()
                    record('recovery-verified', unit=unit, evidence=evidence)
            except Exception as error:
                errors.append({'unit': unit, 'reason': type(error).__name__,
                               **({'after_commit': committed} if committed else {})})
                if held and self.write_failed:
                    break
                if unit.startswith('nats'):
                    buses_ready = False
        for unit in (u for u in self.prior if u not in RESUME_ORDER and not (held and self.write_failed)):
            try:
                require(unit in ('nats-1', 'federation-tick'), 'unknown unit needs manual restoration')
                guard = (nats_legacy_restore_guard() if nats_guarded
                         and unit in NATS_TRANSFER_UNITS else contextlib.nullcontext())
                with guard:
                    actual = observe(unit, self.prior[unit])
                    require(matches(actual, self.prior[unit]) and actual.get('verified') is True
                            and actual.get('identity') == self.prior[unit]['identity'],
                            'non-running installed unit or member-1 hold changed')
                    record('held-unit-verified' if unit == 'nats-1' else 'unloaded-unit-verified',
                           unit=unit, evidence=actual)
            except Exception as error:
                errors.append({'unit': unit, 'reason': type(error).__name__})
        try:
            guard = nats_legacy_restore_guard() if nats_guarded else contextlib.nullcontext()
            with guard:
                evidence = final_check()
                require(isinstance(evidence, dict) and evidence.get('verified') is True,
                        'final physical ownership or member-1 hold was not verified')
                self.check_entrypoints(final=True)
                record('final-state-verified', evidence=evidence)
        except Exception as error:
            errors.append({'unit': 'final-state', 'reason': type(error).__name__})
        if held and not errors and not self.write_failed:
            before_complete = len(self.records)
            gate_was_closed = False
            try:
                if hasattr(hold, 'gate'):
                    gate_was_closed = hold.gate.marker() is not None
                guard = nats_legacy_restore_guard() if nats_guarded else contextlib.nullcontext()
                with guard as precommit:
                    evidence = hold.complete(observe, final_check, precommit)
                    require(isinstance(evidence, dict) and evidence.get('verified') is True,
                            'execution hold restoration was not verified')
                    record('execution-hold-restored', evidence=evidence)
            except Exception as error:
                try:
                    observed_open = gate_was_closed and hold.gate.marker() is None
                except Exception:
                    observed_open = False
                opened = observed_open or any(row['event'] == 'hold-opened'
                                              for row in self.records[before_complete:])
                errors.append({'unit': 'execution-hold', 'reason': type(error).__name__,
                               **({'after_commit': 'gate-open'} if opened else {})})
        record('recovery-finished', services_verified=not any(e['unit'] not in ('journal', 'diagnostics')
                                                           for e in errors), errors=list(errors))
        if not errors:
            try:
                self._state({**self.active, 'status': 'restored', 'head': self.records[-1]['sha256']})
            except (OSError, Refused, TypeError, ValueError) as error:
                errors.append({'unit': 'journal', 'reason': type(error).__name__})
                try:
                    diagnostics({'event': 'restoration-receipt-failed', 'evidence_durable': False,
                                 'error_type': type(error).__name__})
                except Exception:
                    errors.append({'unit': 'diagnostics', 'reason': 'undurable diagnostics unavailable'})
        return {'restored': not errors, 'services_verified': not any(e['unit'] not in ('journal', 'diagnostics') for e in errors),
                'evidence_durable': not any(e['unit'] == 'journal' for e in errors), 'errors': errors}

    def seal(self):
        require(self.scope != TIMER_SCOPE, 'timer commissioning cannot seal preservation history')
        self.check_entrypoints(final=True)
        require(not self.reopened and not self.write_failed, 'interrupted window cannot be sealed')
        require(not self.pending_intents() and not any(r['event'] == 'failed' for r in self.records),
                'failed forward window cannot be sealed')
        return self._finalize('sealed')

    def resolve(self):
        require(not self.write_failed, 'undurable history needs manual resolution')
        return self._finalize('resolved')

    def _finalize(self, event):
        require(event != 'sealed' or self.scope != FULL_NODE_SCOPE,
                'full-node seal requires a continuous launchd and process watch')
        nats_guarded = self.scope == FULL_NODE_SCOPE or (self.scope is None and any(
            self.prior[unit]['class'] != 'absent' for unit in NATS_TRANSFER_UNITS))
        guard = nats_legacy_restore_guard() if nats_guarded else contextlib.nullcontext()
        committed = None
        try:
            with guard as precommit:
                require(self.records[-1]['event'] == 'recovery-finished'
                        and self.records[-1]['services_verified'] is True and not self.records[-1]['errors'],
                        'unrestored node cannot be sealed')
                state = read_private(self.node_state)
                require(state['status'] == 'restored' and state.get('head') == self.records[-1]['sha256'],
                        'node restoration receipt is not durable')
                self.check_entrypoints(final=True)
                if precommit is not None:
                    precommit()
                record = self.append(event)
                committed = record['sha256']
                self.sealed = True
                self._state({**self.active, 'status': 'restored', 'head': committed})
            return committed
        except Exception as error:
            if committed is not None:
                raise CommittedRefusal(f'{event} committed at {committed}; {error}') from error
            raise

    def close(self):
        if self.lock is not None:
            self.lock.close()
            self.lock = None
        if self.node_lock is not None:
            self.node_lock.close()
            self.node_lock = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
