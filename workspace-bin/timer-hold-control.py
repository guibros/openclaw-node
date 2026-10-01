#!/usr/bin/env python3
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import time


HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE.parent / 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'
BACKUPS = pathlib.Path.home() / '.openclaw/backups/node-readiness'
TRANSITION = BACKUPS / 'timer-transition-candidate-20260930-3'
ENTRIES = BACKUPS / 'timer-entry-candidate-20260930-5'
FILES = ('timer-hold-control.py', 'install-timer-hold.py', 'preservation_journal.py',
         'preservation_checks.py', 'journal_hold.py')
TIMERS = ('scheduler-heartbeat', 'consolidation-scheduler', 'observer',
          'transcript-archive', 'log-rotate')


def sha(path):
    value = hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def private(path, directory=False):
    info = pathlib.Path(path).lstat()
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if not kind(info.st_mode) or info.st_uid != os.getuid() \
            or stat.S_IMODE(info.st_mode) != (0o700 if directory else 0o600) \
            or not directory and info.st_nlink != 1:
        raise RuntimeError('timer control artifact is not owner-private: ' + str(path))


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
        if sys.platform == 'darwin':
            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
    finally:
        os.close(fd)


def stage(output):
    output = pathlib.Path(output).resolve()
    if output.parent != BACKUPS or os.path.lexists(output):
        raise RuntimeError('timer control output must be a new child of the private backup root')
    private(BACKUPS, directory=True)
    staged = pathlib.Path(tempfile.mkdtemp(prefix='.' + output.name + '-', dir=BACKUPS))
    try:
        for name in FILES:
            source = SOURCE / name if name in FILES[2:] else HERE / name
            dest = staged / name
            shutil.copyfile(source, dest)
            dest.chmod(0o600)
        manifest = {'version': 1, 'files': {name: sha(staged / name) for name in FILES},
                    'transition_sha256': sha(TRANSITION / 'transition-manifest.json'),
                    'entries_sha256': sha(ENTRIES / 'timer-entry-manifest.json')}
        path = staged / 'timer-control-manifest.json'
        path.write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n')
        path.chmod(0o600)
        for name in (*FILES, path.name):
            fd = os.open(staged / name, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        sync_dir(staged)
        os.replace(staged, output)
        sync_dir(output.parent)
        for name in (*FILES, path.name):
            os.chflags(output / name, stat.UF_IMMUTABLE)
        return {'root': str(output), 'manifest_sha256': sha(output / path.name)}
    except BaseException:
        shutil.rmtree(staged, ignore_errors=True)
        raise


def verify_bundle(root, expected):
    root = pathlib.Path(root).resolve()
    private(root, directory=True)
    manifest_path = root / 'timer-control-manifest.json'
    private(manifest_path)
    if sha(manifest_path) != expected:
        raise RuntimeError('timer control manifest differs from its pinned hash')
    data = json.loads(manifest_path.read_text())
    if data['version'] != 1 or set(data['files']) != set(FILES) \
            or data['transition_sha256'] != sha(TRANSITION / 'transition-manifest.json') \
            or data['entries_sha256'] != sha(ENTRIES / 'timer-entry-manifest.json'):
        raise RuntimeError('timer control manifest differs from the accepted artifacts')
    for name, expected_hash in data['files'].items():
        path = root / name
        private(path)
        if sha(path) != expected_hash or not path.stat().st_flags & stat.UF_IMMUTABLE:
            raise RuntimeError('timer control code differs or is writable: ' + name)
    if not manifest_path.stat().st_flags & stat.UF_IMMUTABLE:
        raise RuntimeError('timer control manifest is writable')
    return data


def modules(root):
    sys.path.insert(0, str(root))
    from preservation_journal import Journal, TIMER_SCOPE, TIMER_UNITS, matches, static_identity, read_private
    from journal_hold import JournaledHold, describe
    spec = importlib.util.spec_from_file_location('timer_install', root / 'install-timer-hold.py')
    install = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(install)
    gate_path = ENTRIES / 'service_gate.py'
    manifest = json.loads((ENTRIES / 'timer-entry-manifest.json').read_text())
    private(gate_path)
    if sha(gate_path) != manifest['files'][str(gate_path)]:
        raise RuntimeError('timer gate implementation differs before import')
    gate_spec = importlib.util.spec_from_file_location('timer_gate', gate_path)
    gate = importlib.util.module_from_spec(gate_spec)
    gate_spec.loader.exec_module(gate)
    return Journal, TIMER_SCOPE, TIMER_UNITS, matches, static_identity, read_private, JournaledHold, describe, install, gate


class TimerAdapter:
    def __init__(self, installer, baseline, matches, static_identity):
        self.installer = installer
        self.baseline = baseline
        self.matches = matches
        self.static_identity = static_identity

    def identity(self, unit):
        self.installer.verify_artifacts()
        entries = self.installer.entry_data
        files = [ENTRIES / 'timer-entry-manifest.json', ENTRIES / 'timer-entry.py',
                 ENTRIES / 'service_gate.py', *map(pathlib.Path, entries['jobs'][self.installer.label(unit)]['source'])]
        return self.static_identity(self.installer.plist_path(unit), files)

    def state(self, unit):
        row = self.installer.state(unit)
        if row['source']['kind'] != 'old' or row['disk'] != 'new' \
                or row['loaded']['kind'] not in ('new', 'none'):
            raise RuntimeError('timer physical entry differs: ' + unit)
        return row['loaded']

    def observe(self, unit, prior):
        loaded = self.state(unit)
        identity = self.identity(unit)
        result = {'loaded': loaded['kind'] == 'new', 'running': loaded['running'],
                  'disabled': False, 'identity': identity}
        result['verified'] = self.matches(result, prior) and identity == prior['identity']
        return result

    def restore(self, unit, prior):
        loaded = self.state(unit)
        if loaded['kind'] != 'none' or prior['class'] != 'timer' \
                or self.identity(unit) != prior['identity']:
            raise RuntimeError('timer restoration requires a missing exact candidate job: ' + unit)
        self.installer.bootstrap(unit)
        if not self.observe(unit, prior)['verified']:
            raise RuntimeError('timer did not return to the saved idle state: ' + unit)

    def final_check(self):
        states = {unit: self.observe(unit, self.prior[unit]) for unit in TIMERS}
        if not all(value['verified'] for value in states.values()):
            raise RuntimeError('five-timer physical readiness differs')
        return {'verified': True, 'checked_units': len(states)}

    def fast_check(self):
        for unit in TIMERS:
            if not self.observe(unit, self.prior[unit])['verified']:
                raise RuntimeError('timer changed immediately before gate reopen: ' + unit)
        return {'verified': True, 'baseline_sha256': self.baseline}

    def capture(self, gate, describe):
        prior = {}
        for unit in TIMERS:
            loaded = self.state(unit)
            if loaded['kind'] != 'new' or loaded['running']:
                raise RuntimeError('timer baseline requires five loaded idle jobs')
            prior[unit] = {'class': 'timer', 'loaded': True, 'running': False,
                           'disabled': False, 'identity': self.identity(unit)}
        prior['scheduler-heartbeat']['execution_hold'] = describe(gate, list(TIMERS))
        self.prior = prior
        return prior


def closed_fire(installer, gate):
    if gate.marker() is None:
        raise RuntimeError('closed fire requires the physical gate marker')
    for unit in TIMERS:
        label = installer.label(unit)
        before = installer.launch(unit)
        if before['kind'] != 'new' or before['running'] or before['runs'] is None:
            raise RuntimeError('timer was not idle before the closed fire: ' + label)
        plist = plistlib.loads(installer.plist_path(unit).read_bytes())
        logs = [pathlib.Path(plist[key]) for key in ('StandardOutPath', 'StandardErrorPath')]
        sizes = [path.stat().st_size for path in logs]
        subprocess.run(['/bin/launchctl', 'kickstart', f'gui/{os.getuid()}/{label}'],
                       check=True, timeout=5, capture_output=True)
        end = time.monotonic() + 120
        while time.monotonic() < end:
            after = installer.launch(unit)
            if after['runs'] > before['runs'] and not after['running']:
                break
            time.sleep(.1)
        else:
            raise RuntimeError('closed timer fire did not finish: ' + label)
        if after['last_exit_code'] != 0 or gate.marker() is None \
                or [path.stat().st_size for path in logs] != sizes:
            raise RuntimeError('closed timer fire failed or wrote an application log: ' + label)


def natural_closed_fires(installer, gate, seconds=180,
                         units=('scheduler-heartbeat', 'observer'), interval=60):
    pending = {}
    for unit in units:
        plist = plistlib.loads(installer.plist_path(unit).read_bytes())
        if plist.get('StartInterval') != interval:
            raise RuntimeError('short-interval timer schedule differs: ' + unit)
        loaded = installer.launch(unit)
        if loaded['kind'] != 'new' or loaded['running'] or loaded['runs'] is None:
            raise RuntimeError('short-interval timer was not idle: ' + unit)
        logs = [pathlib.Path(plist[key]) for key in ('StandardOutPath', 'StandardErrorPath')]
        pending[unit] = (loaded['runs'], logs, [path.stat().st_size for path in logs])
    end = time.monotonic() + seconds
    while pending and time.monotonic() < end:
        if gate.marker() is None:
            raise RuntimeError('gate opened during natural closed timer observation')
        for unit, (runs, logs, sizes) in tuple(pending.items()):
            loaded = installer.launch(unit)
            if loaded['kind'] != 'new' or [path.stat().st_size for path in logs] != sizes:
                raise RuntimeError('natural closed timer changed or wrote an application log: ' + unit)
            if loaded['runs'] > runs and not loaded['running']:
                if loaded['last_exit_code'] != 0:
                    raise RuntimeError('natural closed timer exited unsuccessfully: ' + unit)
                pending.pop(unit)
        if pending:
            time.sleep(.2)
    if pending:
        raise RuntimeError('short-interval timer did not fire naturally while closed: '
                           + ', '.join(sorted(pending)))


def journal_records(Journal, root):
    reader = object.__new__(Journal)
    reader.root = root
    return reader._read()


def proved(records):
    return any(row['event'] == 'timer-inertness-proved' for row in records) \
        and not any(row['event'] == 'timer-proof-invalidated' for row in records)


def advance_active(installer, window, read_private):
    active = installer.home / '.openclaw/timer-transition-active'
    private(active)
    current = json.loads(active.read_text())
    receipt = read_private(installer.home / '.openclaw/preservation/node.lock.state.json')
    root = installer.home / '.openclaw/preservation/journals' / window
    if current['window'] != window or receipt['status'] != 'restored' \
            or receipt['journal_root'] != str(root.resolve()):
        raise RuntimeError('timer proof renewal requires the resolved active journal')
    next_window = 'timer-' + hashlib.sha256((window + ':proof').encode()).hexdigest()[:32]
    next_root = root.parent / next_window
    if next_root.exists():
        raise RuntimeError('next timer proof journal already exists')
    fd, pending = tempfile.mkstemp(prefix='.timer-transition-', dir=active.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(json.dumps({**current, 'window': next_window}, sort_keys=True).encode())
            stream.flush()
            os.fsync(stream.fileno())
            if sys.platform == 'darwin':
                fcntl.fcntl(stream.fileno(), fcntl.F_FULLFSYNC)
        os.replace(pending, active)
        sync_dir(active.parent)
    finally:
        if os.path.lexists(pending):
            os.unlink(pending)
    return next_window


def finish(installer, gate, window, read_private, Journal):
    active = installer.home / '.openclaw/timer-transition-active'
    installed = installer.home / '.openclaw/timer-entry-installed'
    receipt = read_private(installer.home / '.openclaw/preservation/node.lock.state.json')
    journal_root = installer.home / '.openclaw/preservation/journals' / window
    records = journal_records(Journal, journal_root)
    if not records or records[0] != receipt['baseline'] or records[0].get('scope') != 'timer-commissioning' \
            or records[-1]['event'] != 'resolved' or records[-1]['sha256'] != receipt.get('head') \
            or not proved(records):
        raise RuntimeError('timer journal is not durably resolved in its scoped lineage')
    if receipt['journal_root'] != str(journal_root.resolve()) \
            or receipt['status'] != 'restored' or gate.marker() is not None:
        raise RuntimeError('timer hold is not durably resolved and physically open')
    if any((row['source']['kind'], row['disk'], row['loaded']['kind']) != ('old', 'new', 'new')
           for row in (installer.state(unit) for unit in TIMERS)):
        raise RuntimeError('timer cohort changed after hold resolution')
    if os.path.lexists(active):
        private(active)
        if json.loads(active.read_text())['window'] != window:
            raise RuntimeError('installed timer window differs from the active proof')
        os.replace(active, installed)
        sync_dir(active.parent)
    private(installed)
    return {'outcome': 'resolved', 'gate': 'open', 'timers': len(TIMERS), 'window': window}


def run(expected, recover_only=False):
    verify_bundle(HERE, expected)
    Journal, TIMER_SCOPE, TIMER_UNITS, matches, static_identity, read_private, JournaledHold, describe, install, gate_module = modules(HERE)
    if set(TIMERS) != TIMER_UNITS or set(TIMERS) != set(install.NAMES):
        raise RuntimeError('timer controller, journal and installer cohorts differ')
    installer = install.Installer(TRANSITION, ENTRIES)
    active = installer.home / '.openclaw/timer-transition-active'
    if os.path.lexists(active):
        private(active)
        window = json.loads(active.read_text())['window']
        journal_exists = (installer.home / '.openclaw/preservation/journals' / window).exists()
    else:
        journal_exists = False
    if recover_only and not journal_exists:
        raise RuntimeError('timer journal has not been created; resume commissioning instead')
    if not journal_exists and not recover_only:
        window = installer.apply()['window']
    adapter = TimerAdapter(installer, '', matches, static_identity)
    gate_data = installer.entry_data
    advance = False
    with gate_module.Gate(gate_data['gate_root'], gate_data['gate_pins']) as gate:
        root = installer.home / '.openclaw/preservation/journals' / window
        if root.exists():
            receipt = read_private(installer.home / '.openclaw/preservation/node.lock.state.json')
            if receipt['journal_root'] == str(root.resolve()) and receipt['status'] == 'restored':
                if proved(journal_records(Journal, root)):
                    return finish(installer, gate, window, read_private, Journal)
                if gate.marker() is not None:
                    raise RuntimeError('resolved timer recovery still has a closed gate')
                advance = True
        if not advance:
            prior = adapter.capture(gate, describe) if not root.exists() else None
            with Journal(root, prior, node_lock=installer.home / '.openclaw/preservation/node.lock',
                         scope=TIMER_SCOPE if prior is not None else None) as journal:
                adapter.prior = journal.prior
                adapter.baseline = journal.records[0]['sha256']
                hold = JournaledHold(journal, gate, adapter.fast_check, seconds=900)
                try:
                    if prior is not None:
                        hold.close_and_drain()
                    else:
                        journal.append('timer-proof-invalidated', reason='controller continuity was lost')
                    if prior is not None:
                        if gate.marker() is None:
                            raise RuntimeError('fresh timer proof lost its closed gate')
                        closed_fire(installer, gate)
                        natural_closed_fires(installer, gate)
                        hold.check_forward()
                        journal.append('timer-inertness-proved', forced=len(TIMERS), natural=2,
                                       marker=gate.marker())
                    result = hold.recover(adapter.restore, adapter.observe, adapter.final_check)
                    if not result['restored']:
                        raise RuntimeError('timer restoration remains unresolved: ' + str(result['errors']))
                    journal.resolve()
                finally:
                    hold.close()
            if prior is not None:
                return finish(installer, gate, window, read_private, Journal)
            advance = True
    if advance:
        advance_active(installer, window, read_private)
        return run(expected)
    raise RuntimeError('timer controller did not reach a terminal state')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage')
    parser.add_argument('--verify')
    parser.add_argument('--commission')
    parser.add_argument('--recover')
    args = parser.parse_args()
    selected = sum(value is not None for value in
                   (args.stage, args.verify, args.commission, args.recover))
    if selected != 1:
        raise RuntimeError('select exactly one timer control operation')
    if args.stage:
        outcome = stage(args.stage)
    elif args.verify:
        verify_bundle(HERE, args.verify)
        outcome = {'outcome': 'verified'}
    else:
        outcome = run(args.recover or args.commission, recover_only=args.recover is not None)
    print(json.dumps(outcome, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'outcome': 'refused', 'reason': str(error)}, sort_keys=True), file=sys.stderr)
        sys.exit(2)
