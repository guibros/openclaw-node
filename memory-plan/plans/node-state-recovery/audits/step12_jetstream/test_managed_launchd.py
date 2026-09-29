import json
import hashlib
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
process.umask(0o077);
(async()=>{
 const nc=await connect({servers:process.env.OWNED_NATS_URL,token:process.env.OWNED_TOKEN,name:process.env.OWNED_NAME,maxReconnectAttempts:0});
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
 let child;
 if(['survivor','child','orphan','exec-child'].includes(process.env.OWNED_MODE)){
  if(process.env.OWNED_MODE==='orphan') {
   const launcher=cp.spawn(process.execPath,['-e',"require('node:child_process').spawn(process.execPath,[process.env.OWNED_CHILD],{stdio:'ignore',env:process.env}).unref()"],{stdio:'ignore',env:process.env});
   await new Promise(r=>launcher.on('exit',r));
  } else if(process.env.OWNED_MODE==='exec-child') {
   child=cp.spawn(process.env.OWNED_PYTHON,[process.env.OWNED_EXEC_CHILD],{stdio:'ignore',env:process.env});child.unref();
  } else {
   child=cp.spawn(process.execPath,[process.env.OWNED_CHILD],{detached:process.env.OWNED_MODE==='survivor',stdio:'ignore',env:process.env});child.unref();
  }
  while(!fs.existsSync(process.env.OWNED_CHILD_READY))await new Promise(r=>setTimeout(r,10));
  if(!child)child={pid:JSON.parse(fs.readFileSync(process.env.OWNED_CHILD_READY)).pid};
 }
 fs.writeFileSync(process.env.OWNED_READY+'.pending',JSON.stringify({pid:process.pid,cid:nc.info.client_id,serverId:nc.info.server_id,port:listener.address().port,child:child?.pid}));fs.renameSync(process.env.OWNED_READY+'.pending',process.env.OWNED_READY);
 console.log('owned fixture ready');
 setInterval(()=>{if(fs.existsSync(process.env.OWNED_FORK)){fs.unlinkSync(process.env.OWNED_FORK);cp.spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),100)'],{stdio:'ignore'});}},10);
 process.on('SIGTERM',async()=>{if(process.env.OWNED_MODE==='hang')return;await nc.close();await new Promise(r=>listener.close(r));console.log('Shutdown complete.');process.exit(process.env.OWNED_MODE==='crash'?2:0);});
})().catch(()=>process.exit(1));
''')
        cls.child = cls.root / 'child.cjs'
        cls.child.write_text('''
const fs=require('node:fs'),net=require('node:net');
process.umask(0o077);
const server=net.createServer();server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(process.env.OWNED_CHILD_READY+'.pending',JSON.stringify({pid:process.pid,port:server.address().port}));fs.renameSync(process.env.OWNED_CHILD_READY+'.pending',process.env.OWNED_CHILD_READY);});
process.on('SIGTERM',()=>{});
setInterval(()=>{if(fs.existsSync(process.env.OWNED_CHILD_STOP))server.close(()=>process.exit(0));},20);
''')
        cls.exec_child = cls.root / 'exec-child.py'
        cls.exec_child.write_text('''
