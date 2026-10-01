import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

from apfs_mount import MNT_IGNORE_OWNERSHIP, apfs_mount_flags
from cold_copy import capture_tree, copy_candidate


@unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('RECOVERY_APFS_TEST') == '1',
                     'owned APFS cluster experiment is opt-in on macOS')
class OwnedVolumeCluster(unittest.TestCase):
    def test_clean_cluster_stop_unmount_readonly_copy_and_restore_equivalence(self):
        root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-owned-cluster-volume-'))
        image = root / 'owned.sparseimage'
        mountpoint = root / 'mount'
        mountpoint.mkdir(mode=0o700)
        device = None
        try:
            subprocess.run(['/usr/bin/hdiutil', 'create', '-size', '512m', '-fs', 'APFS',
                            '-volname', 'OCClusterTest', '-type', 'SPARSE', str(image)],
                           check=True, capture_output=True, timeout=30)
            attached = subprocess.run(['/usr/bin/hdiutil', 'attach', '-nobrowse', '-noautoopen',
                                       '-owners', 'on', '-mountpoint', str(mountpoint), str(image)],
                                      check=True, capture_output=True, text=True, timeout=30)
            device = attached.stdout.splitlines()[0].split()[0]
            def volume_info():
                report = subprocess.run(['/usr/sbin/diskutil', 'info', '-plist', str(mountpoint)],
                                        check=True, capture_output=True, timeout=10)
                return plistlib.loads(report.stdout)
            first = volume_info()
            self.assertTrue(first['GlobalPermissionsEnabled'])
            self.assertFalse(apfs_mount_flags(mountpoint) & MNT_IGNORE_OWNERSHIP)
            member = first['DeviceIdentifier']
            volume_uuid = first['VolumeUUID']
            env = {**os.environ, 'RECOVERY_EVIDENCE_DIR': str(mountpoint),
                   'RECOVERY_NATS_MODULE': os.environ.get('RECOVERY_NATS_MODULE',
                       '/Users/moltymac/openclaw-nodedev/node_modules/nats')}
            result = subprocess.run([sys.executable, '-m', 'unittest', '-q',
                                     'test_preservation_cluster.Cluster.test_stream_and_consumer_groups_and_real_stream_election'], env=env,
                                    cwd=pathlib.Path(__file__).parent, capture_output=True,
                                    text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            cluster = pathlib.Path(json.loads(result.stdout.splitlines()[-1])['root'])
            restored = json.loads((cluster / 'candidate-restore.json').read_text())
            self.assertEqual(restored['owned_server_cleanup'], 'normal')
            subprocess.run(['/usr/bin/hdiutil', 'unmount', str(mountpoint)], check=True,
                           capture_output=True, text=True, timeout=10)
            subprocess.run(['/usr/sbin/diskutil', 'mount', 'readOnly', 'nobrowse',
                            '-mountOptions', 'owners', '-mountPoint', str(mountpoint), member],
                           check=True, capture_output=True, text=True, timeout=10)
            readonly = volume_info()
            self.assertEqual(readonly['VolumeUUID'], volume_uuid)
            self.assertTrue(readonly['GlobalPermissionsEnabled'])
            self.assertFalse(apfs_mount_flags(mountpoint) & MNT_IGNORE_OWNERSHIP)
            self.assertFalse(readonly['WritableVolume'])
            roots = {str(i): cluster / f'store-{i}' for i in range(3)}
            candidate = copy_candidate(roots, root / 'readonly-candidate')
            self.assertEqual(candidate['status'], 'candidate')
            self.assertEqual(candidate['manifest_sha256'], restored['manifest_sha256'])
            def hashes(path):
                return {name: item['sha256'] for name, item in capture_tree(path).items()
                        if item['type'] == 'file'}
            for index in range(3):
                original = hashes(roots[str(index)])
                self.assertEqual(original, hashes(root / 'readonly-candidate' / str(index)))
            subprocess.run(['/usr/bin/hdiutil', 'unmount', str(mountpoint)], check=True,
                           capture_output=True, text=True, timeout=10)
            subprocess.run(['/usr/sbin/diskutil', 'mount', 'nobrowse', '-mountOptions', 'owners',
                            '-mountPoint', str(mountpoint), member], check=True,
                           capture_output=True, text=True, timeout=10)
            self.assertEqual(volume_info()['VolumeUUID'], volume_uuid)
            self.assertTrue(volume_info()['GlobalPermissionsEnabled'])
            self.assertFalse(apfs_mount_flags(mountpoint) & MNT_IGNORE_OWNERSHIP)
        finally:
            if device is not None:
                subprocess.run(['/usr/bin/hdiutil', 'detach', device], check=True,
                               capture_output=True, text=True, timeout=15)
            shutil.rmtree(root)


if __name__ == '__main__':
    unittest.main()
