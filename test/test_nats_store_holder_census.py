import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import nats_store_holder_census as census
from nats_root_lock import Refused


class HolderCensusTest(unittest.TestCase):
    def test_any_named_process_and_unlinked_path_are_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            roots = []
            for suffix in census.SUFFIXES:
                root = home / '.openclaw' / 'nats' / ('jetstream' + suffix)
                root.mkdir(parents=True)
                roots.append(root)
            linked = roots[0] / 'block'
            linked.write_bytes(b'message')
            linked_info = linked.stat()
            def process(pid):
                if pid == 10:
                    return {'uid': 501, 'start_sec': 100,
                            'start_usec': 200, 'cwd': None, 'mappings': [], 'vnodes': [
                        {'fd': 3, 'device': linked_info.st_dev,
                         'inode': linked_info.st_ino, 'links': 1, 'path': str(linked)},
                        {'fd': 4, 'device': linked_info.st_dev,
                         'inode': linked_info.st_ino + 1000000, 'links': 0,
                         'path': str((roots[1] / 'deleted').resolve())},
                        {'fd': 5, 'device': linked_info.st_dev,
                         'inode': linked_info.st_ino + 2000000, 'links': 0,
                         'path': ''},
                        {'fd': 6, 'device': linked_info.st_dev,
                         'inode': linked_info.st_ino + 3000000, 'links': 1,
                         'path': str((roots[2] / 'unwalked').resolve())}]}
                raise Refused('process inaccessible')
            with patch.object(census.proc, 'list_pids', side_effect=[[10, 11], [10, 11, 12]]), \
                    patch.object(census.proc, 'vnode_snapshot', side_effect=process):
                report = census._observe(home)
            self.assertEqual(report['stores']['ai.openclaw.nats']['holders'][0]['pid'], 10)
            self.assertEqual(report['stores']['ai.openclaw.nats-1']['holders'][0]['match'],
                             'path')
            self.assertTrue(report['stores']['ai.openclaw.nats-1']['holders'][0]['unlinked'])
            self.assertEqual(report['unattributed_unlinked_vnodes_on_store_devices'], 1)
            self.assertEqual(report['stores']['ai.openclaw.nats-2']['holders'], [])
            self.assertEqual(report['unreadable_pids'], [11])
            self.assertFalse(report['coverage']['pid_list_stable'])
            self.assertIsNone(report['coverage']['process_name_filter'])
            self.assertFalse(report['coverage']['physical_absence_certified'])
            self.assertNotIn('deleted', str(report))

    def test_sibling_path_is_not_a_store_holder(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'jetstream'
            root.mkdir()
            self.assertFalse(census._under(str(root) + '-other/block', str(root)))

    def test_replaced_symlink_cannot_reclassify_retained_deleted_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'jetstream'
            root.mkdir()
            former = Path(temporary) / 'former'
            former.symlink_to(root, target_is_directory=True)
            self.assertFalse(census._under(str(former / 'deleted'), str(root)))

    def test_retries_snapshot_and_distinguishes_exited_pid(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            for suffix in census.SUFFIXES:
                (home / '.openclaw' / 'nats' / ('jetstream' + suffix)).mkdir(parents=True)
            calls = {10: 0, 11: 0, 12: 0}
            def snapshot(pid):
                calls[pid] += 1
                if pid == 10 and calls[pid] == 2:
                    return {'uid': 501, 'start_sec': 100,
                            'start_usec': 200, 'cwd': None, 'mappings': [], 'vnodes': []}
                raise Refused('process changed')
            with patch.object(census.proc, 'list_pids', side_effect=[[10, 11, 12], [10, 12]]), \
                    patch.object(census.proc, 'vnode_snapshot', side_effect=snapshot):
                report = census._observe(home)
            self.assertEqual(report['retry_recovered_pids'], [10])
            self.assertEqual(report['exited_pids'], [11])
            self.assertEqual(report['unreadable_pids'], [12])
            self.assertEqual(calls, {10: 2, 11: 2, 12: 2})
            self.assertIn('open vnode file descriptors, mapped files and working directory',
                          report['coverage']['reference_types'])

    def test_working_directory_inside_store_is_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            for suffix in census.SUFFIXES:
                (home / '.openclaw' / 'nats' / ('jetstream' + suffix)).mkdir(parents=True)
            cwd = home / '.openclaw' / 'nats' / 'jetstream' / 'stream'
            cwd.mkdir()
            info = cwd.stat()
            process = {'pid': 10, 'uid': 501, 'start_sec': 100,
                       'start_usec': 200, 'vnodes': [], 'mappings': [],
                       'cwd': {'device': info.st_dev, 'inode': info.st_ino,
                               'links': info.st_nlink, 'path': str(cwd)}}
            with patch.object(census.proc, 'list_pids', return_value=[10]), \
                    patch.object(census.proc, 'vnode_snapshot', return_value=process):
                report = census._observe(home)
            holders = report['stores']['ai.openclaw.nats']['holders']
            self.assertEqual(len(holders), 1)
            self.assertEqual(holders[0]['reference'], 'cwd')
            self.assertIsNone(holders[0]['fd'])
            self.assertEqual((holders[0]['start_sec'], holders[0]['start_usec']),
                             (100, 200))

    def test_closed_fd_mapping_inside_store_is_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            for suffix in census.SUFFIXES:
                (home / '.openclaw' / 'nats' / ('jetstream' + suffix)).mkdir(parents=True)
            mapped = home / '.openclaw' / 'nats' / 'jetstream' / 'block'
            mapped.write_bytes(b'owned')
            info = mapped.stat()
            process = {'pid': 10, 'uid': 501, 'start_sec': 100,
                       'start_usec': 200, 'vnodes': [], 'cwd': None,
                       'mappings': [{'device': info.st_dev, 'inode': info.st_ino,
                                     'links': info.st_nlink, 'path': str(mapped)}]}
            with patch.object(census.proc, 'list_pids', return_value=[10]), \
                    patch.object(census.proc, 'vnode_snapshot', return_value=process):
                report = census._observe(home)
            holders = report['stores']['ai.openclaw.nats']['holders']
            self.assertEqual(len(holders), 1)
            self.assertEqual(holders[0]['reference'], 'mmap')
            self.assertIsNone(holders[0]['fd'])

    def test_linked_file_created_after_store_walk_needs_fresh_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            for suffix in census.SUFFIXES:
                (home / '.openclaw' / 'nats' / ('jetstream' + suffix)).mkdir(parents=True)
            late = home / '.openclaw' / 'nats' / 'jetstream' / 'late'
            calls = 0
            def pids():
                nonlocal calls
                calls += 1
                if calls == 1:
                    late.write_bytes(b'new')
                return [10]
            def snapshot(_):
                info = late.stat()
                return {'uid': 501, 'start_sec': 100, 'start_usec': 200,
                        'cwd': None, 'mappings': [], 'vnodes': [{'fd': 3, 'device': info.st_dev,
                         'inode': info.st_ino, 'links': 1,
                         'path': str(late.resolve())}]}
            with patch.object(census.proc, 'list_pids', side_effect=pids), \
                    patch.object(census.proc, 'vnode_snapshot', side_effect=snapshot):
                report = census._observe(home)
            self.assertEqual(report['stores']['ai.openclaw.nats']['holders'][0]['match'],
                             'path')
            self.assertEqual(len(report['stores']['ai.openclaw.nats']['holders']), 1)

    def test_intermediate_symlink_added_after_walk_cannot_attribute_linked_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            for suffix in census.SUFFIXES:
                (home / '.openclaw' / 'nats' / ('jetstream' + suffix)).mkdir(parents=True)
            root = home / '.openclaw' / 'nats' / 'jetstream'
            outside = home / 'outside'
            outside.mkdir()
            file = outside / 'held'
            file.write_bytes(b'foreign')
            info = file.stat()
            calls = 0
            def pids():
                nonlocal calls
                calls += 1
                if calls == 1:
                    (root / 'bridge').symlink_to(outside, target_is_directory=True)
                return [10]
            def snapshot(_):
                return {'uid': 501, 'start_sec': 100, 'start_usec': 200,
                        'cwd': None, 'mappings': [], 'vnodes': [{'fd': 3, 'device': info.st_dev,
                         'inode': info.st_ino, 'links': 1,
                         'path': str(root.resolve() / 'bridge' / 'held')}]}
            with patch.object(census.proc, 'list_pids', side_effect=pids), \
                    patch.object(census.proc, 'vnode_snapshot', side_effect=snapshot):
                report = census._observe(home)
            self.assertEqual(report['stores']['ai.openclaw.nats']['holders'], [])

    def test_missing_store_refuses(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(Refused):
                census.observe(temporary)


if __name__ == '__main__':
    unittest.main()
