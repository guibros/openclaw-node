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
                    return {'uid': 501, 'vnodes': [
                        {'fd': 3, 'device': linked_info.st_dev,
                         'inode': linked_info.st_ino, 'links': 1, 'path': str(linked)},
                        {'fd': 4, 'device': linked_info.st_dev,
                         'inode': linked_info.st_ino + 1000000, 'links': 0,
                         'path': str(roots[1] / 'deleted')},
                        {'fd': 5, 'device': linked_info.st_dev,
                         'inode': linked_info.st_ino + 2000000, 'links': 0,
                         'path': ''}]}
                raise Refused('process inaccessible')
            with patch.object(census.proc, 'list_pids', side_effect=[[10, 11], [10, 11, 12]]), \
                    patch.object(census.proc, 'vnode_snapshot', side_effect=process):
                report = census._observe(home)
            self.assertEqual(report['stores']['ai.openclaw.nats']['holders'][0]['pid'], 10)
            self.assertEqual(report['stores']['ai.openclaw.nats-1']['holders'][0]['match'],
                             'path')
            self.assertTrue(report['stores']['ai.openclaw.nats-1']['holders'][0]['unlinked'])
            self.assertEqual(report['unattributed_unlinked_vnodes_on_store_devices'], 1)
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

    def test_missing_store_refuses(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(Refused):
                census.observe(temporary)


if __name__ == '__main__':
    unittest.main()
