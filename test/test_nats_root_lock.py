import fcntl
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


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

    def create(self):
        return root_lock._create(self.lock, self.uid, self.gid)

    def test_root_creation_waits_for_lifecycle_recovery(self):
        with patch.object(root_lock.sys, 'platform', 'darwin'), patch.object(
                root_lock.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(root_lock.Refused, 'awaits lifecycle recovery'):
                self.create()
        self.assertFalse(self.lock.exists())

    def test_create_pin_and_reopen_exclusive_lock(self):
        with self.assertRaisesRegex(root_lock.Refused, 'absent or unobservable'):
            self.acquire()
        self.assertFalse(self.lock.exists())
        previous_umask = os.umask(0o077)
        try:
            self.create()
        finally:
            os.umask(previous_umask)
        info = self.lock.stat()
        self.assertEqual(self.create(), (info.st_dev, info.st_ino, info.st_ctime_ns))
        with self.acquire() as owner:
            self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode), 0o644)
            self.assertEqual(self.lock.stat().st_uid, self.uid)
            owner.validate()
            with self.assertRaisesRegex(RuntimeError, 'legacy NATS writer still holds'):
                self.acquire()
        with self.acquire() as reopened:
            reopened.validate()
        with self.assertRaisesRegex(root_lock.Refused, 'closed'):
            reopened.validate()

    def test_legacy_shared_holder_blocks_root_exclusive(self):
        self.create()
        holder = legacy.acquire(self.lock, self.uid, self.gid, seconds=0.1)
        try:
            with self.assertRaisesRegex(RuntimeError, 'legacy NATS writer still holds'):
                self.acquire()
        finally:
            os.close(holder)
        with self.acquire() as owner:
            owner.validate()

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
                owner.validate()

    def test_root_entrypoint_refuses_unprivileged_caller(self):
        if os.geteuid() != 0:
            with self.assertRaisesRegex(RuntimeError, 'requires macOS root'):
                root_lock.acquire_root_writer_lock()

    def test_create_rejects_wrong_identity_leftover(self):
        self.lock.write_bytes(b'')
        self.lock.chmod(0o600)
        with self.assertRaisesRegex(root_lock.Refused, 'identity differs'):
            self.create()
        self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode), 0o600)

    def test_existing_file_must_sync_before_create_succeeds(self):
        self.create()
        original = root_lock.sync_fd
        def failed_sync(_fd):
            raise OSError('injected sync failure')
        root_lock.sync_fd = failed_sync
        try:
            with self.assertRaisesRegex(root_lock.Refused, 'creation refused'):
                self.create()
        finally:
            root_lock.sync_fd = original

    def test_kill_after_atomic_create_reopens_same_file(self):
        script = '''import os, pathlib, sys
sys.path.insert(0, sys.argv[1])
import nats_root_lock
nats_root_lock.os.fchmod = lambda *_: os._exit(23)
nats_root_lock._create(pathlib.Path(sys.argv[2]), os.getuid(), os.getgid())
'''
        killed = subprocess.run([sys.executable, '-c', script, str(REPO / 'lib'), str(self.lock)],
                                capture_output=True, text=True)
        self.assertEqual(killed.returncode, 23, killed.stderr)
        self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode), 0o644)
        info = self.lock.stat()
        identity = (info.st_dev, info.st_ino, info.st_ctime_ns)
        self.assertEqual(self.create(), identity)
        with self.acquire() as owner:
            owner.validate()

    def test_world_writable_ancestor_refuses(self):
        parent = self.lock.parent
        parent.chmod(0o777)
        with self.assertRaisesRegex(RuntimeError, 'ancestor is not protected'):
            self.acquire()

    def test_symlink_refuses(self):
        target = self.lock.with_name('target')
        target.write_bytes(b'')
        self.lock.symlink_to(target)
        with self.assertRaises(root_lock.Refused):
            self.acquire()

    def test_fifo_refuses_without_blocking(self):
        os.mkfifo(self.lock)
        with self.assertRaises(root_lock.Refused):
            self.acquire()

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS ACL fixture')
    def test_granting_acl_refuses(self):
        self.create()
        subprocess.run(['/bin/chmod', '+a', 'everyone allow write', str(self.lock)], check=True)
        with self.assertRaisesRegex(root_lock.Refused, 'has an ACL'):
            self.acquire()

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS ACL fixture')
    def test_granting_ancestor_acl_refuses(self):
        subprocess.run(['/bin/chmod', '+a', 'everyone allow write', str(self.lock.parent)], check=True)
        with self.assertRaisesRegex(root_lock.Refused, 'has an ACL'):
            self.acquire()

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS ACL fixture')
    def test_deny_only_acl_does_not_refuse(self):
        self.create()
        subprocess.run(['/bin/chmod', '+a', 'everyone deny delete', str(self.lock)], check=True)
        try:
            with self.acquire() as owner:
                owner.validate()
        finally:
            subprocess.run(['/bin/chmod', '-N', str(self.lock)], check=True)


if __name__ == '__main__':
    unittest.main()