import json,os,pathlib,time
os.umask(0o077)
ready=pathlib.Path(os.environ['OWNED_CHILD_READY'])
pending=ready.with_suffix('.pending')
pending.write_text(json.dumps({'pid':os.getpid()}))
pending.replace(ready)
while not pathlib.Path(os.environ['OWNED_EXEC_TRIGGER']).exists():time.sleep(.02)
os.execv('/bin/sleep',['sleep','30'])
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

    def launch(self, mode='good', run_at_load=True, exit_timeout=5, identity_files=None, load_elsewhere=False):
        env = {'HOME': str(self.directory), 'OWNED_NATS_PACKAGE': str(self.package),
               'OWNED_NATS_URL': 'nats://127.0.0.1:' + str(self.port), 'OWNED_TOKEN': self.token,
               'OWNED_NAME': self.name, 'OWNED_MODE': mode, 'OWNED_READY': str(self.ready),
               'OWNED_CHILD': str(self.child), 'OWNED_CHILD_READY': str(self.directory / 'child-ready.json'),
               'OWNED_CHILD_STOP': str(self.directory / 'child-stop'),
               'OWNED_PYTHON': sys.executable, 'OWNED_EXEC_CHILD': str(self.exec_child),
               'OWNED_EXEC_TRIGGER': str(self.directory / 'exec'),
               'OWNED_FORK': str(self.directory / 'fork')}
        self.plist.write_bytes(plistlib.dumps({'Label': self.name, 'ProgramArguments': [self.node, str(self.script)],
            'WorkingDirectory': str(self.directory), 'EnvironmentVariables': env,
            'RunAtLoad': run_at_load, 'KeepAlive': False, 'ExitTimeOut': exit_timeout,
            'StandardOutPath': str(self.log), 'StandardErrorPath': str(self.err)}))
        if load_elsewhere:
            alternate = self.directory / 'alternate.plist'
            alternate.write_bytes(self.plist.read_bytes())
            Launchd(self.name, alternate).bootstrap()
        else:
            self.service.bootstrap()
        if not run_at_load:
            return
        wait_for(self.ready.exists)
        self.details = json.loads(self.ready.read_text())
        binding = self.service.bind([self.node, str(self.script)], self.node, self.directory, identity_files)
        self.assertEqual(binding['status']['pid'], self.details['pid'])
        return binding

    def tearDown(self):
        (self.directory / 'child-stop').touch(mode=0o600)
        if self.service.status()['loaded']:
            subprocess.run(['/bin/launchctl', 'bootout', self.service.target], capture_output=True, timeout=10)
        if (self.directory / 'child-ready.json').exists():
            pid = json.loads((self.directory / 'child-ready.json').read_text())['pid']
            if (self.directory / 'exec').exists() and process_exists(pid):
                os.kill(pid, 15)
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
        with self.assertRaisesRegex(Refused, 'spawn-race evidence is absent'):
            verify()
        self.assertFalse(self.service.status()['loaded'])
        self.assertEqual(self.log.stat().st_size, 0)

    def test_forced_kill_is_observed_past_loaded_exit_timeout_and_refused(self):
        binding = self.launch('hang', exit_timeout=1)
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            with self.assertRaisesRegex(Refused, 'termination violates'):
                watch.verify(self.connection_closed, self.listener_absent)
        event = watch.events[self.details['pid']]
        self.assertTrue(os.WIFSIGNALED(event['wait_status']))
        self.assertEqual(os.WTERMSIG(event['wait_status']), 9)
        self.assertEqual(binding['status']['exit_timeout'], 1)
        self.proofs.append({'test': self._testMethodName, 'bootout': watch.bootout,
                            'exits': watch.events, 'refused': True})

    def test_orphaned_same_group_helper_is_watched_and_refused_after_owner_exit(self):
        binding = self.launch('orphan')
        helper = self.details['child']
        self.assertIn(helper, binding['tree'])
        self.assertNotEqual(binding['tree'][helper]['parent'], self.details['pid'])
        self.assertEqual(binding['tree'][helper]['group'], binding['tree'][self.details['pid']]['group'])
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            with self.assertRaisesRegex(Refused, 'termination violates|exit was not observed before live owner|descendant exit was not observed'):
                watch.verify(self.connection_closed, self.listener_absent)
        self.assertTrue(helper in watch.events or process_exists(helper))
        self.proofs.append({'test': self._testMethodName, 'exits': watch.events,
                            'contracts': watch.contracts, 'helperSurvives': process_exists(helper), 'refused': True})

    def test_bound_child_normal_exit_while_owner_lives_does_not_abort_stop(self):
        binding = self.launch('child')
        helper = self.details['child']
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            (self.directory / 'child-stop').touch(mode=0o600)
            wait_for(lambda: (watch.drain(.01), helper in watch.events)[1])
            self.assertTrue(watch.events[helper]['owner_alive_at_observation'])
            wait_for(lambda: not process_exists(helper))
            watch.apply()
            proof = watch.verify(self.connection_closed, self.listener_absent)
        self.assertTrue(proof['verified'])
        self.proofs.append({'test': self._testMethodName, 'proof': proof})

    def test_fork_after_watch_preparation_refuses_before_stop(self):
        binding = self.launch()
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            (self.directory / 'fork').touch(mode=0o600)
            wait_for(lambda: (watch.drain(.01), bool(watch.lifecycle))[1])
            with self.assertRaisesRegex(Refused, 'fork or exec'):
                watch.apply()
        self.assertTrue(self.service.status()['running'])
        self.proofs.append({'test': self._testMethodName, 'lifecycle': watch.lifecycle, 'refused': True})

    def test_identical_identity_rewrite_after_start_refuses_before_stop(self):
        identity = self.directory / 'declared-config.json'
        identity.write_text('{}')
        pins = {str(identity): hashlib.sha256(identity.read_bytes()).hexdigest()}
        binding = self.launch(identity_files=pins)
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            identity.write_text('{}')
            with self.assertRaisesRegex(Refused, 'identity file mutated after watch preparation'):
                watch.apply()
        self.assertTrue(self.service.status()['running'])

    def test_identity_file_replacement_after_preparation_refuses_before_intent(self):
        identity = self.directory / 'declared-config.json'
        identity.write_text('{}')
        binding = self.launch(identity_files={str(identity): hashlib.sha256(identity.read_bytes()).hexdigest()})
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            identity.rename(self.directory / 'retained-original.json')
            identity.write_text('{}')
            with self.assertRaisesRegex(Refused, 'identity file mutated'):
                watch.ready_for_intent()
        self.assertTrue(self.service.status()['running'])

    def test_loaded_plist_path_cannot_be_inferred_from_identical_arguments(self):
        with self.assertRaisesRegex(Refused, 'loaded plist provenance differs'):
            self.launch(load_elsewhere=True)
        self.assertTrue(self.service.status()['running'])

    def test_identity_permission_change_after_preparation_refuses_before_intent(self):
        identity = self.directory / 'declared-config.json'
        identity.write_text('{}')
        binding = self.launch(identity_files={str(identity): hashlib.sha256(identity.read_bytes()).hexdigest()})
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            identity.chmod(0o400)
            with self.assertRaisesRegex(Refused, 'identity file mutated'):
                watch.ready_for_intent()
        self.assertTrue(self.service.status()['running'])

    def test_completion_log_must_be_the_loaded_jobs_log(self):
        binding = self.launch()
        fake = self.directory / 'fake-shutdown.log'
        fake.write_text('Shutdown complete.')
        with self.assertRaisesRegex(Refused, 'log paths differ from actual loaded job'):
            StopWatch(self.service, binding, [fake, self.err], 'mesh-task-daemon')
        self.assertTrue(self.service.status()['running'])

    def test_exec_after_watch_preparation_refuses_before_stop(self):
        binding = self.launch('exec-child')
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            (self.directory / 'exec').touch(mode=0o600)
            wait_for(lambda: (watch.drain(.01), any(item['flags'] & 0x20000000 for item in watch.lifecycle))[1])
            with self.assertRaisesRegex(Refused, 'fork or exec'):
                watch.apply()
        self.assertTrue(self.service.status()['running'])
        self.proofs.append({'test': self._testMethodName, 'lifecycle': watch.lifecycle, 'refused': True})

    def test_declared_environment_mismatch_refuses_without_disclosing_value(self):
        self.launch()
        plist = plistlib.loads(self.plist.read_bytes())
        plist['EnvironmentVariables']['OWNED_TOKEN'] = secrets.token_hex(32)
        self.plist.write_bytes(plistlib.dumps(plist))
        with self.assertRaisesRegex(Refused, 'running environment differs') as error:
            self.service.bind([self.node, str(self.script)], self.node, self.directory)
        self.assertNotIn(self.token, str(error.exception))
        self.assertNotIn(plist['EnvironmentVariables']['OWNED_TOKEN'], str(error.exception))
        self.assertTrue(self.service.status()['running'])

    def test_other_domain_owner_refuses_duplicate_bootstrap(self):
        self.launch(run_at_load=False)
        subprocess.run(['/bin/launchctl', 'bootout', self.service.target], capture_output=True, check=True)
        target = 'user/' + str(os.getuid())
        result = subprocess.run(['/bin/launchctl', 'bootstrap', target, str(self.plist)], capture_output=True)
        elevated = result.returncode != 0
        if elevated:
            result = subprocess.run(['/usr/bin/sudo', '-n', '/bin/launchctl', 'bootstrap', target, str(self.plist)], capture_output=True)
            if result.returncode:
                self.skipTest('user-domain owned job bootstrap is unavailable; duplicate-domain runtime control not proved')
        try:
            self.assertTrue(self.service.status('user')['loaded'])
            with self.assertRaisesRegex(Refused, 'another domain'):
                self.service.bootstrap()
            self.assertFalse(self.service.status()['loaded'])
        finally:
            argv = (['/usr/bin/sudo', '-n'] if elevated else []) + ['/bin/launchctl', 'bootout', target + '/' + self.name]
            subprocess.run(argv, capture_output=True, check=True)

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
