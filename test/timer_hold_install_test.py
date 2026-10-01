import hashlib
import fcntl
import importlib.util
import json
import os
import pathlib
import plistlib
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'workspace-bin/install-timer-hold.py'
SPEC = importlib.util.spec_from_file_location('timer_hold_install', SOURCE)
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)
CONTROL_SPEC = importlib.util.spec_from_file_location('timer_hold_control',
    SOURCE.with_name('timer-hold-control.py'))
CONTROL = importlib.util.module_from_spec(CONTROL_SPEC)
CONTROL_SPEC.loader.exec_module(CONTROL)
sys.path.insert(0, str(SOURCE.parents[1] / 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'))
from preservation_journal import Journal, TIMER_SCOPE, TIMER_UNITS, matches, read_private, static_identity


def digest(value):
    return hashlib.sha256(value).hexdigest()


def save(path, data, mode=0o600):
    path.write_bytes(data)
    path.chmod(mode)
    return digest(data)


@unittest.skipUnless(os.uname().sysname == 'Darwin', 'timer handoff uses owned macOS launchd jobs')
class TimerInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-timer-install-owned-')
        self.root = pathlib.Path(self.temp.name).resolve()
        self.home = self.root / 'home'
        self.home.mkdir(mode=0o700)
        (self.home / '.openclaw').mkdir(mode=0o700)
        plists = self.home / 'Library/LaunchAgents'
        plists.mkdir(parents=True, mode=0o700)
        self.name = 'timer-install-' + uuid.uuid4().hex[:12]
        self.label = 'ai.openclaw.' + self.name
        self.target = f'gui/{os.getuid()}/{self.label}'
        self.source = self.root / 'timer.sh'
        self.finished = self.root / 'finished'
        self.started = self.root / 'started'
        original = ('#!/bin/sh\n'
                    'if [ "${1-}" = --gated ]; then exit 0; fi\n'
                    f'printf started > "{self.started}"\n'
                    'sleep 1\n'
                    f'printf finished > "{self.finished}"\n').encode()
        source_sha = save(self.source, original, 0o755)
        fence = b'#!/bin/sh\nexit 0\n'
        self.plist = plists / (self.label + '.plist')
        old = {'Label': self.label, 'ProgramArguments': ['/bin/sh', str(self.source)],
               'StartInterval': 3600, 'StandardOutPath': str(self.root / 'out.log'),
               'StandardErrorPath': str(self.root / 'err.log'),
               'EnvironmentVariables': {'PATH': '/usr/bin:/bin'}}
        new = {**old, 'ProgramArguments': ['/bin/sh', str(self.source), '--gated']}
        old_data = plistlib.dumps(old)
        new_data = plistlib.dumps(new)
        old_sha = save(self.plist, old_data, 0o644)
        for key in ('StandardOutPath', 'StandardErrorPath'):
            pathlib.Path(old[key]).touch(mode=0o600)
        self.transition = self.root / 'transition'
        self.entries = self.root / 'entries'
        for path in (self.transition, self.transition / 'originals', self.transition / 'fences',
                     self.entries, self.entries / 'candidates'):
            path.mkdir(mode=0o700)
        save(self.transition / 'originals' / (self.name + '.plist'), old_data)
        save(self.transition / 'originals' / (self.name + '.source'), original)
        save(self.transition / 'fences' / (self.name + '.source'), fence)
        candidate_sha = save(self.entries / 'candidates' / (self.label + '.plist'), new_data)
        save(self.entries / 'timer-entry.py', b'owned timer entry fixture\n')
        save(self.entries / 'service_gate.py', b'owned timer gate fixture\n')
        entry = {'files': {}, 'executables': {}, 'resolution': {},
                 'jobs': {self.label: {'environment': {'PATH': digest(b'/usr/bin:/bin')},
                                       'source': []}}}
        entry_data = json.dumps(entry, sort_keys=True).encode()
        entry_sha = save(self.entries / 'timer-entry-manifest.json', entry_data)
        evidence = {'manifest_sha256': entry_sha,
                    'jobs': {self.label: {'candidate_plist_sha256': candidate_sha}}}
        save(self.entries / 'evidence.json', json.dumps(evidence, sort_keys=True).encode())
        info = self.source.lstat()
        transition = {'candidate': str(self.entries), 'candidate_manifest_sha256': entry_sha,
                      'jobs': {self.label: {'path': str(self.source), 'link_target': None,
                                            'mode': 0o755, 'identity': [info.st_dev, info.st_ino, info.st_ctime_ns],
                                            'plist_sha256': old_sha, 'source_sha256': source_sha,
                                            'fence_sha256': digest(fence)}}}
        transition_sha = save(self.transition / 'transition-manifest.json',
                              json.dumps(transition, sort_keys=True).encode())
        self.patches = [patch.object(INSTALL, 'NAMES', (self.name,)),
                        patch.object(INSTALL, 'TRANSITION_HASH', transition_sha),
                        patch.object(INSTALL, 'ENTRY_HASH', entry_sha)]
        for item in self.patches:
            item.start()
        result = subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(self.plist)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def tearDown(self):
        subprocess.run(['/bin/launchctl', 'bootout', self.target], capture_output=True)
        if self.source.exists():
            os.chflags(self.source, 0)
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def installer(self):
        return INSTALL.Installer(self.transition, self.entries, self.home)

    def exercise_restart(self, phase):
        installer = self.installer()
        original = getattr(installer, phase)
        def interrupted(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError('owned interruption')
        setattr(installer, phase, interrupted)
        with self.assertRaisesRegex(RuntimeError, 'owned interruption'):
            installer.apply(seconds=5)
        receipt = self.home / '.openclaw/timer-transition-active'
        self.assertTrue(receipt.exists())
        result = self.installer().apply(seconds=5)
        self.assertTrue(result['installed'])
        state = self.installer().state(self.name)
        self.assertEqual((state['source']['kind'], state['disk'], state['loaded']['kind']),
                         ('old', 'new', 'new'))

    def test_resume_after_fence_publication(self):
        self.exercise_restart('publish_fence')

    def test_resume_after_plist_publication(self):
        self.exercise_restart('install_plist')

    def test_resume_after_old_unload(self):
        self.exercise_restart('unload_old')

    def test_resume_after_source_restoration(self):
        self.exercise_restart('restore_source')

    def test_resume_after_fence_is_unflagged_for_source_restoration(self):
        installer = self.installer()
        def interrupted(name):
            os.chflags(self.source, 0)
            raise RuntimeError('owned unflag interruption')
        installer.restore_source = interrupted
        with self.assertRaisesRegex(RuntimeError, 'owned unflag interruption'):
            installer.apply(seconds=5)
        self.assertEqual(self.installer().state(self.name)['source']['kind'], 'fence')
        self.assertEqual(self.installer().state(self.name)['source']['flags'], 0)
        self.assertTrue(self.installer().apply(seconds=5)['installed'])
        self.assertEqual(self.installer().state(self.name)['loaded']['kind'], 'new')

    def test_resume_after_gated_bootstrap(self):
        self.exercise_restart('bootstrap')

    def test_run_at_load_must_fire_before_new_entry_is_accepted(self):
        installer = self.installer()
        candidate = self.root / 'run-at-load.plist'
        value = plistlib.loads(installer.candidate(self.name).read_bytes())
        value['RunAtLoad'] = True
        candidate.write_bytes(plistlib.dumps(value))
        installer.candidate = lambda _: candidate
        observed = iter(({'kind': 'new', 'running': False, 'runs': 0},
                         {'kind': 'new', 'running': True, 'runs': 1},
                         {'kind': 'new', 'running': False, 'runs': 1}))
        installer.launch = lambda _: next(observed)
        installer.wait_new_idle(self.name, 2)

    def test_inherited_path_is_probed_when_candidate_does_not_set_it(self):
        installer = self.installer()
        candidate = self.root / 'candidate-inherited-path.plist'
        value = plistlib.loads(installer.candidate(self.name).read_bytes())
        value.pop('EnvironmentVariables')
        candidate.write_bytes(plistlib.dumps(value))
        subprocess.run(['/bin/launchctl', 'bootout', self.target], check=True)
        self.plist.write_bytes(candidate.read_bytes())
        subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(self.plist)],
                       check=True)
        installer.candidate = lambda _: candidate
        installer.entry_data['jobs'][self.label]['environment']['PATH'] = \
            installer.inherited_path_hash(value)
        self.assertEqual(installer.launch(self.name)['kind'], 'new')
        installer.entry_data['jobs'][self.label]['environment']['PATH'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'delegated PATH differs'):
            installer.launch(self.name)

    def test_copy_lock_refuses_before_any_source_change(self):
        lock = self.home / '.openclaw/timer-source-copy.lock'
        with lock.open('a') as stream:
            lock.chmod(0o600)
            stream.flush()
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.installer().apply(seconds=5)
        self.assertFalse((self.home / '.openclaw/timer-transition-active').exists())
        self.assertEqual(self.installer().state(self.name)['source']['kind'], 'old')

    def test_partial_fence_without_receipt_refuses(self):
        staged = self.root / 'unreceipted-fence'
        staged.write_bytes((self.transition / 'fences' / (self.name + '.source')).read_bytes())
        staged.chmod(0o755)
        os.replace(staged, self.source)
        os.chflags(self.source, stat.UF_IMMUTABLE)
        with self.assertRaisesRegex(RuntimeError, 'lacks its durable receipt'):
            self.installer().apply(seconds=5)
        self.assertFalse((self.home / '.openclaw/timer-transition-active').exists())

    def test_old_run_finishes_before_unload(self):
        subprocess.run(['/bin/launchctl', 'kickstart', self.target], check=True, capture_output=True)
        end = time.monotonic() + 5
        while not self.started.exists() and time.monotonic() < end:
            time.sleep(.02)
        self.assertTrue(self.started.exists())
        self.installer().apply(seconds=5)
        self.assertEqual(self.finished.read_text(), 'finished')
        self.assertEqual(self.installer().state(self.name)['loaded']['kind'], 'new')

    def test_fixed_adapter_observes_candidate_and_closed_fire_is_inert(self):
        self.installer().apply(seconds=5)
        with patch.object(CONTROL, 'ENTRIES', self.entries), patch.object(CONTROL, 'TIMERS', (self.name,)):
            installer = self.installer()
            adapter = CONTROL.TimerAdapter(installer, 'owned-baseline', matches, static_identity)
            prior = {self.name: {'class': 'timer', 'loaded': True, 'running': False,
                                 'disabled': False, 'identity': adapter.identity(self.name)}}
            adapter.prior = prior
            self.assertTrue(adapter.observe(self.name, prior[self.name])['verified'])
            self.assertEqual(adapter.final_check()['checked_units'], 1)
            self.assertEqual(adapter.fast_check()['baseline_sha256'], 'owned-baseline')
            class Closed:
                def marker(self):
                    return {'window': 'owned'}
            CONTROL.closed_fire(installer, Closed())
            self.assertFalse(self.started.exists())
            self.assertFalse(self.finished.exists())
            self.source.write_bytes(self.source.read_bytes() + b'\n# drift\n')
            with self.assertRaisesRegex(RuntimeError, 'timer source, plist or loaded state is unknown'):
                adapter.fast_check()

    def test_installed_receipt_requires_terminal_resolved_journal(self):
        window = self.installer().apply(seconds=5)['window']
        preservation = self.home / '.openclaw/preservation'
        prior = {}
        for unit in TIMER_UNITS:
            prior[unit] = {'class': 'timer', 'loaded': True, 'running': False,
                           'disabled': False,
                           'identity': {'plist_sha256': '0' * 64, 'argv': ['/owned/' + unit],
                                        'files': {'/owned/' + unit: '1' * 64},
                                        'dependencies': {}, 'working_directory': '/'}}
        prior['scheduler-heartbeat']['execution_hold'] = {'cohort': sorted(TIMER_UNITS)}
        class Open:
            def marker(self):
                return None
        with patch.object(CONTROL, 'TIMERS', (self.name,)):
            with Journal(preservation / 'journals' / window, prior,
                         node_lock=preservation / 'node.lock', scope=TIMER_SCOPE) as journal:
                journal.append('timer-inertness-proved', forced=5, natural=2,
                               marker={'window': 'owned', 'reason': 'owned'})
                row = journal.append('recovery-finished', services_verified=True, errors=[])
                journal._state({**journal.active, 'status': 'restored', 'head': row['sha256']})
                with self.assertRaisesRegex(RuntimeError, 'not durably resolved'):
                    CONTROL.finish(self.installer(), Open(), window, read_private, Journal)
                journal.resolve()
            result = CONTROL.finish(self.installer(), Open(), window, read_private, Journal)
            self.assertEqual(result['outcome'], 'resolved')
            self.assertFalse((self.home / '.openclaw/timer-transition-active').exists())
            self.assertTrue((self.home / '.openclaw/timer-entry-installed').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
