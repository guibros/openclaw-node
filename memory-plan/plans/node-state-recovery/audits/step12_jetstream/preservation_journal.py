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
        value = subprocess.check_output(['/usr/sbin/sysctl', '-n', 'kern.boottime'], text=True)
    else:
        value = pathlib.Path('/proc/sys/kernel/random/boot_id').read_text()
    return hashlib.sha256(value.strip().encode()).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sync_dir(root):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Journal:
    def __init__(self, root, prior=None, boot=None):
        self.root = pathlib.Path(root)
        self.boot = boot if boot is not None else boot_identity()
        self.lock = None
        self.write_failed = False
        created = not self.root.exists()
        if created:
            require(prior is not None, 'new journal requires the complete prior state')
            self.root.mkdir(mode=0o700)
            sync_dir(self.root.parent)
        info = self.root.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'journal directory is not owner-private')
        fd = os.open(self.root / '.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        self.lock = os.fdopen(fd, 'r+')
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                    and stat.S_IMODE(info.st_mode) == 0o600, 'journal lock is not owner-private')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise Refused('another process owns the recovery journal') from error
            self.records = self._read()
            if created:
                require(prior and all(isinstance(s.get(k), bool) for s in prior.values()
                                      for k in ('loaded', 'running', 'disabled')), 'prior service state is incomplete')
                self.append('baseline', prior=prior)
            else:
                require(prior is None, 'cannot replace a journal baseline')
                require(self.records and self.records[0]['event'] == 'baseline', 'journal baseline is absent')
            self.prior = self.records[0]['prior']
        except BaseException:
            self.close()
            raise

    def _read(self):
        records = []
        files = sorted(p for p in self.root.iterdir() if re.fullmatch(r'\d{6}\.json', p.name))
        previous = None
        for index, path in enumerate(files):
            require(path.name == f'{index:06d}.json', 'journal sequence has a gap')
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                    and stat.S_IMODE(info.st_mode) == 0o600, 'journal record is not owner-private')
            try:
                record = json.loads(path.read_bytes())
                digest = record.pop('sha256')
                require(record['sequence'] == index and record['previous'] == previous,
                        'journal chain is inconsistent')
                require(hashlib.sha256(encoded(record)).hexdigest() == digest, 'journal record content changed')
            except (ValueError, KeyError) as error:
                raise Refused('journal record is incomplete') from error
            record['sha256'] = digest
            records.append(record)
            previous = digest
        return records

    def append(self, event, **data):
        require(self.lock is not None, 'journal is closed')
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
            os.fsync(handle.fileno())
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
        require(not any(r['event'] in ('failed', 'recovery-started') for r in self.records),
                'interrupted preservation may only restore prior services')
        require(not self.pending_intents() and not list(self.root.glob('.pending-*')),
                'incomplete durable intent may only restore prior services')

    def mutate(self, unit, action, apply, verify, recovery=False):
        require(unit in self.prior, 'unit was not in the prior-state inventory')
        if not recovery:
            self.require_forward()
        else:
            require(any(r['event'] == 'recovery-started' for r in self.records), 'recovery was not journalled')
        intent = self.append('intent', unit=unit, action=action)
        try:
            apply()
            evidence = verify()
            require(isinstance(evidence, dict) and evidence.get('verified') is True,
                    'mutation lacks verified evidence')
            self.append('verified', intent=intent['sequence'], unit=unit, action=action, evidence=evidence)
            return evidence
        except Exception as error:
            self.append('failed', intent=intent['sequence'], unit=unit, action=action,
                        error_type=type(error).__name__)
            raise

    def recover(self, order, restore, observe, final_check):
        changed = {r['unit'] for r in self.records if r['event'] == 'intent'}
        require(len(order) == len(set(order)) and changed <= set(order), 'recovery order omits an affected unit')
        require(list(order) == [unit for unit in RESUME_ORDER if unit in order], 'recovery order violates service dependencies')
        require(callable(final_check), 'recovery requires final physical ownership checks')
        self.append('recovery-started', original_boot=self.records[0]['boot'])
        errors = []
        buses_ready = True
        for unit in order:
            if unit not in changed:
                continue
            if not unit.startswith('nats') and not buses_ready:
                errors.append({'unit': unit, 'reason': 'bus recovery was not verified'})
                continue
            prior = self.prior[unit]
            def verify():
                actual = observe(unit, prior)
                require(all(actual[k] == prior[k] for k in ('loaded', 'running', 'disabled')),
                        'prior service state was not restored')
                require(actual.get('verified') is True, 'service readiness was not verified')
                return actual
            try:
                actual = observe(unit, prior)
                require(all(isinstance(actual.get(k), bool) for k in ('loaded', 'running', 'disabled')),
                        'actual service state is incomplete')
                self.append('recovery-observed', unit=unit, evidence=actual)
                if all(actual[k] == prior[k] for k in ('loaded', 'running', 'disabled')):
                    require(actual.get('verified') is True, 'existing service readiness was not verified')
                    self.append('already-restored', unit=unit, evidence=actual)
                    continue
                self.mutate(unit, 'restore-prior', lambda: restore(unit, prior), verify, recovery=True)
            except Exception as error:
                errors.append({'unit': unit, 'reason': type(error).__name__})
                if unit.startswith('nats'):
                    buses_ready = False
        if not errors:
            try:
                evidence = final_check()
                require(isinstance(evidence, dict) and evidence.get('verified') is True,
                        'final physical ownership or member-1 hold was not verified')
                self.append('final-state-verified', evidence=evidence)
            except Exception as error:
                errors.append({'unit': 'final-state', 'reason': type(error).__name__})
        self.append('recovery-finished', restored=not errors, errors=errors)
        return {'restored': not errors, 'errors': errors}

    def close(self):
        if self.lock is not None:
            self.lock.close()
            self.lock = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
