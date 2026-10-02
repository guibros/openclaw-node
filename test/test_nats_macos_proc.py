import ctypes
import errno
import mmap
import os
from pathlib import Path
import stat
import struct
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import nats_macos_proc as proc
from nats_root_lock import Refused


@unittest.skipUnless(sys.platform == 'darwin', 'macOS process API')
class MacProcessTest(unittest.TestCase):
    def test_lists_self_with_stable_kernel_identity(self):
        self.assertIn(os.getpid(), proc.list_pids())
        observed = proc.snapshot(os.getpid())
        self.assertEqual(observed['pid'], os.getpid())
        self.assertEqual(observed['uid'], os.getuid())
        self.assertTrue(observed['executable'].startswith('/'))
        self.assertTrue(observed['arguments'])
        self.assertGreater(observed['start_sec'], 0)

    def test_vnode_descriptor_uses_inode_not_only_path(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'store-file'
            path.write_bytes(b'owned')
            with path.open('rb') as handle:
                observed = proc.vnode_descriptor(os.getpid(), handle.fileno())
                info = path.stat()
                self.assertEqual((observed['device'], observed['inode']),
                                 (info.st_dev, info.st_ino))
                self.assertTrue(stat.S_ISREG(observed['mode']))
                self.assertEqual(observed['path'], str(path.resolve()))
                self.assertIn((handle.fileno(), proc.PROX_FDTYPE_VNODE),
                              proc.file_descriptors(os.getpid(), proc.bsd_info(os.getpid())['nfiles']))

    def test_unlinked_open_file_remains_visible_by_inode(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'unlinked-store-file'
            path.write_bytes(b'owned')
            with path.open('rb') as handle:
                info = os.fstat(handle.fileno())
                original_path = proc.vnode_descriptor(os.getpid(), handle.fileno())['path']
                path.unlink()
                observed = proc.vnode_descriptor(os.getpid(), handle.fileno())
                self.assertEqual((observed['device'], observed['inode'], observed['links']),
                                 (info.st_dev, info.st_ino, 0))
                self.assertEqual(observed['path'], original_path)

    def test_vnode_snapshot_captures_open_file_without_arguments(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'held'
            path.write_bytes(b'owned')
            with path.open('rb') as handle:
                observed = proc.vnode_snapshot(os.getpid())
                self.assertEqual(observed['pid'], os.getpid())
                self.assertNotIn('arguments', observed)
                self.assertIn((handle.fileno(), path.stat().st_ino),
                              {(entry['fd'], entry['inode']) for entry in observed['vnodes']})

    def test_working_directory_uses_kernel_vnode_identity(self):
        with tempfile.TemporaryDirectory() as root:
            original = os.getcwd()
            try:
                os.chdir(root)
                observed = proc.working_directory(os.getpid())
                info = os.stat(root)
                self.assertEqual((observed['device'], observed['inode']),
                                 (info.st_dev, info.st_ino))
                self.assertEqual(observed['path'], str(Path(root).resolve()))
                self.assertEqual(proc.vnode_snapshot(os.getpid())['cwd'], observed)
            finally:
                os.chdir(original)

    def test_mapping_remains_visible_after_file_descriptor_closes(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'mapped-store-file'
            path.write_bytes(b'owned' * 1024)
            with path.open('rb') as handle:
                mapping = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)
            try:
                info = path.stat()
                observed = proc.mapped_vnodes(os.getpid())
                self.assertIn((info.st_dev, info.st_ino),
                              {(entry['device'], entry['inode']) for entry in observed})
                self.assertIn((info.st_dev, info.st_ino),
                              {(entry['device'], entry['inode']) for entry in
                               proc.vnode_snapshot(os.getpid())['mappings']})
            finally:
                mapping.close()

    def test_unlinked_mapping_keeps_kernel_inode(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'mapped-then-unlinked'
            path.write_bytes(b'owned' * 1024)
            with path.open('rb') as handle:
                mapping = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)
            info = path.stat()
            path.unlink()
            try:
                observed = [entry for entry in proc.mapped_vnodes(os.getpid())
                            if (entry['device'], entry['inode']) ==
                            (info.st_dev, info.st_ino)]
                self.assertEqual(len(observed), 1)
                self.assertEqual(observed[0]['links'], 0)
            finally:
                mapping.close()


class RegionContractTest(unittest.TestCase):
    def test_zeroed_working_directory_refuses(self):
        class Library:
            def proc_pidinfo(self, _pid, _flavor, _address, _buffer, _size):
                return proc.VNODE_PATHINFO_SIZE
        with self.assertRaisesRegex(Refused, 'identity is unobservable'):
            proc.working_directory(123, Library())

    def test_einval_marks_the_end_of_a_completed_scan(self):
        class Library:
            def proc_pidinfo(self, _pid, _flavor, address, buffer, _size):
                if address == 0:
                    struct.pack_into('<QQ', buffer, 80, 4096, 4096)
                    return proc.REGION_PATH_SIZE
                ctypes.set_errno(errno.EINVAL)
                return 0
        self.assertEqual(proc.mapped_vnodes(123, Library()), [])

    def test_midwalk_lookup_failure_is_not_a_complete_scan(self):
        class Library:
            def proc_pidinfo(self, _pid, _flavor, address, buffer, _size):
                if address == 0:
                    struct.pack_into('<QQ', buffer, 80, 4096, 4096)
                    return proc.REGION_PATH_SIZE
                ctypes.set_errno(errno.ESRCH)
                return 0
        with self.assertRaisesRegex(Refused, 'unobservable'):
            proc.mapped_vnodes(123, Library())

    def test_path_without_vnode_identity_refuses(self):
        class Library:
            def proc_pidinfo(self, _pid, _flavor, _address, buffer, _size):
                struct.pack_into('<QQ', buffer, 80, 4096, 4096)
                ctypes.memmove(ctypes.addressof(buffer) + proc.REGION_PATH_OFFSET,
                               b'/tmp/mapped\0', 12)
                return proc.REGION_PATH_SIZE
        with self.assertRaisesRegex(Refused, 'identity is unobservable'):
            proc.mapped_vnodes(123, Library())

if __name__ == '__main__':
    unittest.main()
