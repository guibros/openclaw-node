import hashlib
import importlib.util
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipUnless(os.uname().sysname == 'Darwin', 'owned launchd proof requires macOS')
class TimerEntryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='timer-entry-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(os.path.realpath(self.temp.name))
        self.label = 'ai.openclaw.timer-entry-test-' + uuid.uuid4().hex[:12]
        self.stage = load('stage_timer_entries', ROOT / 'workspace-bin/stage-timer-entries.py')
        for name in ('timer-entry.py', 'service_gate.py'):
            shutil.copyfile(ROOT / 'workspace-bin' / name, self.root / name)
            (self.root / name).chmod(0o600)
        self.gate = load('owned_service_gate', self.root / 'service_gate.py')
        self.pins = self.gate.initialize(str(self.root / 'gate'))
        self.output = self.root / 'application-ran'
        self.app = self.root / 'app.py'
        self.app.write_text('import pathlib,sys\npathlib.Path(sys.argv[1]).write_text("ran")\n')
        self.app.chmod(0o600)
        self.argv = ['/usr/bin/python3', '-I', '-S', str(self.app), str(self.output)]
        received = self.stage.probe(self.label, {}, self.root)
        environment = self.stage.received_environment(received, {}, self.label)
        self.manifest = self.root / 'manifest.json'
        value = {'version': 1, 'gate_code': str(self.root / 'service_gate.py'),
                 'gate_root': str(self.root / 'gate'), 'gate_pins': self.pins,
                 'launcher_interpreter': subprocess.run(['/usr/bin/python3', '-I', '-S', '-c',
                     'import sys;print(sys.executable)'], check=True, text=True,
                     capture_output=True).stdout.strip(),
                 'jobs': {self.label: {'argv': self.argv, 'cwd': received['cwd'],
                                       'environment': environment,
                                       'dynamic_environment': ['SSH_AUTH_SOCK']}},
                 'files': {str(self.root / name): sha(self.root / name)
                           for name in ('timer-entry.py', 'service_gate.py', 'app.py')},
                 'executables': {'/usr/bin/python3': sha(pathlib.Path('/usr/bin/python3')),
                                 '/bin/launchctl': sha(pathlib.Path('/bin/launchctl'))},
                 'resolution': {}}
        self.manifest.write_text(json.dumps(value))
        self.manifest.chmod(0o600)
        self.stderr = self.root / 'stderr'
        self.plist = self.root / 'candidate.plist'
        payload = {'Label': self.label, 'ProgramArguments': ['/usr/bin/python3', '-I', '-S',
                   str(self.root / 'timer-entry.py'), str(self.manifest), sha(self.manifest),
                   self.label, str(self.root / 'gate'), self.pins['lock'], self.pins['root'],
                   '--', *self.argv], 'RunAtLoad': True,
                   'StandardOutPath': str(self.root / 'stdout'),
                   'StandardErrorPath': str(self.stderr)}
        self.plist.write_bytes(plistlib.dumps(payload))
        self.plist.chmod(0o600)

    def launch(self):
        domain = f'gui/{os.getuid()}'
        subprocess.run(['launchctl', 'bootstrap', domain, str(self.plist)], check=True,
                       capture_output=True)
        try:
            for _ in range(200):
                state = subprocess.run(['launchctl', 'print', domain + '/' + self.label],
                                       text=True, capture_output=True, check=True).stdout
                if '\n\tstate = not running' in state:
                    break
                time.sleep(.05)
            self.last_state = '\n'.join(line.strip() for line in state.splitlines()
                                        if any(key in line for key in ('state =', 'run count =', 'last exit code =')))
        finally:
            subprocess.run(['launchctl', 'bootout', domain + '/' + self.label], check=True,
                           capture_output=True)

    def rewrite_manifest(self, edit):
        value = json.loads(self.manifest.read_text())
        edit(value)
        self.manifest.write_text(json.dumps(value))
        plist = plistlib.loads(self.plist.read_bytes())
        plist['ProgramArguments'][5] = sha(self.manifest)
        self.plist.write_bytes(plistlib.dumps(plist))

    def test_open_closed_and_source_substitution(self):
        self.launch()
        self.assertTrue(self.output.exists(), (self.stderr.read_text() if self.stderr.exists() else 'no stderr') + '\n' + self.last_state)
        self.assertEqual(self.output.read_text(), 'ran')
        self.output.unlink()
        with self.gate.Gate(str(self.root / 'gate'), self.pins) as gate:
            with gate.close_and_drain('test-window', 'test', 2):
                self.launch()
                self.assertFalse(self.output.exists())
        self.app.write_text('raise SystemExit(90)\n')
        self.launch()
        self.assertFalse(self.output.exists())
        self.assertIn('entry source differs', self.stderr.read_text())

    def test_unexpected_environment_refuses_before_application(self):
        plist = plistlib.loads(self.plist.read_bytes())
        plist['EnvironmentVariables'] = {'NODE_OPTIONS': '--require=/nonexistent'}
        self.plist.write_bytes(plistlib.dumps(plist))
        self.launch()
        self.assertFalse(self.output.exists())
        self.assertIn('received environment keys differ', self.stderr.read_text())

    def test_changed_inherited_socket_refuses_before_application(self):
        plist = plistlib.loads(self.plist.read_bytes())
        plist['EnvironmentVariables'] = {'SSH_AUTH_SOCK': '/nonexistent/alternate.sock'}
        self.plist.write_bytes(plistlib.dumps(plist))
        self.launch()
        self.assertFalse(self.output.exists())
        self.assertIn('SSH_AUTH_SOCK domain environment differs', self.stderr.read_text())

    def test_rotated_or_absent_inherited_socket_keeps_saved_contract(self):
        received = {'environment': {'HOME': self.stage.sha_bytes(b'/tmp/fixture'),
                                    'SSH_AUTH_SOCK': self.stage.sha_bytes(b'/tmp/new-agent.sock')}}
        with mock.patch.object(self.stage, 'run', return_value='/tmp/new-agent.sock\n'):
            current = self.stage.received_environment(received, {}, self.label)
        self.assertNotIn('SSH_AUTH_SOCK', current)
        self.assertEqual(current['HOME'], received['environment']['HOME'])
        received['environment'].pop('SSH_AUTH_SOCK')
        self.assertEqual(self.stage.received_environment(received, {}, self.label), current)
        received['environment']['SSH_AUTH_SOCK'] = self.stage.sha_bytes(b'/tmp/other.sock')
        with mock.patch.object(self.stage, 'run', return_value='/tmp/new-agent.sock\n'):
            with self.assertRaisesRegex(RuntimeError, 'SSH_AUTH_SOCK domain environment differs'):
                self.stage.received_environment(received, {}, self.label)

    def test_gate_pin_and_delegation_substitution_refuse(self):
        plist = plistlib.loads(self.plist.read_bytes())
        plist['ProgramArguments'][8] = '0:0:0'
        self.plist.write_bytes(plistlib.dumps(plist))
        self.launch()
        self.assertFalse(self.output.exists())
        self.assertIn('gate arguments differ', self.stderr.read_text())
        plist['ProgramArguments'][8] = self.pins['lock']
        self.plist.write_bytes(plistlib.dumps(plist))
        self.stderr.unlink()
        self.rewrite_manifest(lambda value: value['resolution'].update({'python3': '/nonexistent'}))
        self.launch()
        self.assertFalse(self.output.exists())
        self.assertIn('delegated command resolution differs', self.stderr.read_text())

    def test_launcher_and_manifest_substitution_refuse(self):
        launcher = self.root / 'timer-entry.py'
        launcher.write_text(launcher.read_text() + '\n# drift\n')
        self.launch()
        self.assertFalse(self.output.exists())
        self.assertIn('entry source differs', self.stderr.read_text())
        launcher.write_bytes((ROOT / 'workspace-bin/timer-entry.py').read_bytes())
        self.stderr.unlink()
        self.manifest.write_text(self.manifest.read_text() + ' ')
        self.launch()
        self.assertFalse(self.output.exists())
        self.assertIn('entry manifest differs', self.stderr.read_text())


if __name__ == '__main__':
    unittest.main()
