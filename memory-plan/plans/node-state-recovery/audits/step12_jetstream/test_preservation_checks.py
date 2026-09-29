import copy
import http.server
import json
import os
import pathlib
import secrets
import select
import signal
import socket
import subprocess
import tempfile
import threading
import time
import unittest

from preservation_checks import (
    QuietWindow, Refused, STOP_ORDER, capture, restore_prior, verify_admissions,
    http_json, verify_completion, verify_queue, verify_streams, verify_timer_idle,
)


class Gates(unittest.TestCase):
    def refused(self, call):
        with self.assertRaises(Refused):
            call()

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

    def test_producers_stop_before_worker(self):
        for producer in ('health-watch', 'mesh-deploy-listener', 'node-watch'):
            self.assertLess(STOP_ORDER.index(producer), STOP_ORDER.index('mission-control'))
        self.assertLess(STOP_ORDER.index('scheduler-heartbeat'), STOP_ORDER.index('mission-control'))
        self.assertLess(STOP_ORDER.index('mission-control'), STOP_ORDER.index('mesh-bridge'))
        self.assertLess(STOP_ORDER.index('mesh-bridge'), STOP_ORDER.index('mesh-agent'))
        self.assertLess(STOP_ORDER.index('mesh-agent'), STOP_ORDER.index('mesh-task-daemon'))

    def test_rollback_each_stage_and_no_false_readiness(self):
        names = ('nats', 'nats-2', 'nats-3', 'mesh-task-daemon', 'mesh-agent')
        prior = {n: {'loaded': True, 'pid': i + 100} for i, n in enumerate(names)}
        stages = (
            ('mesh-agent',), ('mesh-agent', 'nats-2'),
            ('mesh-agent', 'nats-2', 'nats-3'), names,
        )
        for changed in stages:
            with self.subTest(stage=changed):
                current = copy.deepcopy(prior)
                for name in changed:
                    current[name] = {'loaded': False}
                def start(name, wanted):
                    current[name] = copy.deepcopy(wanted)
                result = restore_prior(prior, changed, start, lambda *_: None, current.__getitem__)
                self.assertTrue(result['restored'])
                self.assertEqual(current, prior)
        current = {n: {'loaded': False} for n in names}
        def partial(name, wanted):
            current[name] = {'loaded': True}
        result = restore_prior(prior, names, partial, lambda *_: None, current.__getitem__)
        self.assertFalse(result['restored'])
        self.assertFalse(result['verified'])
        self.assertTrue(result['errors'])


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
