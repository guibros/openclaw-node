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
        store = {'path': '/tmp/jetstream', 'device': 1, 'inode': 2,
                 'files': 0, 'bytes': 0, 'inodes': {(1, 2)}}
        def overrides(domain):
            result = {label: None for label in census.LEGACY_LABELS}
            if domain == 'system':
                result['ai.openclaw.nats-1'] = True
            return result
        with patch.object(census, 'disabled_overrides', side_effect=overrides), \
                patch.object(census, 'launchd_service', side_effect=lambda *_: {'loaded': False}), \
                patch.object(census, 'nats_processes', return_value=([], 1)), \
                patch.object(census, 'tcp_listener_census', return_value={
                    str(port): None for port in census.LISTENER_PORTS}), \
                patch.object(census, 'tcp_socket_census', return_value={
                    str(port): False for port in census.LISTENER_PORTS}), \
                patch.object(census, 'store_identity', return_value=store), \
                patch.object(census, 'installed_config_census', return_value={}) as configs:
            report = census._observe(501, '/tmp')
            configs.side_effect = [{'config': 'before'}, {'config': 'after'}]
            with self.assertRaisesRegex(Refused, 'changed during census'):
                census._observe(501, '/tmp')
        self.assertFalse(report['coverage']['physical_absence_certified'])
        self.assertFalse(report['coverage']['single_instant'])
        self.assertEqual(report['coverage']['other_domains'], 'not checked')
        self.assertIn('on-disk', report['coverage']['configurations'])
        self.assertIn('embedded newlines', report['coverage']['waiting_job_arguments'])
        self.assertIn('no connected-client', report['coverage']['listener_ports'])
        self.assertEqual(report['unreadable_pids'], 1)
        self.assertTrue(report['system']['ai.openclaw.nats-1']['disabled'])
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
                    patch.object(census, 'tcp_listener_census', return_value={
                        str(port): None for port in census.LISTENER_PORTS}), \
                    patch.object(census, 'tcp_socket_census', return_value={
                        str(port): False for port in census.LISTENER_PORTS}), \
                    patch.object(census, 'store_identity', return_value=store), \
                    patch.object(census, 'installed_config_census', return_value={}):
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

    def test_installed_config_census_pins_all_four_without_exposing_contents(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            agents = home / 'Library' / 'LaunchAgents'
            configs = home / '.openclaw' / 'config'
            agents.mkdir(parents=True)
            configs.mkdir(parents=True)
            units = {label: {'loaded': False} for label in census.LEGACY_LABELS}
            for label in census.LEGACY_LABELS:
                suffix = label.removeprefix('ai.openclaw.nats')
                config = configs / ('nats' + suffix + '.conf')
                config.write_text('# —\nauthorization: secret-value\n')
                config.chmod(0o600)
                (agents / (label + '.plist')).write_bytes(plistlib.dumps({
                    'Label': label,
                    'ProgramArguments': ['/opt/homebrew/bin/nats-server',
                                         '--config', str(config)]}))
            result = census.installed_config_census(home, os.getuid(), b'key', units)
            self.assertEqual(set(result), set(census.LEGACY_LABELS))
            self.assertNotIn('secret-value', str(result))
            self.assertNotIn('arguments', str(result))
            target = configs / 'nats-1.conf'
            target.write_text('include other.conf\n')
            with self.assertRaisesRegex(Refused, 'include closure'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            target.write_text('port: $NATS_PORT\n')
            with self.assertRaisesRegex(Refused, 'environment substitution'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            target.write_text('İnclude other.conf\n')
            with self.assertRaisesRegex(Refused, 'non-ASCII syntax'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            target.write_text('server_name: #;İnclude other.conf\n')
            with self.assertRaisesRegex(Refused, 'non-ASCII syntax'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            target.write_text('authorization: secret-value\n')
            target.chmod(0o644)
            with self.assertRaisesRegex(Refused, 'identity differs'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            target.chmod(0o600)
            sibling = configs / 'same-inode.conf'
            os.link(target, sibling)
            with self.assertRaisesRegex(Refused, 'identity differs'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            sibling.unlink()
            target.write_bytes(b'x' * ((1 << 20) + 1))
            with self.assertRaisesRegex(Refused, 'identity differs'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            target.unlink()
            target.symlink_to(configs / 'nats.conf')
            with self.assertRaisesRegex(Refused, 'identity differs'):
                census.installed_config_census(home, os.getuid(), b'key', units)

    def test_loaded_job_must_use_the_installed_config_plist(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            agents = home / 'Library' / 'LaunchAgents'
            configs = home / '.openclaw' / 'config'
            agents.mkdir(parents=True)
            configs.mkdir(parents=True)
            units = {label: {'loaded': False} for label in census.LEGACY_LABELS}
            for label in census.LEGACY_LABELS:
                suffix = label.removeprefix('ai.openclaw.nats')
                config = configs / ('nats' + suffix + '.conf')
                config.write_text('port: 4222\n')
                config.chmod(0o600)
                (agents / (label + '.plist')).write_bytes(plistlib.dumps({
                    'Label': label,
                    'ProgramArguments': ['/opt/homebrew/bin/nats-server',
                                         '--config', str(config)]}))
            units['ai.openclaw.nats'] = {'loaded': True, 'plist': '/tmp/other.plist'}
            with self.assertRaisesRegex(Refused, 'differs from its installed plist'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            actual = agents / 'ai.openclaw.nats.plist'
            units['ai.openclaw.nats'] = {
                'loaded': True, 'plist': str(actual),
                'plist_identity': {'content_hmac_sha256': '0' * 64}}
            with self.assertRaisesRegex(Refused, 'changed during census'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            units['ai.openclaw.nats']['plist_identity'] = {
                'content_hmac_sha256': census.plist_identity(actual, b'key')['content_hmac_sha256']}
            self.assertEqual(len(census.installed_config_census(home, os.getuid(),
                                                                  b'key', units)), 4)
            units['ai.openclaw.nats'] = {'loaded': False}
            original = actual.read_bytes()
            changed = plistlib.loads(original)
            changed['ProgramArguments'][2] = '/tmp/other.conf'
            actual.write_bytes(plistlib.dumps(changed))
            with self.assertRaisesRegex(Refused, 'declared config'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            changed['ProgramArguments'][2] = str(configs / 'nats.conf')
            changed['Label'] = 'ai.openclaw.nats-1'
            actual.write_bytes(plistlib.dumps(changed))
            with self.assertRaisesRegex(Refused, 'declared config'):
                census.installed_config_census(home, os.getuid(), b'key', units)
            for label in census.LEGACY_LABELS:
                path = agents / (label + '.plist')
                installed = plistlib.loads(path.read_bytes())
                installed['Label'] = label
                installed['ProgramArguments'][0] = '/usr/local/bin/nats-server'
                path.write_bytes(plistlib.dumps(installed))
            self.assertEqual(len(census.installed_config_census(home, os.getuid(),
                                                                  b'key', units)), 4)

    def test_listener_census_binds_loopback_port_to_pid(self):
        def command(*args):
            port = int(args[2].split(':')[-1])
            return (0, f'p842\ncnats-server\nf8\nn127.0.0.1:{port}\n', '')
        with patch.object(census, '_command', side_effect=command):
            listeners = census.tcp_listener_census()
        self.assertEqual(set(listeners), {str(port) for port in census.LISTENER_PORTS})
        self.assertEqual(listeners['4222']['pid'], 842)

    def test_listener_census_refuses_wildcard_and_ambiguous_owner(self):
        with patch.object(census, '_command', return_value=(
                0, 'p842\ncnats-server\nf8\nn*:4222\n', '')):
            with self.assertRaisesRegex(Refused, 'loopback'):
                census.tcp_listener_census()
        with patch.object(census, '_command', return_value=(
                0, 'p842\ncnats-server\nf8\nn127.0.0.1:4222\n'
                   'p843\ncnats-server\nf8\nn127.0.0.1:4222\n', '')):
            with self.assertRaisesRegex(Refused, 'ambiguous'):
                census.tcp_listener_census()

    def test_listener_census_distinguishes_absent_from_unobservable(self):
        with patch.object(census, '_command', return_value=(1, '', '')):
            self.assertTrue(all(value is None for value in
                                census.tcp_listener_census().values()))
        with patch.object(census, '_command', return_value=(1, '', 'permission denied')):
            with self.assertRaisesRegex(Refused, 'unobservable'):
                census.tcp_listener_census()
        for code, output, reason in (
                (2, '', 'unobservable'),
                (1, 'p842\n', 'unobservable'),
                (0, '', 'ambiguous'),
                (0, 'pbad\ncnats-server\nf8\nn127.0.0.1:4222\n', 'invalid PID'),
                (0, 'p842\nf8\nn127.0.0.1:4222\n', 'incomplete'),
                (0, 'p842\ncextra-server\nf8\nn127.0.0.1:4222\n', 'expected loopback')):
            with self.subTest(code=code, output=output), \
                    patch.object(census, '_command', return_value=(code, output, '')):
                with self.assertRaisesRegex(Refused, reason):
                    census.tcp_listener_census()

    def test_listener_census_refuses_wrong_command_on_only_present_port(self):
        def command(*args):
            port = int(args[2].split(':')[-1])
            if port == 4222:
                return (0, 'p842\ncextra-server\nf8\nn127.0.0.1:4222\n', '')
            return (1, '', '')
        with patch.object(census, '_command', side_effect=command):
            with self.assertRaisesRegex(Refused, 'expected loopback NATS server'):
                census.tcp_listener_census()

    def test_system_socket_view_exposes_listener_hidden_from_lsof(self):
        output = ('Active Internet connections (including servers)\n'
                  'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)\n'
                  'tcp4 0 0 127.0.0.1.4222 *.* LISTEN\n')
        with patch.object(census, '_command', return_value=(0, output, '')):
            sockets = census.tcp_socket_census()
        listeners = {str(port): None for port in census.LISTENER_PORTS}
        self.assertTrue(sockets['4222'])
        with self.assertRaisesRegex(Refused, 'views differ'):
            census.verify_socket_visibility(listeners, sockets)
        listeners['4222'] = {'pid': 842}
        with self.assertRaisesRegex(Refused, 'views differ'):
            census.verify_socket_visibility(listeners, {port: False for port in sockets})
        with patch.object(census, '_command', return_value=(0,
                output + 'tcp6 0 0 ::1.4223 *.* LISTEN\n', '')):
            with self.assertRaisesRegex(Refused, 'loopback cohort'):
                census.tcp_socket_census()

    def test_system_socket_view_refuses_unobservable_output(self):
        with patch.object(census, '_command', return_value=(0, '', '')):
            with self.assertRaisesRegex(Refused, 'unobservable'):
                census.tcp_socket_census()
        with patch.object(census, '_command', return_value=(1, '', '')):
            with self.assertRaisesRegex(Refused, 'unobservable'):
                census.tcp_socket_census()
        with patch.object(census, '_command', return_value=(0,
                'Proto Recv-Q Send-Q  Local Address\n', 'permission denied')):
            with self.assertRaisesRegex(Refused, 'unobservable'):
                census.tcp_socket_census()
        header = ('Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)\n')
        with patch.object(census, '_command', return_value=(0,
                header + 'tcp4 0 0 malformed *.* LISTEN\n', '')):
            with self.assertRaisesRegex(Refused, 'address is unobservable'):
                census.tcp_socket_census()
        with patch.object(census, '_command', return_value=(0,
                header + 'tcp4 0 0 127.0.0.1.4222 *.* LISTEN\n'
                         'tcp4 0 0 127.0.0.1.4222 *.* LISTEN\n', '')):
            with self.assertRaisesRegex(Refused, 'loopback cohort'):
                census.tcp_socket_census()
        with patch.object(census, '_command', return_value=(0,
                header + 'tcp4 0 0 *.4222 *.* LISTEN\n', '')):
            with self.assertRaisesRegex(Refused, 'loopback cohort'):
                census.tcp_socket_census()
        with patch.object(census, '_command', return_value=(0,
                header + 'tcp4 0 0 127.0.0.1 LISTEN\n', '')):
            with self.assertRaisesRegex(Refused, 'incomplete'):
                census.tcp_socket_census()

    def test_observe_refuses_system_listener_hidden_from_lsof(self):
        empty = {'loaded': False}
        sockets = {str(port): False for port in census.LISTENER_PORTS}
        sockets['4222'] = True
        with patch.object(census, 'disabled_overrides', return_value={
                label: None for label in census.LEGACY_LABELS}), \
                patch.object(census, 'launchd_service', return_value=empty), \
                patch.object(census, 'nats_processes', return_value=([], 0)), \
                patch.object(census, 'tcp_listener_census', return_value={
                    str(port): None for port in census.LISTENER_PORTS}), \
                patch.object(census, 'tcp_socket_census', return_value=sockets), \
                patch.object(census, 'installed_config_census', return_value={}):
            with self.assertRaisesRegex(Refused, 'views differ'):
                census._observe(501, '/tmp')

    def test_listener_owner_must_match_loaded_service_and_process(self):
        listeners = {str(port): None for port in census.LISTENER_PORTS}
        listeners['4222'] = {'pid': 842}
        listeners['8222'] = {'pid': 842}
        units = {label: {'loaded': False} for label in census.LEGACY_LABELS}
        units['ai.openclaw.nats'] = {'loaded': True, 'state': 'running', 'pid': 842}
        system = {label: {'loaded': False} for label in census.LEGACY_LABELS}
        self.assertTrue(census.verify_listener_owners(units, system, [{'pid': 842}], listeners))
        listeners['8222'] = {'pid': 843}
        with self.assertRaisesRegex(Refused, 'no bound launchd NATS process'):
            census.verify_listener_owners(units, system, [{'pid': 842}], listeners)
        listeners['8222'] = {'pid': 842}
        with self.assertRaisesRegex(Refused, 'no bound launchd NATS process'):
            census.verify_listener_owners(units, system, [], listeners)
        units['ai.openclaw.nats']['loaded'] = False
        with self.assertRaisesRegex(Refused, 'no bound launchd NATS process'):
            census.verify_listener_owners(units, system, [{'pid': 842}], listeners)
        units['ai.openclaw.nats']['loaded'] = True
        with self.assertRaisesRegex(Refused, 'compete'):
            system['ai.openclaw.nats-1'] = {'loaded': True, 'state': 'running', 'pid': 843}
            census.verify_listener_owners(units, system, [{'pid': 842}, {'pid': 843}], listeners)

    def test_loaded_waiting_member_one_still_competes_for_standalone_ports(self):
        listeners = {str(port): None for port in census.LISTENER_PORTS}
        listeners['4222'] = {'pid': 842}
        listeners['8222'] = {'pid': 842}
        units = {label: {'loaded': False} for label in census.LEGACY_LABELS}
        units['ai.openclaw.nats'] = {'loaded': True, 'state': 'running', 'pid': 842}
        system = {label: {'loaded': False} for label in census.LEGACY_LABELS}
        system['ai.openclaw.nats-1'] = {'loaded': True, 'state': 'waiting', 'pid': None}
        with self.assertRaisesRegex(Refused, 'compete'):
            census.verify_listener_owners(units, system, [{'pid': 842}], listeners)

    def test_same_member_loaded_in_two_domains_competes(self):
        listeners = {str(port): None for port in census.LISTENER_PORTS}
        for port in (4223, 8223, 6223):
            listeners[str(port)] = {'pid': 855}
        units = {label: {'loaded': False} for label in census.LEGACY_LABELS}
        system = {label: {'loaded': False} for label in census.LEGACY_LABELS}
        units['ai.openclaw.nats-2'] = {'loaded': True, 'state': 'running', 'pid': 855}
        system['ai.openclaw.nats-2'] = {'loaded': True, 'state': 'waiting', 'pid': None}
        with self.assertRaisesRegex(Refused, 'compete'):
            census.verify_listener_owners(units, system, [{'pid': 855}], listeners)

    def test_running_member_cannot_own_another_service_listener(self):
        listeners = {str(port): None for port in census.LISTENER_PORTS}
        for port in (4223, 8223, 6223):
            listeners[str(port)] = {'pid': 855}
        units = {label: {'loaded': False} for label in census.LEGACY_LABELS}
        units['ai.openclaw.nats-2'] = {'loaded': True, 'state': 'running', 'pid': 855}
        system = {label: {'loaded': False} for label in census.LEGACY_LABELS}
        self.assertTrue(census.verify_listener_owners(units, system, [{'pid': 855}], listeners))
        listeners['4222'] = {'pid': 855}
        with self.assertRaisesRegex(Refused, 'no bound launchd NATS process'):
            census.verify_listener_owners(units, system, [{'pid': 855}], listeners)
        listeners['4222'] = None
        listeners['6223'] = None
        with self.assertRaisesRegex(Refused, 'does not own'):
            census.verify_listener_owners(units, system, [{'pid': 855}], listeners)

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

    def test_plist_replaced_with_fifo_after_lstat_refuses_without_waiting(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'nats.plist'
            path.write_bytes(plistlib.dumps({'Label': 'ai.openclaw.nats'}))
            saved = Path(temporary) / 'saved.plist'
            original_open = os.open
            def replace(target, flags, *args, **kwargs):
                self.assertTrue(flags & os.O_NOFOLLOW)
                self.assertTrue(flags & os.O_NONBLOCK)
                path.rename(saved)
                os.mkfifo(path)
                return original_open(target, flags, *args, **kwargs)
            with patch.object(census.os, 'open', side_effect=replace):
                with self.assertRaisesRegex(Refused, 'regular single-link'):
                    census.plist_identity(path, b'0' * 32)

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

    def test_store_replaced_with_symlink_after_lstat_refuses(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'jetstream'
            root.mkdir()
            outside = Path(temporary) / 'outside'
            outside.mkdir()
            (outside / 'block').write_bytes(b'foreign')
            saved = Path(temporary) / 'saved'
            original_open = os.open
            def replace(target, flags, *args, **kwargs):
                self.assertTrue(flags & os.O_NOFOLLOW)
                root.rename(saved)
                root.symlink_to(outside, target_is_directory=True)
                return original_open(target, flags, *args, **kwargs)
            with patch.object(census.os, 'open', side_effect=replace):
                with self.assertRaisesRegex(Refused, 'changed'):
                    census.store_identity(root)

    def test_nested_directory_replaced_with_symlink_refuses(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'jetstream'
            child = root / 'stream'
            child.mkdir(parents=True)
            outside = Path(temporary) / 'outside'
            outside.mkdir()
            (outside / 'block').write_bytes(b'foreign')
            original_open = os.open
            def replace(target, flags, *args, **kwargs):
                if target == 'stream':
                    self.assertTrue(flags & os.O_NOFOLLOW)
                    child.rmdir()
                    child.symlink_to(outside, target_is_directory=True)
                return original_open(target, flags, *args, **kwargs)
            with patch.object(census.os, 'open', side_effect=replace):
                with self.assertRaisesRegex(Refused, 'changed'):
                    census.store_identity(root)


if __name__ == '__main__':
    unittest.main()
