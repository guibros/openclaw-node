import importlib.util
import json
import os
import pathlib
import plistlib
import re
import subprocess
import sys
import tempfile
import types
import unittest
import uuid
from unittest.mock import patch


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'workspace-bin/timer-hold-control.py'
SPEC = importlib.util.spec_from_file_location('timer_hold_control_tested', SOURCE)
CONTROL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROL)
sys.path.insert(0, str(SOURCE.parents[1] / 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'))
from journal_hold import JournaledHold, describe
from preservation_journal import Journal, TIMER_SCOPE, TIMER_UNITS, matches, read_private, static_identity
GATE_SPEC = importlib.util.spec_from_file_location('owned_timer_gate', SOURCE.with_name('service_gate.py'))
GATE = importlib.util.module_from_spec(GATE_SPEC)
GATE_SPEC.loader.exec_module(GATE)


@unittest.skipUnless(sys.platform == 'darwin', 'protected control bundle uses macOS file flags')
class TimerControlBundleTests(unittest.TestCase):
    def test_natural_launchd_fire_is_observed_while_application_stays_inert(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-timer-natural-owned-') as place:
            root = pathlib.Path(place).resolve()
            name = 'timer-natural-' + uuid.uuid4().hex[:12]
            label = 'ai.openclaw.' + name
            target = f'gui/{os.getuid()}/{label}'
            marker = root / 'closed'
            marker.touch()
            application_log = root / 'application.log'
            script = root / 'entry.sh'
            script.write_text('#!/bin/sh\n[ -f "' + str(marker) + '" ] && exit 0\n'
                              'printf escaped >> "' + str(application_log) + '"\n')
            script.chmod(0o755)
            plist = root / (label + '.plist')
            logs = [root / 'out.log', root / 'err.log']
            for path in logs:
                path.touch()
            plist.write_bytes(plistlib.dumps({'Label': label,
                'ProgramArguments': ['/bin/sh', str(script)], 'StartInterval': 3,
                'StandardOutPath': str(logs[0]), 'StandardErrorPath': str(logs[1])}))

            class Installer:
                def plist_path(self, unit):
                    return plist

                def launch(self, unit):
                    result = subprocess.run(['/bin/launchctl', 'print', target],
                                            check=True, capture_output=True, text=True)
                    content = result.stdout
                    runs = re.search(r'^\s*runs = (\d+)$', content, re.M)
                    exit_code = re.search(r'^\s*last exit code = (\d+)$', content, re.M)
                    return {'kind': 'new', 'running': re.search(r'^\s*pid = \d+$', content, re.M) is not None,
                            'runs': int(runs[1]) if runs else None,
                            'last_exit_code': int(exit_code[1]) if exit_code else None}

            class Gate:
                def marker(self):
                    return {'window': 'owned'} if marker.exists() else None

            result = subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(plist)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            try:
                CONTROL.natural_closed_fires(Installer(), Gate(), seconds=20,
                                             units=(name,), interval=3)
                self.assertFalse(application_log.exists())
            finally:
                subprocess.run(['/bin/launchctl', 'bootout', target], capture_output=True)

    def test_private_isolated_bundle_verifies_and_detects_code_change(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-timer-control-owned-') as place:
            home = pathlib.Path(place).resolve()
            backups = home / CONTROL.BACKUPS.relative_to(pathlib.Path.home())
            backups.mkdir(parents=True, mode=0o700)
            transition = backups / CONTROL.TRANSITION.name
            entries = backups / CONTROL.ENTRIES.name
            transition.mkdir(mode=0o700)
            entries.mkdir(mode=0o700)
            (transition / 'transition-manifest.json').write_bytes(b'owned transition fixture')
            gate = entries / 'service_gate.py'
            gate.write_bytes(SOURCE.with_name('service_gate.py').read_bytes())
            gate.chmod(0o600)
            (entries / 'timer-entry-manifest.json').write_text(
                json.dumps({'files': {str(gate): CONTROL.sha(gate)}}))
            output = backups / 'controller'
            # The patches below do not reach the --verify child; it re-derives its pins from HOME.
            owned = {**os.environ, 'HOME': str(home)}
            with patch.object(CONTROL, 'BACKUPS', backups), \
                 patch.object(CONTROL, 'TRANSITION', transition), \
                 patch.object(CONTROL, 'ENTRIES', entries):
                result = CONTROL.stage(output)
                try:
                    command = ['/usr/bin/python3', '-I', '-S', str(output / SOURCE.name),
                               '--verify', result['manifest_sha256']]
                    passed = subprocess.run(command, capture_output=True, text=True, env=owned)
                    self.assertEqual(passed.returncode, 0, passed.stderr)
                    loaded = CONTROL.modules(output)
                    self.assertEqual(loaded[1], 'timer-commissioning')
                    target = output / 'journal_hold.py'
                    os.chflags(target, 0)
                    with target.open('ab') as file:
                        file.write(b'\n')
                    refused = subprocess.run(command, capture_output=True, text=True, env=owned)
                    self.assertEqual(refused.returncode, 2)
                    self.assertIn('timer control code differs', refused.stderr)
                finally:
                    for item in output.iterdir():
                        os.chflags(item, 0)

    def test_full_controller_resolves_and_interrupted_run_recovers_restore_only(self):
        for scenario in ('clean', 'recovery', 'advance-crash'):
            interrupted = scenario != 'clean'
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory(
                    prefix='openclaw-timer-controller-owned-') as place:
                root = pathlib.Path(place).resolve()
                home = root / 'home'
                state_root = home / '.openclaw'
                state_root.mkdir(parents=True, mode=0o700)
                gate_root = root / 'gate'
                pins = GATE.initialize(gate_root)
                entries = root / 'entries'
                entries.mkdir(mode=0o700)
                for name in ('timer-entry-manifest.json', 'timer-entry.py', 'service_gate.py'):
                    (entries / name).write_bytes(b'owned controller fixture')
                plists = {}
                jobs = {}
                missing = set()
                bootstrapped = []
                for unit in CONTROL.TIMERS:
                    label = 'ai.openclaw.' + unit
                    source = root / (unit + '.sh')
                    source.write_text('#!/bin/sh\nexit 0\n')
                    plist = root / (label + '.plist')
                    plist.write_bytes(plistlib.dumps({'Label': label,
                        'ProgramArguments': ['/bin/sh', str(source)],
                        'StandardOutPath': str(root / (unit + '.out')),
                        'StandardErrorPath': str(root / (unit + '.err'))}))
                    plists[unit] = plist
                    jobs[label] = {'source': [str(source)]}

                class Installer:
                    def __init__(self):
                        self.home = home
                        self.entry_data = {'gate_root': str(gate_root), 'gate_pins': pins,
                                           'jobs': jobs}

                    def label(self, unit):
                        return 'ai.openclaw.' + unit

                    def plist_path(self, unit):
                        return plists[unit]

                    def verify_artifacts(self):
                        pass

                    def state(self, unit):
                        return {'source': {'kind': 'old'}, 'disk': 'new',
                                'loaded': {'kind': 'none' if unit in missing else 'new',
                                           'running': False}}

                    def bootstrap(self, unit):
                        missing.remove(unit)
                        bootstrapped.append(unit)

                    def apply(self):
                        (state_root / 'preservation').mkdir(mode=0o700, exist_ok=True)
                        active = state_root / 'timer-transition-active'
                        if not active.exists():
                            active.write_text(json.dumps({'window': 'timer-' + 'a' * 32}))
                            active.chmod(0o600)
                        return {'window': json.loads(active.read_text())['window']}

                installer = Installer()
                fake_install = types.SimpleNamespace(Installer=lambda *_: installer,
                                                     NAMES=CONTROL.TIMERS)
                loaded = (Journal, TIMER_SCOPE, TIMER_UNITS, matches, static_identity,
                          read_private, JournaledHold, describe, fake_install, GATE)
                fired = []

                def closed_fire(_installer, gate):
                    self.assertIsNotNone(gate.marker())
                    self.assertFalse(missing)
                    fired.append(True)
                    if interrupted and len(fired) == 1:
                        raise RuntimeError('owned controller interruption')

                def natural_fire(_installer, gate):
                    self.assertIsNotNone(gate.marker())

                with patch.object(CONTROL, 'verify_bundle'), \
                     patch.object(CONTROL, 'modules', return_value=loaded), \
                     patch.object(CONTROL, 'ENTRIES', entries), \
                     patch.object(CONTROL, 'closed_fire', side_effect=closed_fire), \
                     patch.object(CONTROL, 'natural_closed_fires', side_effect=natural_fire):
                    if interrupted:
                        with self.assertRaisesRegex(RuntimeError, 'owned controller interruption'):
                            CONTROL.run('owned')
                        self.assertTrue((gate_root / 'closed.json').exists())
                        self.assertTrue((state_root / 'timer-transition-active').exists())
                        missing.add('observer')
                    if scenario == 'advance-crash':
                        with patch.object(CONTROL, 'advance_active',
                                          side_effect=RuntimeError('owned advance interruption')):
                            with self.assertRaisesRegex(RuntimeError, 'owned advance interruption'):
                                CONTROL.run('owned', recover_only=True)
                        self.assertFalse((gate_root / 'closed.json').exists())
                        self.assertEqual(read_private(state_root / 'preservation/node.lock.state.json')['status'],
                                         'restored')
                    result = CONTROL.run('owned', recover_only=interrupted
                                         and scenario != 'advance-crash')
                self.assertEqual(result['outcome'], 'resolved')
                self.assertEqual(result['gate'], 'open')
                self.assertEqual(result['timers'], 5)
                self.assertFalse((gate_root / 'closed.json').exists())
                self.assertTrue((state_root / 'timer-entry-installed').exists())
                receipt = read_private(state_root / 'preservation/node.lock.state.json')
                self.assertEqual(receipt['status'], 'restored')
                records = sorted((state_root / 'preservation/journals' / result['window']).glob('[0-9]*.json'))
                events = [read_private(path)['event'] for path in records]
                self.assertEqual(events[-1], 'resolved')
                self.assertIn('timer-inertness-proved', events)
                if interrupted:
                    self.assertEqual(bootstrapped, ['observer'])
                    self.assertNotEqual(result['window'], 'timer-' + 'a' * 32)
                    first = state_root / 'preservation/journals' / ('timer-' + 'a' * 32)
                    first_events = [read_private(path)['event'] for path in sorted(first.glob('[0-9]*.json'))]
                    self.assertIn('failed', first_events)
                    self.assertIn('timer-proof-invalidated', first_events)
                    self.assertNotIn('timer-inertness-proved', first_events)
                self.assertNotIn('sealed', events)


if __name__ == '__main__':
    unittest.main(verbosity=2)
