import importlib.util
import hashlib
import json
import os
import pathlib
import plistlib
import re
import shlex
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid


ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('prepare_timer_transition',
    ROOT / 'workspace-bin/prepare-timer-transition.py')
TRANSITION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TRANSITION)
NODE = shutil.which('node')


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wait_for(path, seconds=12):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if path.exists():
            return
        time.sleep(0.04)
    raise AssertionError('timed out waiting for ' + str(path))


@unittest.skipUnless(NODE, 'Node is required')
class SourceFenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='timer-fence-source-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(os.path.realpath(self.temp.name))

    def run_node(self, script, label=None):
        env = dict(os.environ)
        env.pop('XPC_SERVICE_NAME', None)
        if label:
            env['XPC_SERVICE_NAME'] = label
        return subprocess.run([NODE, str(script)], env=env, capture_output=True, text=True)

    def test_consolidation_keeps_exports_and_manual_entry(self):
        label = 'ai.openclaw.consolidation-scheduler'
        output = self.root / 'app-work'
        script = self.root / 'consolidation-scheduler.mjs'
        source = ("import {writeFileSync} from 'node:fs';\n"
                  "export const createConsolidationScheduler = () => 42;\n"
                  "if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/consolidation-scheduler.mjs')) {\n"
                  f"  writeFileSync({str(output)!r}, 'ran');\n"
                  "}\n").encode()
        script.write_bytes(TRANSITION.fence('consolidation-scheduler', source, None))
        self.assertEqual(self.run_node(script, label).returncode, 0)
        self.assertFalse(output.exists())
        check = subprocess.run([NODE, '--input-type=module', '-e',
            f"import {{createConsolidationScheduler}} from {script.as_uri()!r}; "
            'if (createConsolidationScheduler() !== 42) process.exit(5);'],
            capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertFalse(output.exists())
        self.assertEqual(self.run_node(script).returncode, 0)
        self.assertEqual(output.read_text(), 'ran')

    def test_heartbeat_fence_blocks_timer_and_keeps_manual_entry(self):
        label = 'ai.openclaw.scheduler-heartbeat'
        output = self.root / 'heartbeat-work'
        script = self.root / 'scheduler-heartbeat.mjs'
        source = ("import {appendFileSync} from 'node:fs';\n"
                  "import path from 'node:path';\n"
                  "import {fileURLToPath} from 'node:url';\n"
                  "export const heartbeat = () => 7;\n"
                  f"async function main(){{appendFileSync({str(output)!r},'x')}}\n"
                  "if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();\n").encode()
        script.write_bytes(TRANSITION.fence('scheduler-heartbeat', source, None))
        self.assertEqual(self.run_node(script, label).returncode, 0)
        self.assertFalse(output.exists())
        self.assertEqual(self.run_node(script).returncode, 0)
        self.assertEqual(output.read_text(), 'x')
        check = subprocess.run([NODE, '--input-type=module', '-e',
            f"import {{heartbeat}} from {script.as_uri()!r}; if (heartbeat() !== 7) process.exit(5);"],
            capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertEqual(output.read_text(), 'x')

    def test_observer_symlink_target_keeps_manual_cli(self):
        label = 'ai.openclaw.observer'
        output = self.root / 'observed'
        target = self.root / 'original-observer.mjs'
        target.write_text(f"import {{writeFileSync}} from 'node:fs'; writeFileSync({str(output)!r}, 'ran');\n")
        script = self.root / 'observer.mjs'
        script.write_bytes(TRANSITION.fence('observer', target.read_bytes(), target))
        self.assertEqual(self.run_node(script, label).returncode, 0)
        self.assertFalse(output.exists())
        self.assertEqual(self.run_node(script).returncode, 0)
        self.assertEqual(output.read_text(), 'ran')

    def test_shell_fences_keep_manual_use(self):
        for name, shell in (('transcript-archive', '/bin/sh'), ('log-rotate', '/bin/bash')):
            with self.subTest(name=name):
                output = self.root / (name + '.out')
                source = f'#!/bin/sh\nprintf ran > {str(output)!r}\n'.encode()
                script = self.root / (name + '.sh')
                script.write_bytes(TRANSITION.fence(name, source, None))
                env = dict(os.environ, XPC_SERVICE_NAME='ai.openclaw.' + name)
                result = subprocess.run([shell, str(script)], env=env, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(output.exists())
                env.pop('XPC_SERVICE_NAME')
                result = subprocess.run([shell, str(script)], env=env, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output.read_text(), 'ran')
                output.unlink()


@unittest.skipUnless(os.uname().sysname == 'Darwin' and NODE,
                     'owned launchd transition proof requires macOS and Node')
class OwnedLaunchdTransitionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='timer-fence-launchd-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(os.path.realpath(self.temp.name))
        self.label = 'ai.openclaw.timer-fence-' + uuid.uuid4().hex[:12]
        self.service = 'gui/' + str(os.getuid()) + '/' + self.label
        self.booted = False
        self.addCleanup(self.bootout)

    def bootout(self):
        if self.booted:
            subprocess.run(['/bin/launchctl', 'bootout', self.service], capture_output=True)
            self.booted = False

    def launch(self, entry, arguments):
        plist = self.root / 'timer.plist'
        with plist.open('wb') as stream:
            plistlib.dump({'Label': self.label,
                'ProgramArguments': arguments,
                'RunAtLoad': True, 'StartInterval': 60,
                'StandardOutPath': str(self.root / 'out.log'),
                'StandardErrorPath': str(self.root / 'err.log')}, stream)
        result = subprocess.run(['/bin/launchctl', 'bootstrap',
            'gui/' + str(os.getuid()), str(plist)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.booted = True

    def wait_idle(self, minimum_runs=1):
        end = time.monotonic() + 12
        state = ''
        while time.monotonic() < end:
            result = subprocess.run(['/bin/launchctl', 'print', self.service],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            state = result.stdout
            match = re.search(r'\truns = (\d+)', state)
            if match and int(match.group(1)) >= minimum_runs and '\n\tstate = not running' in state:
                self.assertIn('last exit code = 0', state)
                return int(match.group(1))
            time.sleep(0.04)
        self.fail('owned timer did not become idle: ' + state[-1000:])

    def test_node_parent_and_detached_child_finish_before_unload(self):
        entry = self.root / 'scheduler-heartbeat.mjs'
        child = self.root / 'child.mjs'
        child.write_text("import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';\n"
            "await new Promise(r=>setTimeout(r,650));\n"
            "const fd=openSync(process.argv[2]+'/child.done','w'); writeSync(fd,'complete'); fsyncSync(fd); closeSync(fd);\n")
        source = ("import {spawn} from 'node:child_process';\n"
                  "import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';\n"
                  "import path from 'node:path';\n"
                  "import {fileURLToPath} from 'node:url';\n"
                  "async function main(){\n"
                  " const fd=openSync(process.argv[2]+'/started','w'); writeSync(fd,'started'); fsyncSync(fd); closeSync(fd);\n"
                  " spawn(process.execPath,[process.argv[2]+'/child.mjs',process.argv[2]],{detached:true,stdio:'ignore'}).unref();\n"
                  " await new Promise(r=>setTimeout(r,1400));\n"
                  " const done=openSync(process.argv[2]+'/parent.done','w'); writeSync(done,'complete'); fsyncSync(done); closeSync(done);\n"
                  "}\n"
                  "if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();\n").encode()
        entry.write_bytes(source)
        self.launch(entry, [NODE, str(entry), str(self.root)])
        wait_for(self.root / 'started')
        replacement = TRANSITION.fence('scheduler-heartbeat', source, None, self.label)
        staged = self.root / 'staged.mjs'
        staged.write_bytes(replacement)
        os.replace(staged, entry)
        wait_for(self.root / 'child.done')
        wait_for(self.root / 'parent.done')
        self.assertEqual((self.root / 'child.done').read_text(), 'complete')
        self.assertEqual((self.root / 'parent.done').read_text(), 'complete')
        prior_runs = self.wait_idle()
        self.assertEqual(subprocess.run(['/bin/launchctl', 'kickstart', self.service],
                         capture_output=True).returncode, 0)
        self.wait_idle(prior_runs + 1)
        self.assertEqual((self.root / 'started').read_text(), 'started')
        self.assertEqual((self.root / 'parent.done').read_text(), 'complete')
        self.bootout()
        self.assertFalse((self.root / 'err.log').read_text())

    def test_shell_write_survives_atomic_source_fence(self):
        entry = self.root / 'archive-transcripts.sh'
        source = ("#!/bin/sh\n"
                  f"printf started > {str(self.root / 'started')!r}\n"
                  "sleep 1\n"
                  f"python3 -c \"import os; p={str(self.root / 'shell.done')!r}; f=open(p,'w'); f.write('complete'); f.flush(); os.fsync(f.fileno()); f.close()\"\n").encode()
        entry.write_bytes(source)
        self.launch(entry, ['/bin/sh', str(entry)])
        wait_for(self.root / 'started')
        staged = self.root / 'staged.sh'
        staged.write_bytes(TRANSITION.fence('transcript-archive', source, None, self.label))
        os.replace(staged, entry)
        wait_for(self.root / 'shell.done')
        self.assertEqual((self.root / 'shell.done').read_text(), 'complete')
        prior_runs = self.wait_idle()
        self.assertEqual(subprocess.run(['/bin/launchctl', 'kickstart', self.service],
                         capture_output=True).returncode, 0)
        self.wait_idle(prior_runs + 1)
        self.assertEqual((self.root / 'shell.done').read_text(), 'complete')
        self.bootout()
        self.assertFalse((self.root / 'err.log').read_text())

    def test_same_group_foreground_child_finishes_before_unload(self):
        entry = self.root / 'scheduler-heartbeat.mjs'
        child = self.root / 'child.mjs'
        child.write_text("import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';\n"
            "await new Promise(r=>setTimeout(r,700));\n"
            "const fd=openSync(process.argv[2]+'/child.done','w'); writeSync(fd,'complete'); fsyncSync(fd); closeSync(fd);\n")
        source = ("import {execFile} from 'node:child_process';\n"
                  "import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';\n"
                  "import path from 'node:path';\n"
                  "import {fileURLToPath} from 'node:url';\n"
                  "async function main(){\n"
                  " const fd=openSync(process.argv[2]+'/started','w'); writeSync(fd,'started'); fsyncSync(fd); closeSync(fd);\n"
                  " await new Promise((resolve,reject)=>execFile(process.execPath,[process.argv[2]+'/child.mjs',process.argv[2]],e=>e?reject(e):resolve()));\n"
                  " const done=openSync(process.argv[2]+'/parent.done','w'); writeSync(done,'complete'); fsyncSync(done); closeSync(done);\n"
                  "}\n"
                  "if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();\n").encode()
        entry.write_bytes(source)
        self.launch(entry, [NODE, str(entry), str(self.root)])
        wait_for(self.root / 'started')
        staged = self.root / 'staged.mjs'
        staged.write_bytes(TRANSITION.fence('scheduler-heartbeat', source, None, self.label))
        os.replace(staged, entry)
        self.wait_idle()
        self.assertEqual((self.root / 'child.done').read_text(), 'complete')
        self.assertEqual((self.root / 'parent.done').read_text(), 'complete')
        self.bootout()

    def test_unawaited_same_group_child_dies_with_old_parent(self):
        entry = self.root / 'scheduler-heartbeat.mjs'
        child = self.root / 'child.mjs'
        child.write_text("import {writeFileSync} from 'node:fs';\n"
            "writeFileSync(process.argv[2]+'/child.pid',String(process.pid));\n"
            "await new Promise(r=>setTimeout(r,4000));\n"
            "writeFileSync(process.argv[2]+'/child.done','complete');\n")
        source = ("import {execFile} from 'node:child_process';\n"
                  "import {writeFileSync} from 'node:fs';\n"
                  "import path from 'node:path';\n"
                  "import {fileURLToPath} from 'node:url';\n"
                  "async function main(){\n"
                  " execFile(process.execPath,[process.argv[2]+'/child.mjs',process.argv[2]],()=>{});\n"
                  " writeFileSync(process.argv[2]+'/started','started');\n"
                  " await new Promise(r=>setTimeout(r,300)); process.exit(0);\n"
                  "}\n"
                  "if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();\n").encode()
        entry.write_bytes(source)
        self.launch(entry, [NODE, str(entry), str(self.root)])
        wait_for(self.root / 'child.pid')
        staged = self.root / 'staged.mjs'
        staged.write_bytes(TRANSITION.fence('scheduler-heartbeat', source, None, self.label))
        os.replace(staged, entry)
        self.wait_idle()
        child_pid = (self.root / 'child.pid').read_text()
        child_state = subprocess.run(['/bin/ps', '-p', child_pid, '-o', 'pid='],
                                     capture_output=True, text=True)
        self.assertFalse(child_state.stdout.strip())
        self.assertFalse((self.root / 'child.done').exists())
        self.bootout()

    def test_log_rotation_gzip_finishes_after_source_fence(self):
        entry = self.root / 'log-rotate'
        log = self.root / 'source.log'
        archive = self.root / 'source.log.gz'
        payload = b'old log bytes\n' * 8192
        log.write_bytes(payload)
        source = ("#!/bin/bash\n"
                  f"printf started > {shlex.quote(str(self.root / 'started'))}\n"
                  "sleep 1\n"
                  f"gzip -c {shlex.quote(str(log))} > {shlex.quote(str(archive))} && : > {shlex.quote(str(log))}\n"
                  f"printf complete > {shlex.quote(str(self.root / 'rotate.done'))}\n").encode()
        entry.write_bytes(source)
        self.launch(entry, ['/bin/bash', str(entry)])
        wait_for(self.root / 'started')
        staged = self.root / 'staged.sh'
        staged.write_bytes(TRANSITION.fence('log-rotate', source, None, self.label))
        os.replace(staged, entry)
        wait_for(self.root / 'rotate.done')
        self.assertEqual(log.read_bytes(), b'')
        result = subprocess.run(['gzip', '-dc', str(archive)], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, payload)
        self.wait_idle()
        self.bootout()
        self.assertFalse((self.root / 'err.log').read_text())

    def test_old_label_hands_off_to_closed_then_open_gate(self):
        entry = self.root / 'scheduler-heartbeat.mjs'
        old_output = self.root / 'old-ran'
        source = ("import {appendFileSync} from 'node:fs';\n"
                  "import path from 'node:path';\n"
                  "import {fileURLToPath} from 'node:url';\n"
                  f"async function main(){{appendFileSync({str(old_output)!r},'x')}}\n"
                  "if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();\n").encode()
        entry.write_bytes(source)
        self.launch(entry, [NODE, str(entry)])
        wait_for(old_output)
        self.wait_idle()
        staged = self.root / 'staged.mjs'
        staged.write_bytes(TRANSITION.fence('scheduler-heartbeat', source, None, self.label))
        os.replace(staged, entry)
        self.assertEqual(subprocess.run(['/bin/launchctl', 'kickstart', self.service],
                         capture_output=True).returncode, 0)
        self.wait_idle(2)
        self.assertEqual(old_output.read_text(), 'x')
        self.bootout()

        for name in ('timer-entry.py', 'service_gate.py'):
            shutil.copyfile(ROOT / 'workspace-bin' / name, self.root / name)
            (self.root / name).chmod(0o600)
        gate = load_module('transition_owned_gate', self.root / 'service_gate.py')
        pins = gate.initialize(str(self.root / 'gate'))
        app_output = self.root / 'new-ran'
        app = self.root / 'new-app.py'
        app.write_text(f'import pathlib\npathlib.Path({str(app_output)!r}).write_text("ran")\n')
        app.chmod(0o600)
        app_argv = ['/usr/bin/python3', '-I', '-S', str(app)]
        stage = load_module('transition_owned_stage', ROOT / 'workspace-bin/stage-timer-entries.py')
        received = stage.probe(self.label, {}, self.root)
        environment = stage.received_environment(received, {}, self.label)
        manifest = self.root / 'manifest.json'
        value = {'version': 1, 'gate_code': str(self.root / 'service_gate.py'),
                 'gate_root': str(self.root / 'gate'), 'gate_pins': pins,
                 'launcher_interpreter': subprocess.run(['/usr/bin/python3', '-I', '-S', '-c',
                     'import sys;print(sys.executable)'], check=True, text=True,
                     capture_output=True).stdout.strip(),
                 'jobs': {self.label: {'argv': app_argv, 'cwd': received['cwd'],
                                       'environment': environment,
                                       'dynamic_environment': ['SSH_AUTH_SOCK']}},
                 'files': {str(self.root / name): sha(self.root / name)
                           for name in ('timer-entry.py', 'service_gate.py', 'new-app.py')},
                 'executables': {'/usr/bin/python3': sha(pathlib.Path('/usr/bin/python3')),
                                 '/bin/launchctl': sha(pathlib.Path('/bin/launchctl'))},
                 'resolution': {}}
        manifest.write_text(json.dumps(value))
        manifest.chmod(0o600)
        runner = ['/usr/bin/python3', '-I', '-S', str(self.root / 'timer-entry.py'),
                  str(manifest), sha(manifest), self.label, str(self.root / 'gate'),
                  pins['lock'], pins['root'], '--', *app_argv]
        with gate.Gate(str(self.root / 'gate'), pins) as opened:
            with opened.close_and_drain('transition-owned', 'proof', 3) as held:
                self.launch(self.root / 'timer-entry.py', runner)
                self.wait_idle()
                self.assertFalse(app_output.exists())
            opened.reopen(held.receipt)
            self.assertEqual(subprocess.run(['/bin/launchctl', 'kickstart', self.service],
                             capture_output=True).returncode, 0)
            self.wait_idle(2)
        self.assertEqual(app_output.read_text(), 'ran')
        self.assertEqual(old_output.read_text(), 'x')
        self.bootout()


if __name__ == '__main__':
    unittest.main()
