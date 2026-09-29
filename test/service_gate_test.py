import concurrent.futures
import fcntl
import importlib.util
import json
import os
import pathlib
import plistlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'workspace-bin/service_gate.py'
spec = importlib.util.spec_from_file_location('service_gate', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Gate, Refused, initialize = module.Gate, module.Refused, module.initialize


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-gate-owned-')
        self.directory = pathlib.Path(self.temp.name).resolve()
        self.directory.chmod(0o700)
        self.root = self.directory / 'gate'
        initialize(self.root)
        self.children = []
        self.ready = self.directory / 'ready'
        self.stop = self.directory / 'stop'

    def tearDown(self):
        self.stop.touch(mode=0o600)
        for child in self.children:
            if child.poll() is None:
                child.wait(timeout=5)
            child.stdout.close()
            child.stderr.close()
        self.temp.cleanup()

    def launch(self, argv):
        child = subprocess.Popen([sys.executable, str(SOURCE), 'run', str(self.root), '--', *argv],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        return child

    def wait_ready(self, child):
        end = time.monotonic() + 5
        while not self.ready.exists() and child.poll() is None and time.monotonic() < end:
            time.sleep(.01)
        self.assertTrue(self.ready.exists(), 'owned foreground process did not start')

    def shell(self):
        return ['/bin/sh', '-c', 'echo ready > "$1"; while [ ! -e "$2" ]; do /bin/sleep .02; done',
                'owned', str(self.ready), str(self.stop)]

    def no_work(self):
        return ['/bin/sh', '-c', 'echo bypass > "$1"', 'owned', str(self.directory / 'bypass')]

    def assert_no_work(self, exit_code):
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), exit_code)
        self.assertFalse((self.directory / 'bypass').exists())
        self.assertEqual(child.stdout.read(), b'')
        self.assertEqual(child.stderr.read(), b'')

    def test_open_gate_executes_foreground_work(self):
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertTrue((self.directory / 'bypass').exists())

    def test_shell_exec_holds_actual_lock_until_normal_exit(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        with Gate(self.root) as probe:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(probe.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stop.touch(mode=0o600)
            self.assertEqual(child.wait(timeout=5), 0)
            probe.exclusive(1)
            fcntl.flock(probe.lock, fcntl.LOCK_UN)

    @unittest.skipUnless(shutil.which('node'), 'Node is required for actual exec lifetime')
    def test_node_exec_holds_actual_lock_until_normal_exit(self):
        script = "const fs=require('fs');fs.writeFileSync(process.argv[1],'ready');const timer=setInterval(()=>{if(fs.existsSync(process.argv[2]))clearInterval(timer)},20)"
        child = self.launch([shutil.which('node'), '-e', script, str(self.ready), str(self.stop)])
        self.wait_ready(child)
        with Gate(self.root) as probe:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(probe.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stop.touch(mode=0o600)
            self.assertEqual(child.wait(timeout=5), 0)
            probe.exclusive(1)
            fcntl.flock(probe.lock, fcntl.LOCK_UN)

    def test_durable_marker_precedes_drain_and_blocks_later_work(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        with Gate(self.root) as gate, concurrent.futures.ThreadPoolExecutor() as pool:
            closing = pool.submit(gate.close_and_drain, 'owned', 'preservation', 5)
            end = time.monotonic() + 2
            while not (self.root / 'closed.json').exists() and time.monotonic() < end:
                time.sleep(.01)
            self.assertEqual(gate.marker(), {'window': 'owned', 'reason': 'preservation'})
            self.assertFalse(closing.done())
            self.assert_no_work(0)
            self.stop.touch(mode=0o600)
            self.assertEqual(child.wait(timeout=5), 0)
            with closing.result(timeout=5) as guard:
                evidence = guard.check()
                self.assertTrue(evidence['verified'])
                self.assertFalse(evidence['os_spawn_coverage'])
                self.assertTrue(evidence['requires_foreground_contract'])
                self.assert_no_work(0)
                guard.check()

    def test_drain_deadline_leaves_durable_hold_for_recovery(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        with Gate(self.root) as gate:
            with self.assertRaisesRegex(Refused, 'did not drain'):
                gate.close_and_drain('owned', 'preservation', .05)
            self.assertEqual(gate.marker()['window'], 'owned')
        self.assert_no_work(0)

    def test_controller_close_does_not_remove_durable_hold(self):
        with Gate(self.root) as gate:
            with gate.close_and_drain('owned', 'preservation', 1):
                pass
        with Gate(self.root) as reopened:
            self.assertEqual(reopened.marker()['window'], 'owned')
        self.assert_no_work(0)

    def crashed_controller(self, phase):
        ready = self.directory / 'controller-ready'
        script = '''import importlib.util,pathlib,sys
spec=importlib.util.spec_from_file_location('gate',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ready=pathlib.Path(sys.argv[3])
with module.Gate(sys.argv[2]) as gate:
 if sys.argv[4]=='draining':
  original=gate.exclusive
  def exclusive(seconds):
   ready.write_text('durable marker published')
   original(seconds)
  gate.exclusive=exclusive
 with gate.close_and_drain('owned','preservation',10) as guard:
  guard.check()
  if sys.argv[4]=='closed':ready.write_text('drain verified')
  sys.stdin.read()
'''
        child = subprocess.Popen([sys.executable, '-c', script, str(SOURCE), str(self.root),
                                  str(ready), phase], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        try:
            end = time.monotonic() + 5
            while not ready.exists() and child.poll() is None and time.monotonic() < end:
                time.sleep(.01)
            self.assertTrue(ready.exists(), 'owned controller did not reach the crash boundary')
            self.assertIsNone(child.poll())
            self.assert_no_work(0)
            child.kill()
            self.assertEqual(child.wait(timeout=5), -9)
            self.assert_no_work(0)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stdin.close()

    def test_controller_crash_after_publication_preserves_hold_until_foreground_drains(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        self.crashed_controller('draining')
        with Gate(self.root) as gate:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(gate.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stop.touch(mode=0o600)
            self.assertEqual(child.wait(timeout=5), 0)
            gate.reopen({'window': 'owned', 'reason': 'preservation'})
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertTrue((self.directory / 'bypass').exists())

    def test_controller_crash_after_verified_drain_preserves_closed_execution(self):
        self.crashed_controller('closed')
        with Gate(self.root) as gate:
            self.assertEqual(gate.marker(), {'window': 'owned', 'reason': 'preservation'})
            gate.reopen({'window': 'owned', 'reason': 'preservation'})
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertTrue((self.directory / 'bypass').exists())

    def test_marker_sync_failure_cannot_publish_partial_closed_metadata(self):
        with Gate(self.root) as gate:
            with patch.object(module, 'sync', side_effect=OSError('owned sync fault')):
                with self.assertRaises(OSError):
                    gate.close_and_drain('owned', 'preservation', 1)
            self.assertIsNone(gate.marker())
            self.assertTrue(list(self.root.glob('.closed-*')))
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)

    def test_directory_sync_failure_after_publish_retains_valid_closed_marker(self):
        original_sync = module.sync
        with Gate(self.root) as gate:
            def failing_sync(fd):
                if fd == gate.directory:
                    raise OSError('owned directory sync fault')
                original_sync(fd)
            with patch.object(module, 'sync', side_effect=failing_sync):
                with self.assertRaises(OSError):
                    gate.close_and_drain('owned', 'preservation', 1)
            expected = {'window': 'owned', 'reason': 'preservation'}
            self.assertEqual(gate.marker(), expected)
        self.assert_no_work(0)
        with Gate(self.root) as reopened:
            reopened.reopen(expected)
            self.assertIsNone(reopened.marker())

    def test_reopen_requires_exact_window_then_restores_execution(self):
        with Gate(self.root) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                expected = dict(guard.marker)
            with self.assertRaisesRegex(Refused, 'does not match'):
                gate.reopen({'window': 'wrong', 'reason': 'preservation'})
            gate.reopen(expected)
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertTrue((self.directory / 'bypass').exists())

    def test_existing_hold_cannot_be_overwritten_by_a_new_window(self):
        with Gate(self.root) as gate:
            with gate.close_and_drain('owned', 'preservation', 1):
                pass
            original = (self.root / 'closed.json').read_bytes()
            with self.assertRaisesRegex(Refused, 'requires restoration'):
                gate.close_and_drain('new', 'preservation', 1)
            self.assertEqual((self.root / 'closed.json').read_bytes(), original)

    def test_missing_identity_fails_closed_without_logs(self):
        (self.root / 'identity.json').unlink()
        self.assert_no_work(78)

    def test_invalid_marker_fails_closed_without_logs(self):
        marker = self.root / 'closed.json'
        marker.write_text('["window","reason"]')
        marker.chmod(0o600)
        self.assert_no_work(78)

    def test_marker_symlink_fails_closed_even_for_missing_target(self):
        (self.root / 'closed.json').symlink_to(self.directory / 'missing')
        self.assert_no_work(78)

    def test_gate_file_replacement_refuses_even_with_identical_bytes(self):
        with Gate(self.root) as gate:
            lock = self.root / 'gate.lock'
            data = lock.read_bytes()
            lock.rename(self.root / 'original.lock')
            lock.write_bytes(data)
            lock.chmod(0o600)
            with self.assertRaisesRegex(Refused, 'identity changed'):
                gate.validate()
        self.assert_no_work(78)

    def test_directory_replacement_cannot_reuse_the_original_identity(self):
        with Gate(self.root) as gate:
            original = self.directory / 'original-gate'
            self.root.rename(original)
            shutil.copytree(original, self.root)
            self.root.chmod(0o700)
            with self.assertRaisesRegex(Refused, 'directory mapping changed'):
                gate.validate()
        self.assert_no_work(78)

    @unittest.skipUnless(sys.platform == 'darwin', 'requires actual Mac vnode notifications')
    def test_marker_rewrite_and_restore_is_detected_by_kernel_watch(self):
        with Gate(self.root) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                marker = self.root / 'closed.json'
                original = marker.read_bytes()
                marker.write_bytes(original)
                with self.assertRaisesRegex(Refused, 'inode mutated'):
                    guard.check()
                self.assertTrue(guard.events)
        self.assert_no_work(0)

    def test_installer_cannot_reopen_a_closed_gate(self):
        with Gate(self.root) as gate:
            with gate.close_and_drain('owned', 'preservation', 1):
                pass
        result = subprocess.run([sys.executable, str(SOURCE), 'init', str(self.root)], capture_output=True)
        self.assertEqual(result.returncode, 78)
        self.assert_no_work(0)

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('node'),
                         'requires actual Mac launchd timer')
    def test_real_launchd_timer_remains_inert_after_controller_exit(self):
        label = 'ai.openclaw.gate-owned.' + secrets.token_hex(8)
        target = f'gui/{os.getuid()}/{label}'
        script = self.directory / 'owned.cjs'
        counter = self.directory / 'application-runs'
        log, err = self.directory / 'job.log', self.directory / 'job.err'
        script.write_text("require('fs').appendFileSync(process.argv[2],'application\\n')")
        unit = self.directory / 'owned.plist'
        unit.write_bytes(plistlib.dumps({'Label': label,
            'ProgramArguments': [sys.executable, str(SOURCE), 'run', str(self.root), '--',
                                 shutil.which('node'), str(script), str(counter)],
            'RunAtLoad': True, 'StartInterval': 2, 'ThrottleInterval': 1,
            'StandardOutPath': str(log), 'StandardErrorPath': str(err)}))
        def status():
            output = subprocess.check_output(['/bin/launchctl', 'print', target], text=True)
            return {'runs': int(re.search(r'(?m)^\s*runs = (\d+)$', output)[1]),
                    'running': re.search(r'(?m)^\s*pid = \d+$', output) is not None,
                    'exit': re.search(r'(?m)^\s*last exit code = (\d+)$', output)}
        def wait_for(predicate):
            end = time.monotonic() + 10
            while time.monotonic() < end:
                value = status()
                if predicate(value):
                    return value
                time.sleep(.02)
            self.fail('owned timer deadline exceeded')
        result = subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(unit)],
                                capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        try:
            wait_for(lambda row: row['runs'] > 0 and not row['running'] and row['exit']
                     and row['exit'][1] == '0' and counter.exists())
            with Gate(self.root) as gate:
                with gate.close_and_drain('owned', 'preservation', 2) as guard:
                    guard.check()
            baseline = counter.read_bytes()
            self.assertTrue(baseline)
            first = status()['runs']
            last = wait_for(lambda row: row['runs'] >= first + 2 and not row['running'])
            self.assertEqual(last['exit'][1], '0')
            self.assertEqual(counter.read_bytes(), baseline)
            self.assertEqual(log.read_bytes(), b'')
            self.assertEqual(err.read_bytes(), b'')
            self.assertTrue((self.root / 'closed.json').exists())
            print(json.dumps({'ownedTimer': label, 'configuredIntervalSeconds': 2,
                'runsBeforeClosedWait': first, 'runsAfterClosedWait': last['runs'],
                'applicationRunsBefore': len(baseline.splitlines()),
                'applicationRunsAfter': len(counter.read_bytes().splitlines()),
                'lastExit': int(last['exit'][1]), 'jobLogBytes': log.stat().st_size,
                'jobErrorBytes': err.stat().st_size, 'markerSurvivesControllerExit': True,
                'osSpawnCoverage': False, 'productionMutations': 0}), flush=True)
        finally:
            result = subprocess.run(['/bin/launchctl', 'bootout', target], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotEqual(subprocess.run(['/bin/launchctl', 'print', target],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode, 0)


if __name__ == '__main__':
    unittest.main()
