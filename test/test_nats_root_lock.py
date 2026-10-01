import fcntl
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('nats_root_lock', REPO / 'lib' / 'nats_root_lock.py')
root_lock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(root_lock)
spec = importlib.util.spec_from_file_location('nats_legacy_lock', REPO / 'bin' / 'nats-legacy-lock.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


class RootLockTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=REPO)
        self.addCleanup(self.temp.cleanup)
        self.lock = Path(self.temp.name) / 'writer.lock'
        self.uid = os.getuid()
        self.gid = os.getgid()

    def acquire(self, seconds=0.1):
        return root_lock._acquire(self.lock, self.uid, self.gid, seconds)

    def test_create_pin_and_reopen_exclusive_lock(self):
        with self.acquire() as owner:
            self.assertTrue(owner.created)
            self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode), 0o644)
            self.assertEqual(self.lock.stat().st_uid, self.uid)
            owner.validate(self.uid, self.gid)
            with self.assertRaisesRegex(RuntimeError, 'legacy NATS writer still holds'):
                self.acquire()
        with self.acquire() as reopened:
            self.assertFalse(reopened.created)
            reopened.validate(self.uid, self.gid)

    def test_legacy_shared_holder_blocks_root_exclusive(self):
        with self.acquire():
            pass
        holder = legacy.acquire(self.lock, self.uid, self.gid, seconds=0.1)
        try:
            with self.assertRaisesRegex(RuntimeError, 'legacy NATS writer still holds'):
                self.acquire()
        finally:
            os.close(holder)
        with self.acquire() as owner:
            owner.validate(self.uid, self.gid)

    def test_wrong_mode_hardlink_and_replacement_refuse(self):
        self.lock.write_bytes(b'')
        self.lock.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'identity differs'):
            self.acquire()
        self.lock.chmod(0o644)
        sibling = self.lock.with_name('linked')
        os.link(self.lock, sibling)
        with self.assertRaisesRegex(RuntimeError, 'identity differs'):
            self.acquire()
        sibling.unlink()
        with self.acquire() as owner:
            self.lock.unlink()
            self.lock.write_bytes(b'')
            self.lock.chmod(0o644)
            with self.assertRaises(root_lock.Refused):
                owner.validate(self.uid, self.gid)

    def test_root_entrypoint_refuses_unprivileged_caller(self):
        if os.geteuid() != 0:
            with self.assertRaisesRegex(RuntimeError, 'requires macOS root'):
                root_lock.acquire_root_writer_lock()

    def test_world_writable_ancestor_refuses(self):
        parent = self.lock.parent
        parent.chmod(0o777)
        with self.assertRaisesRegex(RuntimeError, 'ancestor is not protected'):
            self.acquire()

    def test_symlink_refuses(self):
        target = self.lock.with_name('target')
        target.write_bytes(b'')
        self.lock.symlink_to(target)
        with self.assertRaises(OSError):
            self.acquire()


if __name__ == '__main__':
    unittest.main()
