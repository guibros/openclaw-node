import hashlib
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
                  '\targuments = {\n\t\t/tmp/nats-server\n\t\t--config\n'
                  '\t\t/tmp/nats.conf\n\t}\n'
                  '\tpid = 123\n'
                  '\tnested = {\n\t\tstate = waiting\n\t\tpid = 456\n\t}\n}\n')
        with patch.object(census, '_command', return_value=(0, output, '')):
            observed = census.launchd_service('gui/501', 'ai.openclaw.nats')
        self.assertEqual(observed, {'loaded': True, 'state': 'running',
                                    'pid': 123, 'plist': '/tmp/ai.openclaw.nats.plist',
                                    'program': '/tmp/nats-server',
                                    'arguments': ['/tmp/nats-server', '--config',
                                                  '/tmp/nats.conf']})

    def test_missing_service_is_distinct_from_failed_query(self):
        missing = 'Bad request.\nCould not find service "ai.openclaw.nats" in domain for system\n'
        with patch.object(census, '_command', return_value=(113, '', missing)):
            self.assertEqual(census.launchd_service('system', 'ai.openclaw.nats'),
                             {'loaded': False})
        with patch.object(census, '_command', return_value=(1, '', 'permission denied')):
            with self.assertRaisesRegex(Refused, 'unobservable'):
                census.launchd_service('system', 'ai.openclaw.nats')

    def test_launchd_argument_with_line_separator_refuses(self):
        output = ('gui/501/ai.openclaw.nats = {\n'
                  '\tpath = /tmp/nats.plist\n\tstate = waiting\n'
                  '\tprogram = /tmp/nats-server\n'
                  '\targuments = {\n\t\t/tmp/nats-server\n'
                  '\t\t/tmp/name\fpart\n\t}\n}\n')
        with patch.object(census, '_command', return_value=(0, output, '')):
            with self.assertRaisesRegex(Refused, 'control characters'):
                census.launchd_service('gui/501', 'ai.openclaw.nats')

    def test_disabled_override_is_explicit(self):
        output = ('disabled services = {\n'
                  '\t"ai.openclaw.nats-1" => disabled\n'
                  '\t"ai.openclaw.nats-2" => enabled\n}\n')
        with patch.object(census, '_command', return_value=(0, output, '')):
            observed = census.disabled_overrides('gui/501')
        self.assertIsNone(observed['ai.openclaw.nats'])
        self.assertTrue(observed['ai.openclaw.nats-1'])
        self.assertFalse(observed['ai.openclaw.nats-2'])
        with patch.object(census, '_command', return_value=(0,
                'disabled services = {\n\t"ai.openclaw.nats-1" => true\n}\n', '')):
            self.assertTrue(census.disabled_overrides('gui/501')['ai.openclaw.nats-1'])
        with patch.object(census, '_command', return_value=(0,
                'disabled services = {\n\t"ai.openclaw.nats-1" => unknown\n}\n', '')):
            with self.assertRaisesRegex(Refused, 'unrecognized'):
                census.disabled_overrides('gui/501')

    def test_empty_scan_does_not_claim_physical_absence(self):
        empty = {'loaded': False}
        store = {'path': '/tmp/jetstream', 'device': 1, 'inode': 2,
                 'files': 0, 'bytes': 0, 'inodes': {(1, 2)}}
        with patch.object(census, 'disabled_overrides', return_value={
                label: None for label in census.LEGACY_LABELS}), \
                patch.object(census, 'launchd_service', return_value=empty), \
                patch.object(census, 'nats_processes', return_value=([], 1)), \
                patch.object(census, 'store_identity', return_value=store):
            report = census._observe(501, '/tmp')
        self.assertFalse(report['coverage']['physical_absence_certified'])
        self.assertFalse(report['coverage']['single_instant'])
        self.assertEqual(report['coverage']['other_domains'], 'not checked')
        self.assertEqual(report['unreadable_pids'], 1)
        self.assertEqual(report['stores']['ai.openclaw.nats']['nats_server_open_vnodes'], [])

    def test_loaded_arguments_must_match_plist_even_when_not_running(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            plist = home / 'nats.plist'
            plist.write_bytes(plistlib.dumps({'Label': 'ai.openclaw.nats',
                                              'ProgramArguments': ['/tmp/nats-server',
                                                                   '--config', '/tmp/right.conf']}))
            def service(domain, label):
                if domain == 'gui/501' and label == 'ai.openclaw.nats':
                    return {'loaded': True, 'state': 'waiting', 'pid': None,
                            'plist': str(plist), 'program': '/tmp/nats-server',
                            'arguments': ['/tmp/nats-server', '--config', '/tmp/wrong.conf']}
                return {'loaded': False}
            with patch.object(census, 'disabled_overrides', return_value={
                    label: None for label in census.LEGACY_LABELS}), \
                    patch.object(census, 'launchd_service', side_effect=service), \
                    patch.object(census, 'nats_processes', return_value=([], 0)):
                with self.assertRaisesRegex(Refused, 'arguments differ'):
                    census._observe(501, home)

    def test_loaded_arguments_are_not_exposed_in_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            plist = home / 'nats.plist'
            argv = ['/tmp/nats-server', '--config', '/tmp/private.conf']
            plist.write_bytes(plistlib.dumps({'Label': 'ai.openclaw.nats',
                                              'ProgramArguments': argv}))
            def service(domain, label):
                if domain == 'gui/501' and label == 'ai.openclaw.nats':
                    return {'loaded': True, 'state': 'waiting', 'pid': None,
                            'plist': str(plist), 'program': argv[0],
                            'arguments': argv.copy()}
                return {'loaded': False}
            store = {'path': '/tmp/jetstream', 'device': 1, 'inode': 2,
                     'files': 0, 'bytes': 0, 'inodes': {(1, 2)}}
            with patch.object(census, 'disabled_overrides', return_value={
                    label: None for label in census.LEGACY_LABELS}), \
                    patch.object(census, 'launchd_service', side_effect=service), \
                    patch.object(census, 'nats_processes', return_value=([], 0)), \
                    patch.object(census, 'store_identity', return_value=store):
                report = census._observe(501, home)
            unit = report['gui']['ai.openclaw.nats']
            self.assertNotIn('arguments', unit)
            self.assertNotIn('argv', unit['plist_identity'])
            self.assertNotIn('/tmp/private.conf', str(report))
            self.assertNotEqual(unit['plist_identity']['argv_hmac_sha256'],
                                hashlib.sha256('\0'.join(argv).encode()).hexdigest())
            self.assertNotIn('sha256', unit['plist_identity'])
            self.assertNotEqual(unit['plist_identity']['content_hmac_sha256'],
                                hashlib.sha256(plist.read_bytes()).hexdigest())

    def test_plist_identity_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'nats.plist'
            path.write_bytes(plistlib.dumps({'Label': 'ai.openclaw.nats',
                                             'ProgramArguments': ['/tmp/nats-server']}))
            observed = census.plist_identity(path, b'0' * 32)
            self.assertEqual(observed['label'], 'ai.openclaw.nats')
            self.assertEqual(observed['argv'], ['/tmp/nats-server'])
            self.assertEqual(observed['inode'], path.stat().st_ino)
            link = Path(temporary) / 'link.plist'
            link.symlink_to(path)
            with self.assertRaisesRegex(Refused, 'single-link'):
                census.plist_identity(link, b'0' * 32)

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
