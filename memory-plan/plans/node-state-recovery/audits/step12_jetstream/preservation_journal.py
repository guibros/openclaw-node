import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import uuid

from preservation_checks import RESUME_ORDER, Refused, require


def boot_identity():
    if sys.platform == 'darwin':
        value = subprocess.check_output(['/usr/sbin/sysctl', '-n', 'kern.bootsessionuuid'], text=True)
    else:
        value = pathlib.Path('/proc/sys/kernel/random/boot_id').read_text()
    return hashlib.sha256(value.strip().encode()).hexdigest()


def encoded(value):
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
    body = {k: v for k, v in record.items() if k != 'sha256'}
    require(hashlib.sha256(encoded(body)).hexdigest() == record['sha256'], 'journal record content changed')
    return record


def matches(actual, prior):
    keys = ('loaded', 'disabled') if prior['class'] == 'known-broken' else ('loaded', 'running', 'disabled')
    return all(actual.get(k) == prior[k] for k in keys)


class Journal:
    def __init__(self, root, prior=None, boot=None, node_lock=None):
        self.root = pathlib.Path(root)
        self.boot = boot if boot is not None else boot_identity()
        self.lock = None
        self.node_lock = None
        self.write_failed = False
        self.sealed = False
        created = not self.root.exists()
        self.reopened = not created
        node_lock = pathlib.Path(node_lock) if node_lock is not None else pathlib.Path.home() / '.openclaw/run/preservation.lock'
        node_lock.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = node_lock.parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'node lock directory is not owner-private')
        self.node_lock = self._lock(node_lock)
        self.node_state = node_lock.with_name(node_lock.name + '.state.json')
        try:
            self.active = read_private(self.node_state) if os.path.lexists(self.node_state) else None
            if self.active is not None:
                valid_record(self.active['baseline'])
                require(not created or self.active['status'] == 'restored', 'prior node recovery is unresolved')
                require(created or self.active['journal_root'] == str(self.root.resolve()),
                        'another journal owns the node recovery inventory')
                if created:
                    records = self._read(pathlib.Path(self.active['journal_root']))
                    require(records and records[-1]['sha256'] == self.active.get('head'),
                            'prior node restoration head differs')
            self._open(created, prior)
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

    def _open(self, created, prior):
        if created:
            require(prior is not None, 'new journal requires the complete prior state')
            self.root.mkdir(mode=0o700)
            sync_dir(self.root.parent)
        info = self.root.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'journal directory is not owner-private')
        self.lock = self._lock(self.root / '.lock')
        try:
            self.records = self._read()
            require(created or self.records and self.records[0]['event'] == 'baseline', 'journal baseline is absent')
        except Refused:
            require(not created and self.active is not None, 'validated baseline copy is absent')
            self.records = [self.active['baseline']]
            self.write_failed = True
        if created:
            require(prior and all(isinstance(s.get(k), bool) for s in prior.values()
                                  for k in ('loaded', 'running', 'disabled')), 'prior service state is incomplete')
            require(all(isinstance(s.get('identity'), dict) and s['identity'] for s in prior.values()),
                    'prior immutable service identity is absent')
            for state in prior.values():
                require(state.get('class') in ('daemon', 'timer', 'known-broken', 'held'), 'service class is absent')
                require((state['class'] != 'daemon' or state['loaded'] and state['running'] and not state['disabled'])
                        and (state['class'] != 'timer' or state['loaded'] and not state['running'] and not state['disabled'])
                        and (state['class'] != 'known-broken' or state['loaded'] and not state['disabled'])
                        and (state['class'] != 'held' or not state['loaded'] and not state['running'] and state['disabled']),
                        'baseline does not match the declared desired service state')
            self.append('baseline', prior=prior)
            require(read_private(self.root / '000000.json') == self.records[0], 'baseline readback differs')
            write_private(self.node_state, {'journal_root': str(self.root.resolve()), 'baseline': self.records[0],
                          'status': 'unresolved', 'holder': {'pid': os.getpid(), 'boot': self.boot}})
            self.active = read_private(self.node_state)
        else:
            require(prior is None, 'cannot replace a journal baseline')
            require(self.records and self.records[0]['event'] == 'baseline', 'journal baseline is absent')
            require(self.active is not None and self.active['baseline'] == self.records[0], 'baseline copy differs')
            require(not any(r['event'] == 'sealed' for r in self.records), 'sealed journal cannot be reopened for writing')
        self.prior = json.loads(encoded(self.records[0]['prior']))

    def _read(self, root=None):
        records = []
        files = sorted(p for p in (root or self.root).iterdir() if re.fullmatch(r'\d{6}\.json', p.name))
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

    def append(self, event, **data):
        require(self.lock is not None, 'journal is closed')
        require(not self.sealed, 'sealed journal cannot be changed')
        require(not self.write_failed, 'failed durable write requires reopening the journal')
        require(not set(data) & {'sequence', 'previous', 'sha256', 'event', 'boot', 'at'},
                'journal metadata cannot be replaced')
        record = {'sequence': len(self.records), 'previous': self.records[-1]['sha256'] if self.records else None,
                  'event': event, 'boot': self.boot,
                  'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **data}
        record['sha256'] = hashlib.sha256(encoded(record)).hexdigest()
        self.write_failed = True
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

    def pending_intents(self):
        completed = {r['intent'] for r in self.records if r['event'] == 'verified'}
        return [r for r in self.records if r['event'] == 'intent' and r['sequence'] not in completed]

    def require_forward(self):
        require(not self.write_failed, 'failed durable write requires reopening the journal')
        require(self.boot == self.records[0]['boot'], 'reboot invalidated preservation; restore prior services only')
        require(not self.reopened, 'reopened preservation may only restore prior services')
        require(not any(r['event'] in ('failed', 'recovery-started') for r in self.records),
                'interrupted preservation may only restore prior services')
        require(not self.pending_intents() and not list(self.root.glob('.pending-*')),
                'incomplete durable intent may only restore prior services')

    def mutate(self, unit, action, apply, verify):
        require(unit in self.prior, 'unit was not in the prior-state inventory')
        require(unit in RESUME_ORDER, 'held or unknown unit cannot be mutated')
        require(self.prior[unit]['class'] != 'held', 'held unit cannot be mutated')
        self.require_forward()
        intent = self.append('intent', unit=unit, action=action)
        try:
            apply()
            evidence = verify()
            require(isinstance(evidence, dict) and evidence.get('verified') is True,
                    'mutation lacks verified evidence')
            self.append('verified', intent=intent['sequence'], unit=unit, action=action, evidence=evidence)
            return evidence
        except Exception as error:
            if not self.write_failed:
                self.append('failed', intent=intent['sequence'], unit=unit, action=action,
                            error_type=type(error).__name__)
            raise

    def recover(self, restore, observe, final_check, diagnostics=None):
        require(self.lock is not None and self.node_lock is not None, 'recovery requires the node lock')
        require(not self.sealed, 'sealed journal cannot restore services')
        require(callable(final_check), 'recovery requires final physical ownership checks')
        errors = []
        diagnostics = diagnostics or (lambda row: print(json.dumps(row), file=sys.stderr, flush=True))
        def record(event, **data):
            try:
                self.append(event, **data)
            except (OSError, Refused) as error:
                if not any(e['unit'] == 'journal' for e in errors):
                    errors.append({'unit': 'journal', 'reason': type(error).__name__})
                try:
                    diagnostics({'event': event, 'unit': data.get('unit'), 'evidence_durable': False,
                                 'error_type': type(error).__name__})
                except OSError:
                    if not any(e['unit'] == 'diagnostics' for e in errors):
                        errors.append({'unit': 'diagnostics', 'reason': 'undurable diagnostics unavailable'})
        try:
            write_private(self.node_state, {**self.active, 'status': 'unresolved',
                          'holder': {'pid': os.getpid(), 'boot': self.boot}})
        except OSError as error:
            self.write_failed = True
            errors.append({'unit': 'journal', 'reason': type(error).__name__})
        record('recovery-started', original_boot=self.records[0]['boot'])
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
            try:
                actual = observe(unit, prior)
                require(all(isinstance(actual.get(k), bool) for k in ('loaded', 'running', 'disabled')),
                        'actual service state is incomplete')
                require(actual.get('identity') == prior['identity'], 'immutable service identity changed')
                record('recovery-observed', unit=unit, evidence=actual)
                if matches(actual, prior):
                    require(actual.get('verified') is True, 'existing service readiness was not verified')
                    record('already-restored', unit=unit, evidence=actual)
                    continue
                require(prior['class'] != 'held', 'held unit needs manual restoration')
                record('restoration-intent', unit=unit, action='restore-prior')
                restore(unit, prior)
                evidence = verify()
                record('recovery-verified', unit=unit, evidence=evidence)
            except Exception as error:
                errors.append({'unit': unit, 'reason': type(error).__name__})
                if unit.startswith('nats'):
                    buses_ready = False
        for unit in (u for u in self.prior if u not in RESUME_ORDER):
            try:
                require(unit == 'nats-1', 'unknown unit needs manual restoration')
                actual = observe(unit, self.prior[unit])
                require(actual.get('disabled') is True and actual.get('loaded') is False
                        and actual.get('running') is False and actual.get('verified') is True
                        and actual.get('identity') == self.prior[unit]['identity'], 'member-1 hold changed')
                record('held-unit-verified', unit=unit, evidence=actual)
            except Exception as error:
                errors.append({'unit': unit, 'reason': type(error).__name__})
        try:
            evidence = final_check()
            require(isinstance(evidence, dict) and evidence.get('verified') is True,
                    'final physical ownership or member-1 hold was not verified')
            record('final-state-verified', evidence=evidence)
        except Exception as error:
            errors.append({'unit': 'final-state', 'reason': type(error).__name__})
        record('recovery-finished', restored=not errors, errors=errors)
        if not errors:
            try:
                write_private(self.node_state, {**self.active, 'status': 'restored',
                              'head': self.records[-1]['sha256']})
            except OSError as error:
                errors.append({'unit': 'journal', 'reason': type(error).__name__})
        return {'restored': not errors, 'services_verified': not any(e['unit'] not in ('journal', 'diagnostics') for e in errors),
                'evidence_durable': not any(e['unit'] == 'journal' for e in errors), 'errors': errors}

    def seal(self):
        require(not self.reopened and not self.write_failed, 'interrupted window cannot be sealed')
        require(not self.pending_intents() and not any(r['event'] == 'failed' for r in self.records),
                'failed forward window cannot be sealed')
        require(self.records[-1]['event'] == 'recovery-finished' and self.records[-1]['restored'] is True,
                'unrestored node cannot be sealed')
        state = read_private(self.node_state)
        require(state['status'] == 'restored' and state.get('head') == self.records[-1]['sha256'],
                'node restoration receipt is not durable')
        record = self.append('sealed')
        self.sealed = True
        write_private(self.node_state, {**self.active, 'status': 'restored', 'head': record['sha256']})
        return record['sha256']

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
