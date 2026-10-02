import os
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import nats_live_census as census
from nats_root_lock import Refused


class LiveCensusTest(unittest.TestCase):
    def test_launchd_parser_uses_top_level_state_and_pid(self):
        output = ('gui/501/ai.openclaw.nats = {\n'
                  '\tpath = /tmp/ai.openclaw.nats.plist\n'
                  '\tstate = running\n'
                  '\tprogram = /tmp/nats-server\n'
                  '\tpid = 123\n'
                  '\tnested = {\n\t\tstate = waiting\n\t\tpid = 456\n\t}\n}\n')
        with patch.object(census, '_command', return_value=(0, output, '')):
            observed = census.launchd_service('gui/501', 'ai.openclaw.nats')
        self.assertEqual(observed, {'loaded': True, 'state': 'running',
                                    'pid': 123, 'plist': '/tmp/ai.openclaw.nats.plist',
                                    'program': '/tmp/nats-server'})

    def test_missing_service_is_distinct_from_failed_query(self):
        missing = 'Bad request.\nCould not find service "ai.openclaw.nats" in domain for system\n'
        with patch.object(census, '_command', return_value=(113, '', missing)):
            self.assertEqual(census.launchd_service('system', 'ai.openclaw.nats'),
                             {'loaded': False})
        with patch.object(census, '_command', return_value=(1, '', 'permission denied')):
            with self.assertRaisesRegex(Refused, 'unobservable'):
                census.launchd_service('system', 'ai.openclaw.nats')

    def test_disabled_override_is_explicit(self):
        output = ('disabled services = {\n'
                  '\t"ai.openclaw.nats-1" => disabled\n'
                  '\t"ai.openclaw.nats-2" => enabled\n}\n')
        with patch.object(census, '_command', return_value=(0, output, '')):
            observed = census.disabled_overrides('gui/501')
        self.assertIsNone(observed['ai.openclaw.nats'])
        self.assertTrue(observed['ai.openclaw.nats-1'])
        self.assertFalse(observed['ai.openclaw.nats-2'])

    def test_plist_identity_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'nats.plist'
            path.write_bytes(plistlib.dumps({'Label': 'ai.openclaw.nats',
                                             'ProgramArguments': ['/tmp/nats-server']}))
            observed = census.plist_identity(path)
            self.assertEqual(observed['label'], 'ai.openclaw.nats')
            self.assertEqual(observed['argv'], ['/tmp/nats-server'])
            self.assertEqual(observed['inode'], path.stat().st_ino)
            link = Path(temporary) / 'link.plist'
            link.symlink_to(path)
            with self.assertRaisesRegex(Refused, 'single-link'):
                census.plist_identity(link)

    def test_store_counts_and_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'jetstream'
            root.mkdir()
            nested = root / 'stream'
            nested.mkdir()
            stored = nested / 'block'
            stored.write_bytes(b'example')
            observed = census.store_identity(root)
            self.assertEqual((observed['files'], observed['bytes']), (1, 7))
            self.assertIn((os.stat(stored).st_dev, os.stat(stored).st_ino),
                          observed['inodes'])
            (root / 'escape').symlink_to(stored)
            with self.assertRaisesRegex(Refused, 'non-regular'):
                census.store_identity(root)


if __name__ == '__main__':
    unittest.main()
