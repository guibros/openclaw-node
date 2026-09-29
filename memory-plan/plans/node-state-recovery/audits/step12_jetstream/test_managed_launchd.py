import json
import os
import pathlib
import plistlib
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

from managed_launchd import Launchd, StopWatch, process_exists, unload_idle_timer
from preservation_checks import Refused, http_json


def free_port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def wait_for(check, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(.02)
    raise AssertionError('owned fixture deadline exceeded')


@unittest.skipUnless(sys.platform == 'darwin', 'requires actual macOS launchd and exit events')
class OwnedLaunchd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.umask(0o077)
        cls.root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-owned-launchd-',
                                dir=os.environ.get('OPENCLAW_OWNED_TEST_ROOT'))).resolve()
        cls.proofs = []
        cls.token = secrets.token_hex(32)
        cls.port, cls.monitor = free_port(), free_port()
        cls.node = os.environ.get('RECOVERY_NODE') or shutil.which('node')
        cls.nats = os.environ.get('NATS_SERVER') or shutil.which('nats-server')
        cls.package = pathlib.Path(os.environ.get('RECOVERY_NATS_MODULE') or
                                  pathlib.Path(__file__).parents[5] / 'node_modules/nats').resolve(strict=True)
        config = cls.root / 'server.conf'
        config.write_text(f'host: 127.0.0.1\nport: {cls.port}\nhttp_port: {cls.monitor}\nauthorization {{ token: "{cls.token}" }}\n')
        cls.server_log = (cls.root / 'server.log').open('wb')
        cls.server = subprocess.Popen([cls.nats, '-c', str(config)], stdout=cls.server_log, stderr=cls.server_log)
        def ready():
            try:
                return http_json(cls.monitor, '/varz')
            except Refused:
                return False
        wait_for(ready)
        cls.script = cls.root / 'owner.cjs'
        cls.script.write_text('''
const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');
const {connect}=require(process.env.OWNED_NATS_PACKAGE);
(async()=>{
 const nc=await connect({servers:process.env.OWNED_NATS_URL,token:process.env.OWNED_TOKEN,name:process.env.OWNED_NAME,maxReconnectAttempts:0});
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
 let child;
 if(process.env.OWNED_MODE==='survivor'){
  child=cp.spawn(process.execPath,[process.env.OWNED_CHILD],{detached:true,stdio:'ignore',env:process.env});child.unref();
  while(!fs.existsSync(process.env.OWNED_CHILD_READY))await new Promise(r=>setTimeout(r,10));
 }
 fs.writeFileSync(process.env.OWNED_READY,JSON.stringify({pid:process.pid,cid:nc.info.client_id,serverId:nc.info.server_id,port:listener.address().port,child:child?.pid}));
 console.log('owned fixture ready');
 process.on('SIGTERM',async()=>{await nc.close();await new Promise(r=>listener.close(r));console.log('Shutdown complete.');process.exit(process.env.OWNED_MODE==='crash'?2:0);});
})().catch(()=>process.exit(1));
''')
        cls.child = cls.root / 'child.cjs'
        cls.child.write_text('''
const fs=require('node:fs'),net=require('node:net');
const server=net.createServer();server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.env.OWNED_CHILD_READY,JSON.stringify({pid:process.pid,port:server.address().port})));
process.on('SIGTERM',()=>{});
setInterval(()=>{if(fs.existsSync(process.env.OWNED_CHILD_STOP))server.close(()=>process.exit(0));},20);
''')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.server_log.close()
        print(json.dumps({'ownedEvidence': str(cls.root), 'productionConnections': False,
                          'ownedServerExit': cls.server.returncode}), flush=True)
        (cls.root / 'proofs.json').write_text(json.dumps(cls.proofs, indent=2) + '\n')

    def setUp(self):
        self.name = 'ai.openclaw.preservation-owned.' + secrets.token_hex(8)
        self.directory = self.root / self.name
        self.directory.mkdir(mode=0o700)
        self.ready = self.directory / 'ready.json'
        self.log = self.directory / 'owner.log'
        self.err = self.directory / 'owner.err'
        self.log.touch(mode=0o600)
        self.err.touch(mode=0o600)
        self.plist = self.directory / 'unit.plist'
        self.service = Launchd(self.name, self.plist)

    def launch(self, mode='good', run_at_load=True):
        env = {'HOME': str(self.directory), 'OWNED_NATS_PACKAGE': str(self.package),
               'OWNED_NATS_URL': 'nats://127.0.0.1:' + str(self.port), 'OWNED_TOKEN': self.token,
               'OWNED_NAME': self.name, 'OWNED_MODE': mode, 'OWNED_READY': str(self.ready),
               'OWNED_CHILD': str(self.child), 'OWNED_CHILD_READY': str(self.directory / 'child-ready.json'),
               'OWNED_CHILD_STOP': str(self.directory / 'child-stop')}
        self.plist.write_bytes(plistlib.dumps({'Label': self.name, 'ProgramArguments': [self.node, str(self.script)],
            'WorkingDirectory': str(self.directory), 'EnvironmentVariables': env,
            'RunAtLoad': run_at_load, 'KeepAlive': False, 'ExitTimeOut': 5,
            'StandardOutPath': str(self.log), 'StandardErrorPath': str(self.err)}))
        self.service.bootstrap()
        if not run_at_load:
            return
        wait_for(self.ready.exists)
        self.details = json.loads(self.ready.read_text())
        binding = self.service.bind([self.node, str(self.script)], self.node, self.directory)
        self.assertEqual(binding['status']['pid'], self.details['pid'])
        return binding

    def tearDown(self):
        (self.directory / 'child-stop').touch(mode=0o600)
        if self.service.status()['loaded']:
            subprocess.run(['/bin/launchctl', 'bootout', self.service.target], capture_output=True, timeout=10)
        if (self.directory / 'child-ready.json').exists():
            pid = json.loads((self.directory / 'child-ready.json').read_text())['pid']
            wait_for(lambda: not process_exists(pid))

    def connection_closed(self):
        report = http_json(self.monitor, '/connz?state=closed&limit=10000')
        return any(row['cid'] == self.details['cid'] and row['reason'] == 'Client Closed'
                   for row in report['connections'])

    def listener_absent(self):
        with socket.socket() as connection:
            connection.settimeout(.2)
            return connection.connect_ex(('127.0.0.1', self.details['port'])) != 0

    def test_normal_managed_stop_binds_pid_cid_and_kernel_exit(self):
        binding = self.launch()
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            proof = watch.verify(self.connection_closed, self.listener_absent)
        self.assertTrue(proof['verified'])
        self.assertEqual(proof['exits'][self.details['pid']]['wait_status'], 0)
        self.assertEqual(proof['exit_flags_requested'], 0x84000000)
        self.proofs.append({'test': self._testMethodName, 'proof': proof})

    def test_completion_marker_does_not_hide_nonzero_exit(self):
        binding = self.launch('crash')
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            with self.assertRaisesRegex(Refused, 'termination violates'):
                watch.verify(self.connection_closed, self.listener_absent)
        self.assertIn('Shutdown complete.', self.log.read_text())
        self.proofs.append({'test': self._testMethodName, 'exits': watch.events, 'refused': True})

    def test_completion_marker_does_not_hide_surviving_detached_child(self):
        binding = self.launch('survivor')
        self.assertIn(self.details['child'], binding['tree'])
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            with self.assertRaisesRegex(Refused, 'descendant exit was not observed'):
                watch.verify(self.connection_closed, self.listener_absent, deadline=.5)
        self.assertIn('Shutdown complete.', self.log.read_text())
        self.assertTrue(process_exists(self.details['child']))
        self.proofs.append({'test': self._testMethodName, 'exits': watch.events,
                            'survivingChild': self.details['child'], 'refused': True})

    def test_wrong_argv_refuses_before_service_stop(self):
        self.launch()
        with self.assertRaisesRegex(Refused, 'argv does not match'):
            self.service.bind([self.node, '/nonexistent'], self.node, self.directory)
        self.assertTrue(self.service.status()['running'])

    def test_idle_timer_unloads_without_new_log_bytes(self):
        self.launch(run_at_load=False)
        apply, verify = unload_idle_timer(self.service, [self.log, self.err])
        apply()
        self.assertTrue(verify()['verified'])

    def test_timer_started_after_preparation_is_not_stopped(self):
        self.launch(run_at_load=False)
        apply, verify = unload_idle_timer(self.service, [self.log, self.err])
        self.service.kickstart()
        wait_for(self.ready.exists)
        with self.assertRaisesRegex(Refused, 'timer started before unload'):
            apply()
        self.assertTrue(self.service.status()['running'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
