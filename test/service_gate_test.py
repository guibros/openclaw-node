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
        self.pin = initialize(self.root)
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
        child = subprocess.Popen([sys.executable, '-I', '-S', str(SOURCE), 'run', str(self.root), '--lock', self.pin['lock'], '--root-pin', self.pin['root'], '--', *argv],
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
        with Gate(self.root, self.pin) as probe:
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
        with Gate(self.root, self.pin) as probe:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(probe.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stop.touch(mode=0o600)
            self.assertEqual(child.wait(timeout=5), 0)
            probe.exclusive(1)
            fcntl.flock(probe.lock, fcntl.LOCK_UN)

    def test_durable_marker_precedes_drain_and_blocks_later_work(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        with Gate(self.root, self.pin) as gate, concurrent.futures.ThreadPoolExecutor() as pool:
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
        with Gate(self.root, self.pin) as gate:
            with self.assertRaisesRegex(Refused, 'did not drain'):
                gate.close_and_drain('owned', 'preservation', .05)
            self.assertEqual(gate.marker()['window'], 'owned')
        self.assert_no_work(0)

    def test_controller_close_does_not_remove_durable_hold(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1):
                pass
        with Gate(self.root, self.pin) as reopened:
            self.assertEqual(reopened.marker()['window'], 'owned')
        self.assert_no_work(0)

    def test_no_reusable_factory_can_manufacture_an_undrained_guard(self):
        with Gate(self.root, self.pin) as gate:
            self.assertFalse(hasattr(gate, '_drained_guard'))
            with self.assertRaisesRegex(Refused, 'fresh exclusive drain'):
                module.ClosedGate(gate)
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                self.assertTrue(guard.check()['verified'])
                self.assertFalse(gate._drain_verified)
                with self.assertRaisesRegex(Refused, 'fresh exclusive drain'):
                    module.ClosedGate(gate)

    def test_publication_receipt_is_available_before_the_actual_drain(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        receipts = []
        with Gate(self.root, self.pin) as gate, concurrent.futures.ThreadPoolExecutor() as pool:
            def published(receipt):
                self.assertEqual(receipt['marker'], {'window': 'owned', 'reason': 'preservation'})
                self.assertIsNone(child.poll())
                self.assertEqual(receipt, gate._hold_receipt())
                receipts.append(receipt)
            closing = pool.submit(gate.close_and_drain, 'owned', 'preservation', 5, published)
            end = time.monotonic() + 2
            while not receipts and time.monotonic() < end:
                time.sleep(.01)
            self.assertEqual(len(receipts), 1)
            self.assertFalse(closing.done())
            self.assert_no_work(0)
            self.stop.touch(mode=0o600)
            self.assertEqual(child.wait(timeout=5), 0)
            with closing.result(timeout=5) as guard:
                self.assertEqual(guard.check()['receipt'], receipts[0])

    def test_failed_publication_record_retains_the_closed_marker_and_receipt(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        with Gate(self.root, self.pin) as gate:
            def failed(receipt):
                raise OSError('owned receipt write failure')
            with self.assertRaisesRegex(OSError, 'receipt write failure') as raised:
                gate.close_and_drain('owned', 'preservation', 1, failed)
            self.assertIsNone(child.poll())
            self.assertEqual(raised.exception.closed_receipt, gate._hold_receipt())
            self.assertEqual(gate.marker()['window'], 'owned')
            self.assertFalse(gate._drain_verified)
        self.assert_no_work(0)

    def test_restoration_close_does_not_create_a_certifying_guard(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_for_restoration('owned', 'restoration', 1) as guard:
                evidence = guard.check()
                self.assertTrue(evidence['restoration_only'])
                self.assertNotIn('verified', evidence)
                self.assertNotIn('watch_session_id', evidence)
                self.assert_no_work(0)

    def test_reopen_readiness_is_checked_under_the_exclusive_lock(self):
        with Gate(self.root, self.pin) as gate, gate.close_and_drain('owned', 'preservation', 1) as guard:
            receipt = guard.check()['receipt']
            observations = []
            def ready():
                fd = os.open(self.root / 'gate.lock', os.O_RDWR)
                try:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
                finally:
                    os.close(fd)
                observations.append(gate.marker())
                return {'verified': True}
            gate.reopen(receipt, before_open=ready)
            self.assertEqual(observations, [{'window': 'owned', 'reason': 'preservation'}])
            self.assertIsNone(gate.marker())

    def test_failed_reopen_readiness_keeps_the_hold_closed(self):
        with Gate(self.root, self.pin) as gate, gate.close_and_drain('owned', 'preservation', 1) as guard:
            receipt = guard.check()['receipt']
            with self.assertRaisesRegex(Refused, 'readiness was not verified'):
                gate.reopen(receipt, before_open=lambda: {'verified': False})
            guard.check()
            self.assert_no_work(0)

    def test_reopen_revalidates_the_receipt_after_the_readiness_callback(self):
        with Gate(self.root, self.pin) as gate, gate.close_and_drain('owned', 'preservation', 1) as guard:
            receipt = guard.check()['receipt']
            def changed():
                marker = self.root / 'closed.json'
                marker.write_text(json.dumps({'window': 'different', 'reason': 'preservation'}))
                return {'verified': True}
            with self.assertRaisesRegex(Refused, 'receipt changed during readiness'):
                gate.reopen(receipt, before_open=changed)
            self.assertTrue((self.root / 'closed.json').exists())
            self.assert_no_work(0)

    def crashed_controller(self, phase):
        ready = self.directory / 'controller-ready'
        script = '''import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('gate',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ready=pathlib.Path(sys.argv[3])
receipt=ready.with_name('controller-receipt')
def save_receipt(value):
 receipt.write_text(json.dumps(value));receipt.chmod(0o600)
with module.Gate(sys.argv[2], json.loads(sys.argv[5])) as gate:
 if sys.argv[4]=='draining':
  original=gate.exclusive
  def exclusive(seconds):
   save_receipt(gate.closed_receipt)
   ready.write_text('durable marker published')
   original(seconds)
  gate.exclusive=exclusive
 with gate.close_and_drain('owned','preservation',10) as guard:
  guard.check()
  if sys.argv[4]=='closed':
   save_receipt(guard.check()['receipt'])
   ready.write_text('drain verified')
  sys.stdin.read()
'''
        child = subprocess.Popen([sys.executable, '-c', script, str(SOURCE), str(self.root),
                                  str(ready), phase, json.dumps(self.pin)], stdin=subprocess.PIPE,
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
            return json.loads((self.directory / 'controller-receipt').read_text())
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stdin.close()

    def test_controller_crash_after_publication_preserves_hold_until_foreground_drains(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        receipt = self.crashed_controller('draining')
        with Gate(self.root, self.pin) as gate:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(gate.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stop.touch(mode=0o600)
            self.assertEqual(child.wait(timeout=5), 0)
            with gate.reattach(receipt) as guard:
                self.assertTrue(guard.check()['restoration_only'])
            gate.reopen(receipt)
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertTrue((self.directory / 'bypass').exists())

    def test_controller_crash_after_verified_drain_preserves_closed_execution(self):
        receipt = self.crashed_controller('closed')
        with Gate(self.root, self.pin) as gate:
            self.assertEqual(gate.marker(), {'window': 'owned', 'reason': 'preservation'})
            with gate.reattach(receipt) as guard:
                self.assertTrue(guard.check()['restoration_only'])
            gate.reopen(receipt)
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertTrue((self.directory / 'bypass').exists())

    def test_marker_sync_failure_cannot_publish_partial_closed_metadata(self):
        with Gate(self.root, self.pin) as gate:
            with patch.object(module, 'sync', side_effect=OSError('owned sync fault')):
                with self.assertRaises(OSError):
                    gate.close_and_drain('owned', 'preservation', 1)
            self.assertIsNone(gate.marker())
            self.assertTrue(list(self.root.glob('.closed-*')))
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)

    def test_directory_sync_failure_after_publish_retains_valid_closed_marker(self):
        original_sync = module.sync
        with Gate(self.root, self.pin) as gate:
            def failing_sync(fd):
                if fd == gate.directory:
                    raise OSError('owned directory sync fault')
                original_sync(fd)
            with patch.object(module, 'sync', side_effect=failing_sync):
                with self.assertRaises(OSError):
                    gate.close_and_drain('owned', 'preservation', 1)
            expected = {'window': 'owned', 'reason': 'preservation'}
            self.assertEqual(gate.marker(), expected)
            receipt = gate.closed_receipt
        self.assert_no_work(0)
        with Gate(self.root, self.pin) as reopened:
            reopened.reopen(receipt)
            self.assertIsNone(reopened.marker())

    def test_reopen_requires_exact_window_then_restores_execution(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                expected = json.loads(json.dumps(guard.check()['receipt']))
            with self.assertRaisesRegex(Refused, 'does not match'):
                gate.reopen({'window': 'wrong', 'reason': 'preservation'})
            gate.reopen(expected)
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertTrue((self.directory / 'bypass').exists())

    def test_recreated_marker_refuses_original_receipt_after_controller_loss(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                receipt = json.loads(json.dumps(guard.check()['receipt']))
                self.assertFalse(guard.check()['restoration_only'])
        marker = self.root / 'closed.json'
        original = marker.read_bytes()
        marker.unlink()
        marker.write_bytes(original)
        marker.chmod(0o600)
        with Gate(self.root, self.pin) as gate:
            self.assertNotEqual(gate._hold_receipt()['marker_identity'], receipt['marker_identity'])
            with self.assertRaisesRegex(Refused, 'receipt does not match'):
                gate.reattach(receipt)
            with self.assertRaisesRegex(Refused, 'receipt does not match'):
                gate.reopen(receipt)
        self.assert_no_work(0)

    def test_wrong_metadata_hash_refuses_receipt_recovery(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                receipt = json.loads(json.dumps(guard.check()['receipt']))
            receipt['metadata_sha256'] = '0' * 64
            with self.assertRaisesRegex(Refused, 'receipt does not match'):
                gate.reattach(receipt)
            with self.assertRaisesRegex(Refused, 'receipt does not match'):
                gate.reopen(receipt)

    def test_timeout_continuation_requires_a_fresh_drain_and_remains_restoration_only(self):
        child = self.launch(self.shell())
        self.wait_ready(child)
        with Gate(self.root, self.pin) as gate:
            with self.assertRaisesRegex(Refused, 'did not drain'):
                gate.close_and_drain('owned', 'preservation', .05)
            receipt = json.loads(json.dumps(gate.closed_receipt))
        with Gate(self.root, self.pin) as gate:
            with self.assertRaisesRegex(Refused, 'fresh exclusive drain'):
                module.ClosedGate(gate)
            with self.assertRaisesRegex(Refused, 'did not drain'):
                gate.reattach(receipt, .05)
            self.assert_no_work(0)
            self.stop.touch(mode=0o600)
            self.assertEqual(child.wait(timeout=5), 0)
            with gate.reattach(receipt) as guard:
                evidence = guard.check()
                self.assertTrue(evidence['restoration_only'])
                self.assertEqual(evidence['receipt'], receipt)
            gate.reopen(receipt)
        child = self.launch(self.no_work())
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertTrue((self.directory / 'bypass').exists())

    def test_fifo_marker_refuses_without_blocking_or_logs(self):
        os.mkfifo(self.root / 'closed.json', mode=0o600)
        self.assert_no_work(78)

    def test_fifo_identity_refuses_without_blocking_or_logs(self):
        (self.root / 'identity.json').unlink()
        os.mkfifo(self.root / 'identity.json', mode=0o600)
        self.assert_no_work(78)

    def test_deep_json_marker_refuses_without_a_traceback(self):
        marker = self.root / 'closed.json'
        marker.write_text('[' * 1200 + '0' + ']' * 1200)
        marker.chmod(0o600)
        self.assert_no_work(78)

    def test_deep_json_identity_refuses_without_a_traceback(self):
        (self.root / 'identity.json').write_text('[' * 1200 + '0' + ']' * 1200)
        self.assert_no_work(78)

    def test_runner_requires_the_installed_lock_pin(self):
        result = subprocess.run([sys.executable, '-I', '-S', str(SOURCE), 'run', str(self.root),
                                 '--', *self.no_work()], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stdout, b'')
        self.assertEqual(result.stderr, b'')
        self.assertFalse((self.directory / 'bypass').exists())

    def test_runner_requires_both_independent_pins(self):
        for options in (['--lock', self.pin['lock']], ['--root-pin', self.pin['root']]):
            result = subprocess.run([sys.executable, '-I', '-S', str(SOURCE), 'run', str(self.root),
                                     *options, '--', *self.no_work()],
                                    capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 78)
            self.assertEqual(result.stdout, b'')
            self.assertEqual(result.stderr, b'')
            self.assertFalse((self.directory / 'bypass').exists())

    def test_substitute_gate_refuses_the_original_job_and_controller_without_a_watcher(self):
        self.root.rename(self.directory / 'original')
        initialize(self.root)
        self.assert_no_work(78)
        with self.assertRaisesRegex(Refused, 'root pin differs'):
            Gate(self.root, self.pin)

    def test_controller_refuses_mismatched_root_and_lock_pins(self):
        for field in ('root', 'lock'):
            pin = dict(self.pin)
            pin[field] = '0:0:0' if field == 'lock' else '0:0'
            with self.assertRaisesRegex(Refused, 'pin differs'):
                Gate(self.root, pin)

    def test_non_normalized_path_refuses_before_execution(self):
        path = str(self.root.parent) + '/other/../gate'
        result = subprocess.run([sys.executable, '-I', '-S', str(SOURCE), 'run', path,
                                 '--lock', self.pin['lock'], '--root-pin', self.pin['root'], '--', *self.no_work()],
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stdout, b'')
        self.assertEqual(result.stderr, b'')
        self.assertFalse((self.directory / 'bypass').exists())

    def test_interpreter_isolation_refuses_neighbor_module_shadowing(self):
        wrapper = self.directory / 'service_gate.py'
        shutil.copyfile(SOURCE, wrapper)
        shadow = self.directory / 'secrets.py'
        shadow.write_text("import pathlib;pathlib.Path(__file__).with_name('shadow-ran').touch();raise RuntimeError('owned shadow')")
        result = subprocess.run([sys.executable, '-I', '-S', str(wrapper), 'run', str(self.root),
                                 '--lock', self.pin['lock'], '--root-pin', self.pin['root'], '--', *self.no_work()],
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b'')
        self.assertEqual(result.stderr, b'')
        self.assertTrue((self.directory / 'bypass').exists())
        self.assertFalse((self.directory / 'shadow-ran').exists())

    def test_restoration_type_cannot_emit_certification_fields(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                evidence = guard.check()
                receipt = evidence['receipt']
                session = evidence['watch_session_id']
                self.assertEqual(guard.check()['watch_session_id'], session)
        with Gate(self.root, self.pin) as gate:
            with gate.reattach(receipt) as guard:
                evidence = guard.check()
                self.assertIsInstance(guard, module.RestorationGate)
                self.assertNotIsInstance(guard, module.ClosedGate)
                self.assertTrue(evidence['restoration_only'])
                self.assertNotIn('verified', evidence)
                self.assertNotIn('watch_session_id', evidence)
            gate.reopen(receipt)

    def test_stray_gate_entry_invalidates_saved_receipt_after_observer_loss(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                receipt = guard.check()['receipt']
        stray = self.root / 'stray'
        stray.touch(mode=0o600)
        stray.unlink()
        with Gate(self.root, self.pin) as gate:
            with self.assertRaisesRegex(Refused, 'receipt does not match'):
                gate.reattach(receipt)

    @unittest.skipUnless(sys.platform == 'darwin', 'requires actual Mac vnode notifications')
    def test_closed_watch_descriptor_cannot_be_silently_lost(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                record = gate.paths.records[-2]
                os.close(record['fd'])
                gate.paths.handles.remove(record['fd'])
                with self.assertRaises(OSError):
                    guard.check()

    def test_symlink_ancestor_refuses_before_execution(self):
        alias = self.directory / 'alias'
        alias.symlink_to(self.directory, target_is_directory=True)
        result = subprocess.run([sys.executable, str(SOURCE), 'run', str(alias / 'gate'), '--lock', self.pin['lock'], '--root-pin', self.pin['root'], '--',
                                 *self.no_work()], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stdout, b'')
        self.assertEqual(result.stderr, b'')
        self.assertFalse((self.directory / 'bypass').exists())

    def test_unrelated_ancestor_entry_write_does_not_refuse_a_live_hold(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                (self.directory / 'unrelated').write_text('owned')
                self.assertTrue(guard.check()['verified'])

    @unittest.skipUnless(sys.platform == 'darwin', 'requires actual Mac pathname watches')
    def test_transient_ancestor_replacement_cannot_pass_live_hold_verification(self):
        parent = self.directory / 'stable-parent'
        parent.mkdir(mode=0o700)
        root = parent / 'gate'
        pin = initialize(root)
        with Gate(root, pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                parent.rename(self.directory / 'original-parent')
                parent.mkdir(mode=0o700)
                initialize(root)
                result = subprocess.run([sys.executable, str(SOURCE), 'run', str(root), '--lock', pin['lock'], '--root-pin', pin['root'], '--',
                                         *self.no_work()], capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 78)
                self.assertFalse((self.directory / 'bypass').exists())
                self.assertEqual(result.stdout, b'')
                self.assertEqual(result.stderr, b'')
                parent.rename(self.directory / 'replacement-parent')
                (self.directory / 'original-parent').rename(parent)
                with self.assertRaisesRegex(Refused, 'path mapping mutated'):
                    guard.check()
                self.assertTrue(gate.paths.events)
                with self.assertRaisesRegex(Refused, 'session was already refused'):
                    guard.check()

    @unittest.skipUnless(sys.platform == 'darwin', 'requires actual Mac pathname watches')
    def test_path_witness_starts_before_marker_publication_and_drain(self):
        with Gate(self.root, self.pin) as gate:
            original = gate.exclusive
            def exclusive(seconds):
                alternate = self.directory / 'alternate'
                self.root.rename(alternate)
                alternate.rename(self.root)
                original(seconds)
            gate.exclusive = exclusive
            with self.assertRaisesRegex(Refused, 'path mapping mutated'):
                gate.close_and_drain('owned', 'preservation', 1)
            self.assertTrue(gate.paths.events)
            self.assertEqual(gate.marker(), {'window': 'owned', 'reason': 'preservation'})

    def test_existing_hold_cannot_be_overwritten_by_a_new_window(self):
        with Gate(self.root, self.pin) as gate:
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
        with Gate(self.root, self.pin) as gate:
            lock = self.root / 'gate.lock'
            data = lock.read_bytes()
            lock.rename(self.root / 'original.lock')
            lock.write_bytes(data)
            lock.chmod(0o600)
            with self.assertRaisesRegex(Refused, 'identity changed'):
                gate.validate()
        self.assert_no_work(78)

    def test_directory_replacement_cannot_reuse_the_original_identity(self):
        with Gate(self.root, self.pin) as gate:
            original = self.directory / 'original-gate'
            self.root.rename(original)
            shutil.copytree(original, self.root)
            self.root.chmod(0o700)
            with self.assertRaisesRegex(Refused, 'path mapping (mutated|or watched descriptor changed)'):
                gate.validate()
        self.assert_no_work(78)

    @unittest.skipUnless(sys.platform == 'darwin', 'requires actual Mac vnode notifications')
    def test_marker_rewrite_and_restore_is_detected_by_kernel_watch(self):
        with Gate(self.root, self.pin) as gate:
            with gate.close_and_drain('owned', 'preservation', 1) as guard:
                marker = self.root / 'closed.json'
                original = marker.read_bytes()
                marker.write_bytes(original)
                with self.assertRaisesRegex(Refused, 'inode mutated'):
                    guard.check()
                self.assertTrue(guard.events)
        self.assert_no_work(0)

    def test_installer_cannot_reopen_a_closed_gate(self):
        with Gate(self.root, self.pin) as gate:
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
            'ProgramArguments': [sys.executable, '-I', '-S', str(SOURCE), 'run', str(self.root), '--lock', self.pin['lock'], '--root-pin', self.pin['root'], '--',
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
            with Gate(self.root, self.pin) as gate:
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
