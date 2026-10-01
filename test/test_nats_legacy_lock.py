import fcntl
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest


REPO = Path(__file__).resolve().parents[1]
HELPER = REPO / 'bin' / 'nats-legacy-lock.py'
spec = importlib.util.spec_from_file_location('nats_legacy_lock', HELPER)
lock_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lock_module)


class LegacyWriterLockTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=REPO)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lock = self.root / 'writer.lock'
        self.lock.write_bytes(b'')
        self.lock.chmod(0o644)
        self.marker = self.root / 'handoff.json'
        self.uid = os.getuid()
        self.gid = os.getgid()

    def run_locked(self, command):
        return lock_module.run_locked(command, self.lock, self.marker, self.uid, self.gid)

    def test_child_holds_shared_lock_and_inherited_descriptor(self):
        started = self.root / 'started'
        script = (
            'import importlib.util, os, pathlib, time; '
            f'pathlib.Path({str(started)!r}).write_text("yes"); '
            f'spec = importlib.util.spec_from_file_location("helper", {str(HELPER)!r}); '
            'module = importlib.util.module_from_spec(spec); '
            'spec.loader.exec_module(module); '
            f'module.verify_inherited(os.environ["OPENCLAW_NATS_LEGACY_LOCK_HELD"], pathlib.Path({str(self.lock)!r})); '
            'time.sleep(0.35)'
        )
        result = []
        thread = threading.Thread(target=lambda: result.append(self.run_locked([sys.executable, '-c', script])))
        thread.start()
        try:
            deadline = time.monotonic() + 3
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(started.exists())
            contender = os.open(self.lock, os.O_RDONLY)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(contender)
        finally:
            thread.join(timeout=3)
        self.assertEqual(result, [0])
        contender = os.open(self.lock, os.O_RDONLY)
        try:
            fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(contender)

    def test_marker_blocks_execution_and_invalid_lock_refuses(self):
        output = self.root / 'effect'
        command = [sys.executable, '-c', f'open({str(output)!r}, "w").write("mutated")']
        self.marker.write_text('{broken')
        with self.assertRaisesRegex(RuntimeError, 'handoff active'):
            self.run_locked(command)
        self.assertFalse(output.exists())

        self.marker.unlink()
        self.lock.chmod(0o666)
        with self.assertRaisesRegex(RuntimeError, 'identity is invalid'):
            self.run_locked(command)
        self.assertFalse(output.exists())

        self.lock.unlink()
        self.lock.symlink_to(self.root / 'missing')
        with self.assertRaises(OSError):
            self.run_locked(command)
        self.assertFalse(output.exists())

    def test_exclusive_owner_makes_legacy_operation_timeout(self):
        owner = os.open(self.lock, os.O_RDONLY)
        try:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, 'migration holds'):
                lock_module.acquire(self.lock, self.uid, self.gid, seconds=0.1)
        finally:
            os.close(owner)

    def test_unlocked_descriptor_cannot_claim_lock_during_exclusive_hold(self):
        contender = os.open(self.lock, os.O_RDONLY)
        owner = os.open(self.lock, os.O_RDONLY)
        try:
            info = os.fstat(contender)
            token = f'{contender}:{info.st_dev}:{info.st_ino}'
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, 'not held'):
                lock_module.verify_inherited(token, self.lock)
        finally:
            os.close(contender)
            os.close(owner)


if __name__ == '__main__':
    unittest.main()
