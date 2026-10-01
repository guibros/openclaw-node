import copy
import hashlib
import http.server
import json
import os
import pathlib
import plistlib
import secrets
import select
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from preservation_checks import (
    QuietWindow, Refused, STOP_ORDER, capture, verify_admissions,
    disabled_entrypoint_artifacts, http_json, installed_entrypoints, loaded_entrypoints, verify_completion,
    inert_entrypoint_artifacts, verify_entrypoint_inventory, verify_queue, verify_streams, verify_timer_idle,
)


class Gates(unittest.TestCase):
    def refused(self, call):
        with self.assertRaises(Refused):
            call()

    def test_unclassified_installed_or_loaded_entrypoint_refuses(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-entrypoints-owned-') as root:
            agents = pathlib.Path(root)
            protected = agents / 'repo'
            protected.mkdir()
            def add(label, argv):
                path = agents / (label + '.plist')
                path.write_bytes(plistlib.dumps({'Label': label, 'ProgramArguments': argv}))
                return path
            add('ai.openclaw.gateway', ['/owned/node', str(protected / 'gateway.js')])
            add('ai.openclaw.workplan-viewer', ['/owned/node', str(protected / 'viewer.js')])
            extra = add('com.openclaw.redesign-tick', ['/bin/sh', str(protected / 'redesign-tick.sh')])
            installed = installed_entrypoints(agents, [protected])
            self.refused(lambda: verify_entrypoint_inventory(installed,
                {'ai.openclaw.gateway'}, set(), set(), {'gateway', 'workplan-viewer'}))
            extra.unlink()
            parked = agents / 'com.openclaw.redesign-tick.plist.disabled'
            parked.write_bytes(plistlib.dumps({'Label': 'com.openclaw.redesign-tick',
                'ProgramArguments': ['/bin/sh', str(protected / 'redesign-tick.sh')]}))
            self.assertEqual(len(disabled_entrypoint_artifacts([agents])), 1)
            installed = installed_entrypoints(agents, [protected])
            gui = loaded_entrypoints('services = {\n  1 - ai.openclaw.gateway\n}\n'
                'disabled services = {\n  "com.openclaw.redesign-tick" => disabled\n}\n',
                'gui/501', [protected], inspect=lambda _: 'program = /owned/node\n')
            self.assertTrue(verify_entrypoint_inventory(installed, gui, set(), set(),
                {'gateway', 'workplan-viewer'})['verified'])
            gateway_argv = plistlib.loads(pathlib.Path(installed['ai.openclaw.gateway']).read_bytes())['ProgramArguments']
            identity = {'gui': {'ai.openclaw.gateway': {
                'source': installed['ai.openclaw.gateway'], 'program': '/owned/node',
                'working_directory': '',
                'arguments_sha256': hashlib.sha256(json.dumps(gateway_argv, separators=(',', ':')).encode()).hexdigest(),
                'environment_sha256': {}}},
                        'user': {}, 'system': {}}
            self.assertTrue(verify_entrypoint_inventory(installed, gui, set(), set(),
                {'gateway', 'workplan-viewer'}, loaded_identity=identity)['verified'])
            identity['gui']['ai.openclaw.gateway']['source'] = '/tmp/other.plist'
            self.refused(lambda: verify_entrypoint_inventory(installed, gui, set(), set(),
                {'gateway', 'workplan-viewer'}, loaded_identity=identity))
            identity['gui']['ai.openclaw.gateway']['source'] = installed['ai.openclaw.gateway']
            identity['gui']['ai.openclaw.gateway']['program'] = '/tmp/other-node'
            self.refused(lambda: verify_entrypoint_inventory(installed, gui, set(), set(),
                {'gateway', 'workplan-viewer'}, loaded_identity=identity))
            self.refused(lambda: verify_entrypoint_inventory(installed,
                gui, set(), {'com.openclaw.agent'}, {'gateway', 'workplan-viewer'}))
            add('other.agent', ['/owned/node', str(protected / 'worker.js')])
            self.refused(lambda: verify_entrypoint_inventory(
                installed_entrypoints(agents, [protected]), gui, set(), set(),
                {'gateway', 'workplan-viewer'}))

    def test_neutral_loaded_job_and_nonliteral_installed_paths_refuse(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-entrypoints-owned-') as root:
            directory = pathlib.Path(root)
            protected = directory / 'repo'
            protected.mkdir()
            home = directory / 'home'
            home.mkdir()
            (home / 'repo').symlink_to(protected, target_is_directory=True)
            for label in ('ai.openclaw.gateway', 'ai.openclaw.workplan-viewer'):
                (directory / (label + '.plist')).write_bytes(plistlib.dumps({
                    'Label': label, 'ProgramArguments': ['/owned/node']}))
            expected = {'gateway', 'workplan-viewer'}
            installed = installed_entrypoints(directory, [protected])
            details = ('path = /tmp/local.viewer-tick.plist\n'
                       'program = /bin/sh\narguments = {\n'
                       '  /bin/sh\n  -c\n  exec "$HOME/repo/tick.sh"\n}\n')
            with patch('preservation_checks.pathlib.Path.home', return_value=home):
                loaded = loaded_entrypoints('services = {\n  1 - local.viewer-tick\n}\n',
                    'gui/501', [protected], inspect=lambda _: details)
            self.assertEqual(loaded, {'local.viewer-tick'})
            self.refused(lambda: verify_entrypoint_inventory(installed, loaded, set(), set(), expected))
            program = directory / 'local.program.plist'
            program.write_bytes(plistlib.dumps({'Label': 'local.program',
                'Program': str(protected / 'tick.sh'), 'ProgramArguments': ['/bin/sh']}))
            self.assertIn('local.program', installed_entrypoints(directory, [protected]))
            program.unlink()
            shell = directory / 'local.shell.plist'
            shell.write_bytes(plistlib.dumps({'Label': 'local.shell',
                'ProgramArguments': ['/bin/sh', '-c', 'exec "$HOME/repo/tick.sh"']}))
            with patch('preservation_checks.pathlib.Path.home', return_value=home):
                self.assertIn('local.shell', installed_entrypoints(directory, [protected]))
                for label, arguments in (
                    ('com.apple.viewer-tick', 'exec "~/repo/tick.sh"'),
                    ('local.indirect', 'exec "$SCRIPT"')):
                    with self.subTest(label=label):
                        detail = ('path = /tmp/' + label + '.plist\nprogram = /bin/sh\n'
                                  'arguments = {\n  /bin/sh\n  -c\n  ' + arguments + '\n}\n'
                                  'environment = {\n  ROOT => ' + str(home) + '\n'
                                  '  SCRIPT => ${ROOT}/repo/tick.sh\n}\n')
                        actual = loaded_entrypoints('services = {\n  1 - ' + label + '\n}\n',
                            'gui/501', [protected], inspect=lambda _: detail)
                        self.assertEqual(actual, {label})
                self.assertEqual(loaded_entrypoints('services = {\n  1 - com.apple.idle\n}\n',
                    'system', [protected], inspect=lambda _: 'path = /System/Library/idle.plist\n'
                        'program = /usr/libexec/idle\n'), {'com.apple.idle'})
                dynamic = directory / 'local.dynamic.plist'
                dynamic.write_bytes(plistlib.dumps({'Label': 'local.dynamic',
                    'ProgramArguments': ['/bin/sh', '-c', 'exec "$SCRIPT"']}))
                self.assertIn('local.dynamic', installed_entrypoints(directory, [protected]))
                script = protected / 'tick.sh'
                script.write_text('#!/bin/sh\n')
                hardlink = directory / 'tick-alias'
                os.link(script, hardlink)
                linked = directory / 'local.linked.plist'
                linked.write_bytes(plistlib.dumps({'Label': 'local.linked',
                    'Program': str(hardlink), 'ProgramArguments': [str(hardlink)]}))
                self.assertIn('local.linked', installed_entrypoints(directory, [protected]))
                for label, argv in (
                    ('local.wrapper', ['/usr/bin/caffeinate', '-i',
                                       'repo/tick.sh']),
                    ('local.versioned', ['/opt/homebrew/bin/python3.12',
                                         'repo/tick.sh']),
                    ('local.link-argument', ['/usr/bin/nice', '-n', '5', str(hardlink)])):
                    with self.subTest(label=label):
                        path = directory / (label + '.plist')
                        path.write_bytes(plistlib.dumps({'Label': label,
                            'WorkingDirectory': str(home), 'ProgramArguments': argv}))
                        self.assertIn(label, installed_entrypoints(directory, [protected]))
                        detail = ('path = ' + str(path) + '\nprogram = ' + argv[0]
                                  + '\nworking directory = ' + str(home)
                                  + '\narguments = {\n' + ''.join('  ' + part + '\n' for part in argv) + '}\n')
                        actual = loaded_entrypoints('services = {\n  1 - ' + label + '\n}\n',
                            'gui/501', [protected], inspect=lambda _: detail)
                        self.assertEqual(actual, {label})
                        path.unlink()

    def test_closed_world_launchd_provenance(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-entrypoints-owned-') as root:
            directory = pathlib.Path(root)
            for label, program in (
                    ('quiet.helper', '/usr/local/bin/taskpolicy'),
                    ('application.fake', '/tmp/Fake.app/Contents/MacOS/Fake'),
                    ('com.apple.claimed', '/usr/libexec/claimed')):
                (directory / (label + '.plist')).write_bytes(plistlib.dumps({
                    'Label': label, 'ProgramArguments': [program]}))
            inert = directory / 'old.keystone.plist'
            inert.write_bytes(plistlib.dumps({}))
            installed = installed_entrypoints(directory, [])
            self.assertEqual(set(installed), {'quiet.helper', 'application.fake', 'com.apple.claimed'})
            self.assertEqual(set(inert_entrypoint_artifacts([directory])), {str(inert.resolve())})
            details = {
                'quiet.helper': 'path = /Library/LaunchDaemons/quiet.helper.plist\nprogram = /usr/local/bin/taskpolicy\n',
                'application.fake': 'path = /tmp/application.fake.plist\nprogram = /tmp/Fake.app/Contents/MacOS/Fake\n',
                'com.apple.claimed': 'path = /Library/LaunchDaemons/com.apple.claimed.plist\nprogram = /usr/libexec/claimed\n',
                'com.apple.real': 'path = /System/Volumes/Preboot/Cryptexes/App/System/Library/LaunchAgents/com.apple.real.plist\nprogram = /System/Cryptexes/App/usr/libexec/real\n',
                'application.registered': 'path = (submitted by runningboardd.101)\nprogram = /Applications/Registered.app/Contents/MacOS/Registered\n',
                'com.apple.missing-path': 'program = /usr/libexec/real\n',
            }
            text = 'services = {\n' + ''.join(f'  1 - {label}\n' for label in details) + '}\n'
            loaded = loaded_entrypoints(text, 'gui/501', [], inspect=details.__getitem__)
            self.assertEqual(loaded, set(details))

    @unittest.skipUnless(sys.platform == 'darwin', 'requires Apple system volume')
    def test_actual_system_volume_provenance(self):
        from preservation_checks import apple_system_source
        self.assertTrue(apple_system_source(
            '/System/Library/LaunchDaemons/com.apple.configd.plist', '/usr/libexec/configd'))
        self.assertFalse(apple_system_source(
            '/System/Library/LaunchDaemons/../../../../tmp/configd.plist', '/usr/libexec/configd'))
        with tempfile.TemporaryDirectory(prefix='openclaw-system-alias-owned-') as root:
            alias = pathlib.Path(root) / 'com.apple.configd.plist'
            alias.symlink_to('/System/Library/LaunchDaemons/com.apple.configd.plist')
            self.assertFalse(apple_system_source(str(alias), '/usr/libexec/configd'))

    def test_unlabeled_nonempty_plist_refuses(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-entrypoints-owned-') as root:
            pathlib.Path(root, 'unknown.plist').write_bytes(plistlib.dumps({
                'ProgramArguments': ['/tmp/unknown']}))
            self.refused(lambda: installed_entrypoints(root, []))

    def test_loaded_inventory_refuses_unparsed_duplicate_or_mismatched_detail(self):
        detail = 'path = /tmp/local.plist\nprogram = /bin/echo\n'
        self.refused(lambda: loaded_entrypoints('services = {\n  1 - local job\n}\n',
            'gui/501', [], inspect=lambda _: detail))
        self.refused(lambda: loaded_entrypoints('services = {\n  1 - local.job\n  2 - local.job\n}\n',
            'gui/501', [], inspect=lambda _: detail))
        with patch('preservation_checks.subprocess.check_output',
                   return_value='gui/501/wrong.job = {\n' + detail):
            self.refused(lambda: loaded_entrypoints('services = {\n  1 - local.job\n}\n',
                'gui/501', []))

    def test_loaded_configuration_refuses_extra_environment_and_argument_whitespace(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-loaded-config-owned-') as root:
            path = pathlib.Path(root) / 'ai.openclaw.gateway.plist'
            arguments = ['/owned/node', '/owned/gateway.js']
            def check(declared, detail, refused=True):
                def verify():
                    path.write_bytes(plistlib.dumps({'Label': 'ai.openclaw.gateway',
                        'ProgramArguments': arguments, 'EnvironmentVariables': declared}))
                    installed = installed_entrypoints(root, [])
                    identities = loaded_entrypoints('services = {\n  1 - ai.openclaw.gateway\n}\n',
                        'gui/501', [], inspect=lambda _: 'path = ' + str(path.resolve()) + '\n'
                        'program = /owned/node\n' + detail, include_identity=True)
                    return verify_entrypoint_inventory(installed,
                        set(identities), set(), set(), {'gateway'},
                        loaded_identity={'gui': identities, 'user': {}, 'system': {}})
                if refused:
                    self.refused(verify)
                else:
                    self.assertTrue(verify()['verified'])
            ordinary = 'arguments = {\n  /owned/node\n  /owned/gateway.js\n}\n'
            check({}, ordinary, refused=False)
            check({}, ordinary + 'environment = {\n  NODE_OPTIONS => --require=/tmp/evil.js\n}\n')
            check({'NODE_OPTIONS': '--require=/tmp/evil.js'}, ordinary +
                  'environment = {\n  NODE_OPTIONS => --require=/tmp/evil.js\n}\n')
            check({}, ordinary + 'inherited environment = {\n'
                  '  NODE_OPTIONS => --require=/tmp/evil.js\n}\n')
            check({}, ordinary + 'environment = {\n  OSLogRateLimit => 64\n}\n'
                  '  NODE_OPTIONS => --require=/tmp/evil.js\n')
            check({}, 'arguments = {\n  /owned/node\n  /owned/gateway.js \n}\n')

    def test_timer_signal_race(self):
        verify_timer_idle({'loaded': True}, False, [20, 0], [20, 0])
        self.refused(lambda: verify_timer_idle({'loaded': True, 'pid': 123}, False, [20], [20]))
        self.refused(lambda: verify_timer_idle({'loaded': True}, True, [20], [20]))
        self.refused(lambda: verify_timer_idle({'loaded': True}, False, [20], [21]))

    def test_truncated_monitor_response_is_an_explicit_refusal(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/owned-non-http':
                    self.wfile.write(b'not-http\r\n\r\n')
                    self.close_connection = True
                    return
                self.send_response(200)
                self.send_header('Content-Length', '999')
                self.end_headers()
                self.wfile.write(b'{}')
                self.close_connection = True
            def log_message(self, *args):
                pass
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        self.assertNotIn(server.server_port, (8222, 8223, 8224))
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            self.refused(lambda: http_json(server.server_port, '/owned-truncated'))
            self.refused(lambda: http_json(server.server_port, '/owned-non-http'))
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)
            self.assertFalse(thread.is_alive())

    def test_new_memory_anchor_and_external_flush(self):
        idle = {'pid': 123, 'current_job': None, 'queue_depth': 0, 'external_jobs': []}
        verify_queue(idle, 123, 101, 100, 102)
        self.refused(lambda: verify_queue(idle, 999, 101, 100, 102))
        self.refused(lambda: verify_queue(idle, 123, 99, 100, 102))
        self.refused(lambda: verify_queue({**idle, 'external_jobs': ['flush']}, 123, 101, 100, 102))
        verify_completion('memory-daemon', 'Received SIGTERM\nDaemon stopped', [], [])
        self.refused(lambda: verify_completion('memory-daemon',
                                              'Entering idle: flush\nDaemon stopped', [], []))
        self.refused(lambda: verify_completion('memory-daemon',
                                              'tick still in flight — closing anyway\nDaemon stopped', [], []))
        for marker in ('Phase 2: live session import', 'Phase 2: session-store imported',
                       'pre-compression flush triggered', 'end-of-session flush [llm]',
                       'nats-triggered flush [llm]'):
            self.refused(lambda: verify_completion('memory-daemon', marker+'\nDaemon stopped', [], []))

    def test_completion_does_not_hide_descendants_or_crash(self):
        verify_completion('nats', 'Server Exiting', [], [])
        self.refused(lambda: verify_completion('nats', '', [], []))
        self.refused(lambda: verify_completion('nats', 'Server Exiting', [], [], killed=True))
        self.refused(lambda: verify_completion('mesh-task-daemon', 'Shutdown complete.', [99], []))
        self.refused(lambda: verify_completion('mission-control', '', [], [3000]))
        self.refused(lambda: verify_completion('mesh-agent',
                                              'permanently closed\nAgent worker stopped.', [], []))

    def test_never_ready_listener_has_default_signal_contract(self):
        args = {'startup_segment': 'Connecting to NATS... retrying',
                'termination': {'signal': 15}, 'bus_client_names': []}
        verify_completion('mesh-deploy-listener', '', [], [], **args)
        self.refused(lambda: verify_completion('mesh-deploy-listener', '', [123], [], **args))
        self.refused(lambda: verify_completion('mesh-deploy-listener', '', [], [],
                                              **{**args, 'termination': {'signal': 9}}))
        self.refused(lambda: verify_completion('mesh-deploy-listener', '', [], [],
                                              **{**args, 'bus_client_names': ['deploy-listener-owned']}))
        self.refused(lambda: verify_completion('mesh-deploy-listener', '', [], [],
                                              **{**args, 'startup_segment': '═══ Ready ═══'}))

    def test_expiry_uses_original_policy_instead_of_bucket_name(self):
        before = {'streams': {'$G/MESH_DEPLOY_RESULTS': {
            'config': {'max_age': 7*24*60*60*1_000_000_000}, 'consumers': {},
            'state': {'messages': 1, 'bytes': 10, 'first_seq': 5, 'last_seq': 5,
                      'num_subjects': 1, 'num_deleted': 0}}}}
        after = copy.deepcopy(before)
        after['streams']['$G/MESH_DEPLOY_RESULTS']['state'].update(
            messages=0, bytes=0, first_seq=6, num_subjects=0)
        verify_streams(before, after)
        written = copy.deepcopy(after)
        written['streams']['$G/MESH_DEPLOY_RESULTS']['state']['last_seq'] = 6
        self.refused(lambda: verify_streams(before, written))
        before['streams']['$G/MESH_DEPLOY_RESULTS']['config']['max_age'] = 0
        after['streams']['$G/MESH_DEPLOY_RESULTS']['config']['max_age'] = 0
        self.refused(lambda: verify_streams(before, after))

    def test_producers_stop_before_worker(self):
        for producer in ('health-watch', 'mesh-deploy-listener', 'node-watch'):
            self.assertLess(STOP_ORDER.index(producer), STOP_ORDER.index('mission-control'))
        self.assertLess(STOP_ORDER.index('scheduler-heartbeat'), STOP_ORDER.index('mission-control'))
        self.assertLess(STOP_ORDER.index('mission-control'), STOP_ORDER.index('mesh-bridge'))
        self.assertLess(STOP_ORDER.index('mesh-bridge'), STOP_ORDER.index('mesh-agent'))
        self.assertLess(STOP_ORDER.index('mesh-agent'), STOP_ORDER.index('mesh-task-daemon'))



class OwnedServers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.umask(0o077)
        cls.root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-preservation-owned-', dir=os.environ.get('RECOVERY_EVIDENCE_DIR')))
        cls.token = secrets.token_hex(24)
        cls.servers = []
        cls.node = os.environ.get('RECOVERY_NODE', '/usr/local/bin/node')
        cls.binary = os.environ.get('NATS_SERVER', '/opt/homebrew/bin/nats-server')
        cls.nats = os.environ.get('RECOVERY_NATS_MODULE', '/Users/moltymac/openclaw-nodedev/node_modules/nats')
        cls.scripts = cls.root/'client.cjs'
        cls.scripts.write_text("""const {connect,StringCodec}=require(process.env.OWNED_NATS_MODULE);
const sc=StringCodec();let nc;
(async()=>{nc=await connect({servers:process.env.OWNED_URL,token:process.env.OWNED_TOKEN,reconnect:false,name:process.env.OWNED_NAME});
const jm=await nc.jetstreamManager();
if(process.env.OWNED_ACTION==='setup'){
 await jm.streams.add({name:'HISTORY',subjects:['history'],storage:'file'});
 await nc.jetstream().publish('history',sc.encode('one'));
 await jm.consumers.add('HISTORY',{durable_name:'stable',ack_policy:'explicit',deliver_policy:'all'});
}else if(process.env.OWNED_ACTION==='fail')throw Error('owned client negative control');
else if(process.env.OWNED_ACTION==='write')await nc.jetstream().publish('history',sc.encode('two'));
else if(process.env.OWNED_ACTION==='consumer')await jm.consumers.update('HISTORY','stable',{description:'unexpected change'});
else if(process.env.OWNED_ACTION==='bulk'){
 for(let i=0;i<16;i++){
  const extra=await connect({servers:process.env.OWNED_URL,token:process.env.OWNED_TOKEN,reconnect:false,name:'owned-bulk-'+i});
  await extra.flush();await extra.close();
 }
}
else if(process.env.OWNED_ACTION==='hold'){
 const lines=require('node:readline').createInterface({input:process.stdin});
 console.log(JSON.stringify({ready:true,cid:nc.info.client_id}));
 for await(const line of lines){
  if(line==='quit')break;
  if(line==='write')await nc.jetstream().publish('history',sc.encode('existing-client-write'));
  else if(line==='ack'){
   const consumer=await nc.jetstream().consumers.get('HISTORY','stable');
   const message=await consumer.next({expires:1000});if(!message||!await message.ackAck())throw Error('owned ack failed');
  }else throw Error('unknown owned action');
  console.log(JSON.stringify({completed:line}));
 }
 lines.close();
}
await nc.drain();})().catch(async error=>{
 console.error(JSON.stringify({name:error.name,code:error.code,message:error.message}));await nc?.close();process.exitCode=1;
});
""")
        try:
            for i in range(3):
                held = []
                for _ in range(2):
                    s = socket.socket(); s.bind(('127.0.0.1', 0)); held.append(s)
                client, monitor = [s.getsockname()[1] for s in held]
                assert client not in (4222, 4223, 4224) and monitor not in (8222, 8223, 8224)
                config = cls.root/f'server-{i}.conf'
                config.write_text(f'server_name: owned-{i}\nlisten: 127.0.0.1:{client}\nhttp: 127.0.0.1:{monitor}\nauthorization {{ token: "{cls.token}" }}\njetstream {{ store_dir: "{cls.root}/store-{i}" }}\n')
                for s in held:
                    s.close()
                log = open(cls.root/f'server-{i}.log', 'ab', buffering=0)
                proc = subprocess.Popen([cls.binary, '--config', str(config)], stdout=log, stderr=log)
                cls.servers.append((proc, client, monitor, log))
                for _ in range(100):
                    try:
                        capture(monitor); break
                    except (OSError, Refused):
                        if proc.poll() is not None:
                            raise RuntimeError('owned server failed startup')
                        time.sleep(.02)
                else:
                    raise RuntimeError('owned server readiness timed out')
                cls.client(client, 'setup')
        except BaseException:
            cls.tearDownClass(); raise

    @classmethod
    def client(cls, port, action):
        env = {**os.environ, 'OWNED_NATS_MODULE': cls.nats, 'OWNED_URL': f'nats://127.0.0.1:{port}',
               'OWNED_TOKEN': cls.token, 'OWNED_NAME': 'owned-preservation-'+secrets.token_hex(8), 'OWNED_ACTION': action}
        result = subprocess.run([cls.node, str(cls.scripts)], env=env, capture_output=True, timeout=10)
        if result.returncode:
            message = result.stderr.decode('utf8', 'replace').replace(cls.token, '[owned token omitted]')
            (cls.root/('client-failure-'+secrets.token_hex(8)+'.json')).write_text(json.dumps({
                'action': action, 'returncode': result.returncode, 'stderr': message,
            }, indent=2))
            raise RuntimeError('owned client failed: '+message)

    @classmethod
    def tearDownClass(cls):
        failures = []
        for i, (proc, client, monitor, log) in enumerate(cls.servers):
            try:
                if proc.poll() is None:
                    proc.send_signal(signal.SIGTERM)
                code = proc.wait(timeout=10)
                assert code == 0, 'owned server did not exit normally'
                assert 'Server Exiting' in (cls.root/f'server-{i}.log').read_text()
            except Exception as error:
                failures.append({'pid': proc.pid, 'error': str(error), 'forced': proc.poll() is None})
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=5)
            finally:
                log.close()
        report = {'ownedEvidence': str(cls.root), 'ownedServers': len(cls.servers),
                  'noProductionConnections': True, 'cleanupFailures': failures}
        (cls.root/'cleanup.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
        assert not failures, 'owned server cleanup was not graceful'

    def test_http_observation_creates_no_clients(self):
        for proc, client, monitor, log in self.servers:
            before = capture(monitor)
            quiet = QuietWindow({'owned': before})
            for _ in range(4):
                quiet.check({'owned': capture(monitor)}, {'owned': set()})
            self.assertEqual(before['total_connections'], capture(monitor)['total_connections'])
            json.dumps(before)

    def test_failed_owned_client_retains_diagnostics_and_closes_connection(self):
        proc, client, monitor, log = self.servers[0]
        with self.assertRaisesRegex(RuntimeError, 'owned client negative control'):
            self.client(client, 'fail')
        failures = list(self.root.glob('client-failure-*.json'))
        self.assertTrue(failures)
        self.assertIn('owned client negative control', failures[-1].read_text())
        self.assertFalse(capture(monitor)['open'])

    def test_identity_and_route_recovery_cannot_hide_a_stall(self):
        before = capture(self.servers[0][2])
        for field, value in (('server_id', 'restarted'), ('start', 'later'),
                             ('config_digest', 'reloaded')):
            changed = copy.deepcopy(before)
            changed[field] = value
            with self.assertRaises(Refused):
                verify_admissions(before, changed)
        changed = copy.deepcopy(before)
        changed['routes'] = [{'rid': 1, 'remote_id': 'owned-peer', 'ip': '127.0.0.1', 'start': 'later'}]
        with self.assertRaises(Refused):
            QuietWindow({'owned': before}).check({'owned': changed}, {'owned': {'owned-peer'}})
        changed = copy.deepcopy(before)
        changed['raft'] = {'$SYS': {'_meta_': {'term': 2}}}
        with self.assertRaises(Refused):
            QuietWindow({'owned': before}).check({'owned': changed}, {'owned': set()})

    def test_frozen_owned_server_refuses_by_deadline(self):
        proc, client, monitor, log = self.servers[0]
        proc.send_signal(signal.SIGSTOP)
        started = time.monotonic()
        try:
            with self.assertRaises(Refused):
                capture(monitor)
            self.assertLess(time.monotonic()-started, 3)
        finally:
            proc.send_signal(signal.SIGCONT)

    def test_closed_connections_beyond_first_page_are_not_missed(self):
        for proc, client, monitor, log in self.servers:
            before = capture(monitor)
            self.client(client, 'bulk')
            page = http_json(monitor, '/connz?state=closed&limit=10')
            self.assertGreater(page['total'], len(page['connections']))
            after = capture(monitor)
            self.assertEqual(len(after['closed']), page['total'])
            with self.assertRaises(Refused):
                verify_admissions(before, after)

    def test_server_restart_invalidates_admission_baseline(self):
        proc, client, monitor, log = self.servers[0]
        before = capture(monitor)
        proc.send_signal(signal.SIGTERM)
        self.assertEqual(proc.wait(timeout=10), 0)
        log.close()
        log = open(self.root/'server-0.log', 'ab', buffering=0)
        proc = subprocess.Popen([self.binary, '--config', str(self.root/'server-0.conf')], stdout=log, stderr=log)
        self.servers[0] = (proc, client, monitor, log)
        for _ in range(100):
            try:
                after = capture(monitor)
                if after['server_id'] != before['server_id']:
                    break
            except Refused:
                pass
            self.assertIsNone(proc.poll())
            time.sleep(.02)
        else:
            self.fail('owned restart failed readiness')
        self.assertNotEqual(after['server_id'], before['server_id'])
        self.assertLess(after['total_connections'], before['total_connections'])
        with self.assertRaises(Refused):
            verify_admissions(before, after)

    def test_fast_writer_and_failed_auth_between_samples_each_bus(self):
        for proc, client, monitor, log in self.servers:
            with self.subTest(port=client):
                before = capture(monitor)
                self.assertFalse(before['open'])
                self.client(client, 'write')
                after = capture(monitor)
                self.assertFalse(after['open'])
                with self.assertRaises(Refused):
                    QuietWindow({'owned': before}).check({'owned': after}, {'owned': set()})
                with self.assertRaises(Refused):
                    verify_streams(before, after)
                bad = socket.create_connection(('127.0.0.1', client), timeout=2)
                bad.recv(4096)
                bad.sendall(b'CONNECT {"auth_token":"wrong-owned-token","name":"owned-bad-auth"}\r\nPING\r\n')
                for _ in range(10):
                    if b'Authorization Violation' in bad.recv(4096):
                        break
                bad.close()
                final = capture(monitor)
                self.assertFalse(final['open'])
                with self.assertRaises(Refused):
                    verify_admissions(after, final)

    def test_existing_client_write_and_durable_change_are_not_admission_proof(self):
        for proc, client, monitor, log in self.servers:
            env = {**os.environ, 'OWNED_NATS_MODULE': self.nats, 'OWNED_URL': f'nats://127.0.0.1:{client}',
                   'OWNED_TOKEN': self.token, 'OWNED_NAME': 'owned-persistent-'+secrets.token_hex(8), 'OWNED_ACTION': 'hold'}
            writer = subprocess.Popen([self.node, str(self.scripts)], env=env,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True)
            try:
                self.assertTrue(select.select([writer.stdout], [], [], 5)[0], 'owned writer did not start')
                cid = json.loads(writer.stdout.readline())['cid']
                for action in ('write', 'ack'):
                    before = capture(monitor)
                    self.assertIn(cid, before['open'])
                    writer.stdin.write(action+'\n'); writer.stdin.flush()
                    self.assertTrue(select.select([writer.stdout], [], [], 5)[0], 'owned write or ack timed out')
                    self.assertEqual(json.loads(writer.stdout.readline())['completed'], action)
                    after = capture(monitor)
                    verify_admissions(before, after)
                    self.assertEqual(after['open'], before['open'])
                    with self.assertRaises(Refused):
                        verify_streams(before, after)
                writer.stdin.write('quit\n'); writer.stdin.flush()
                _, stderr = writer.communicate(timeout=10)
                self.assertEqual(writer.returncode, 0)
                self.assertEqual(stderr, '')
            finally:
                if writer.poll() is None:
                    writer.terminate(); writer.communicate(timeout=5)
            before = capture(monitor)
            self.client(client, 'consumer')
            with self.assertRaises(Refused):
                verify_streams(before, capture(monitor))


if __name__ == '__main__':
    unittest.main(verbosity=2)
