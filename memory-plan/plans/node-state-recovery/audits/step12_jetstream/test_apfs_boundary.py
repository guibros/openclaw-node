import array
import errno
import os
import pathlib
import plistlib
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('RECOVERY_APFS_TEST') == '1',
                     'owned APFS mount experiment is opt-in on macOS')
class OwnedAPFSBoundary(unittest.TestCase):
    def test_nonforced_unmount_rejects_writable_mapping_then_readonly_mount_blocks_writes(self):
        root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-owned-apfs-'))
        image = root / 'owned.sparseimage'
        mountpoint = root / 'mount'
        mountpoint.mkdir(mode=0o700)
        device = None
        holder = None
        try:
            subprocess.run(['/usr/bin/hdiutil', 'create', '-size', '256m', '-fs', 'APFS',
                            '-volname', 'OCRecoveryTest', '-type', 'SPARSE', '-mode', '0600',
                            str(image)], check=True, capture_output=True, text=True, timeout=30)
            attached = subprocess.run(['/usr/bin/hdiutil', 'attach', '-nobrowse', '-noautoopen',
                                       '-mountpoint', str(mountpoint), str(image)], check=True,
                                      capture_output=True, text=True, timeout=30)
            device = attached.stdout.splitlines()[0].split()[0]
            def volume_info():
                report = subprocess.run(['/usr/sbin/diskutil', 'info', '-plist', str(mountpoint)],
                                        check=True, capture_output=True, timeout=10)
                return plistlib.loads(report.stdout)
            first = volume_info()
            member = first['DeviceIdentifier']
            volume_uuid = first['VolumeUUID']
            store = mountpoint / 'store.bin'
            store.write_bytes(b'0' * 4096)
            child = '''import ctypes, os, sys, time
fd=os.open(sys.argv[1], os.O_RDWR)
lib=ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
lib.mmap.restype=ctypes.c_void_p
lib.mmap.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_longlong]
address=lib.mmap(None,4096,3,1,fd,0)
if address==ctypes.c_void_p(-1).value: raise OSError(ctypes.get_errno())
os.close(fd)
print('ready', flush=True)
time.sleep(60)
lib.munmap(ctypes.c_void_p(address),4096)
'''
            holder = subprocess.Popen([sys.executable, '-u', '-c', child, str(store)],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(holder.stdout.readline().strip(), 'ready')
            busy = subprocess.run(['/usr/bin/hdiutil', 'unmount', str(mountpoint)],
                                  capture_output=True, text=True, timeout=10)
            self.assertNotEqual(busy.returncode, 0)
            self.assertIn('Resource busy', busy.stderr)
            self.assertEqual(volume_info()['VolumeUUID'], volume_uuid)
            holder.terminate()
            holder.communicate(timeout=10)
            holder = None
            sender, receiver = socket.socketpair()
            try:
                fd = os.open(store, os.O_RDWR)
                try:
                    sender.sendmsg([b'x'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                             array.array('i', [fd]))])
                finally:
                    os.close(fd)
                busy = subprocess.run(['/usr/bin/hdiutil', 'unmount', str(mountpoint)],
                                      capture_output=True, text=True, timeout=10)
                self.assertNotEqual(busy.returncode, 0)
                self.assertIn('Resource busy', busy.stderr)
            finally:
                sender.close()
                receiver.close()
            subprocess.run(['/usr/bin/hdiutil', 'unmount', str(mountpoint)], check=True,
                           capture_output=True, text=True, timeout=10)
            subprocess.run(['/usr/sbin/diskutil', 'mount', 'readOnly', 'nobrowse',
                            '-mountPoint', str(mountpoint), member], check=True,
                           capture_output=True, text=True, timeout=10)
            readonly = volume_info()
            self.assertEqual(readonly['VolumeUUID'], volume_uuid)
            self.assertFalse(readonly['WritableVolume'])
            with self.assertRaises(OSError) as denied:
                os.open(store, os.O_RDWR)
            self.assertEqual(denied.exception.errno, errno.EROFS)
            subprocess.run(['/usr/bin/hdiutil', 'unmount', str(mountpoint)], check=True,
                           capture_output=True, text=True, timeout=10)
            mountpoint.chmod(0o555)
            with self.assertRaises(OSError) as denied:
                (mountpoint / 'jetstream').mkdir()
            self.assertEqual(denied.exception.errno, errno.EACCES)
            subprocess.run(['/usr/sbin/diskutil', 'mount', 'nobrowse', '-mountPoint',
                            str(mountpoint), member], check=True,
                           capture_output=True, text=True, timeout=10)
            self.assertEqual(volume_info()['VolumeUUID'], volume_uuid)
            self.assertEqual(store.read_bytes(), b'0' * 4096)
        finally:
            if holder is not None:
                if holder.poll() is None:
                    holder.terminate()
                holder.communicate(timeout=10)
            if device is not None:
                subprocess.run(['/usr/bin/hdiutil', 'detach', device], check=True,
                               capture_output=True, text=True, timeout=15)
            shutil.rmtree(root)


if __name__ == '__main__':
    unittest.main()
