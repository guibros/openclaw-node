import copy
import json
import os
import pathlib
import secrets
import signal
import socket
import subprocess
import tempfile
import time
import unittest

from preservation_checks import QuietWindow, Refused, capture, http_json


class Cluster(unittest.TestCase):
    def test_stream_and_consumer_groups_and_real_stream_election(self):
        os.umask(0o077)
        root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-preservation-cluster-',
                                          dir=os.environ.get('RECOVERY_EVIDENCE_DIR')))
        token = secrets.token_hex(24)
        route_password = secrets.token_hex(24)
        binary = os.environ.get('NATS_SERVER', '/opt/homebrew/bin/nats-server')
        node = os.environ.get('RECOVERY_NODE', '/usr/local/bin/node')
        module = os.environ.get('RECOVERY_NATS_MODULE', '/Users/moltymac/openclaw-nodedev/node_modules/nats')
        held = []
        for _ in range(9):
            sock = socket.socket(); sock.bind(('127.0.0.1', 0)); held.append(sock)
        ports = [sock.getsockname()[1] for sock in held]
        self.assertFalse(set(ports) & {4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224})
        configs = []
        for i in range(3):
            config = root/f'server-{i}.conf'
            routes = ','.join(f'"nats://owned:{route_password}@127.0.0.1:{ports[j*3+2]}"'
                              for j in range(3) if j != i)
            config.write_text(f'''server_name: owned-raft-{i}
listen: 127.0.0.1:{ports[i*3]}
http: 127.0.0.1:{ports[i*3+1]}
authorization {{ token: "{token}" }}
jetstream {{ store_dir: "{root}/store-{i}" }}
cluster {{ name: owned-preservation
 listen: 127.0.0.1:{ports[i*3+2]}
 authorization {{ user: owned, password: "{route_password}" }}
 routes: [{routes}]
 no_advertise: true
}}
''')
            configs.append(config)
        script = root/'client.cjs'
        script.write_text('''const {connect,StringCodec}=require(process.env.OWNED_NATS_MODULE);
let nc,stage='connect';
(async()=>{
 nc=await connect({servers:process.env.OWNED_URL,token:process.env.OWNED_TOKEN,reconnect:false,name:'owned-raft-control'});
 stage='account-info';const jm=await nc.jetstreamManager();
 if(process.env.OWNED_ACTION==='ready')await jm.getAccountInfo();
 else if(process.env.OWNED_ACTION==='create'){
  stage='stream-add';
  await jm.streams.add({name:'HISTORY',subjects:['history'],storage:'file',num_replicas:3});
  stage='stream-readiness';
  const deadline=Date.now()+5000;
  while(true){
   const info=await jm.streams.info('HISTORY');
   if(info.cluster?.leader&&info.cluster.replicas?.length===2&&info.cluster.replicas.every(r=>r.current)){
    console.log(JSON.stringify({leader:info.cluster.leader}));break;
   }
   if(Date.now()>=deadline)throw Error('owned stream failed readiness');
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 }else if(process.env.OWNED_ACTION==='seed'){
  stage='local-leader-check';const info=await jm.streams.info('HISTORY');
  if(info.cluster?.leader!==nc.info.server_name)throw Error('owned seed is not on the stream leader');
  stage='publish';await nc.jetstream().publish('history',StringCodec().encode('preserved'));
  stage='consumer-add';
  await jm.consumers.add('HISTORY',{durable_name:'stable',ack_policy:'explicit',num_replicas:3});
 }else{
  stage='stepdown';
  const reply=await nc.request('$JS.API.STREAM.LEADER.STEPDOWN.HISTORY',Buffer.from('{}'),{timeout:5000});
  const data=JSON.parse(new TextDecoder().decode(reply.data));if(data.error||!data.success)throw Error('owned stepdown failed');
 }
 await nc.drain();
})().catch(async error=>{console.error(JSON.stringify({stage,name:error.name,code:error.code,message:error.message}));await nc?.close();process.exitCode=1;});
''')
        owners = []
        cleanup = []
        succeeded = False
        for sock in held:
            sock.close()
        def client(action, startup=False, port=None):
            result = subprocess.run([node, str(script)], env={**os.environ, 'OWNED_NATS_MODULE': module,
                'OWNED_URL': f'nats://127.0.0.1:{port or ports[0]}', 'OWNED_TOKEN': token, 'OWNED_ACTION': action},
                capture_output=True, text=True, timeout=15)
            if result.returncode and startup:
                error = json.loads(result.stderr)
                if error.get('stage') == 'account-info' and error.get('code') == '503':
                    with (root/'startup-api-refusals.jsonl').open('a') as handle:
                        handle.write(json.dumps(error)+'\n')
                    return False
            self.assertEqual(result.returncode, 0, result.stderr.replace(token, '[owned token omitted]'))
            return json.loads(result.stdout) if action == 'create' else True
        try:
            for i, config in enumerate(configs):
                log = open(root/f'server-{i}.log', 'ab', buffering=0)
                proc = subprocess.Popen([binary, '--config', str(config)], stdout=log, stderr=log)
                owners.append((proc, log))
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                self.assertTrue(all(proc.poll() is None for proc, log in owners))
                try:
                    js = [http_json(ports[i*3+1], '/jsz') for i in range(3)]
                    routes = [http_json(ports[i*3+1], '/routez') for i in range(3)]
                    if all(report.get('meta_cluster', {}).get('leader', '').startswith('owned-raft-')
                           for report in js) and all(len({route['remote_id'] for route in report['routes']}) == 2
                                                    for report in routes) and client('ready', startup=True):
                        break
                except Refused:
                    pass
                time.sleep(.05)
            else:
                (root/'readiness-refused.json').write_text(json.dumps({'jsz': js, 'routes': routes}, indent=2))
                self.fail('owned cluster failed readiness')
            creation = client('create')
            leader = int(creation['leader'].removeprefix('owned-raft-'))
            self.assertIn(leader, range(3))
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                subscriptions = http_json(ports[leader*3+1], '/subsz?subs=1&limit=10000')
                if any(row.get('subject') == 'history' for row in subscriptions.get('subscriptions_list', [])):
                    break
                time.sleep(.02)
            else:
                (root/'publish-readiness-refused.json').write_text(json.dumps(subscriptions, indent=2))
                self.fail('owned stream leader has no local history subscription')
            client('seed', port=ports[leader*3])
            previous = None
            stable_since = None
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                before = [capture(ports[i*3+1]) for i in range(3)]
                groups = [report['raft'] for report in before]
                if groups == previous:
                    if stable_since is None:
                        stable_since = time.monotonic()
                    if time.monotonic() - stable_since >= 1:
                        break
                else:
                    stable_since = None
                previous = groups
                time.sleep(.05)
            else:
                (root/'raft-readiness-refused.json').write_text(json.dumps(before, indent=2))
                self.fail('owned replication groups did not settle after creation')
            for report in before:
                self.assertIn('$SYS', report['raft'])
                self.assertIn('$G', report['raft'])
                self.assertGreaterEqual(len(report['raft']['$G']), 2)
                self.assertTrue(all(node['leader'] for node in report['raft']['$G'].values()))
            peers = {str(i): {r['server_id'] for j, r in enumerate(before) if i != j} for i in range(3)}
            window = QuietWindow({str(i): report for i, report in enumerate(before)})
            for _ in range(5):
                readings = {str(i): capture(ports[i*3+1]) for i in range(3)}
                try:
                    window.check(readings, peers)
                except Refused:
                    (root/'quiet-refused.json').write_text(json.dumps({'before': before, 'after': readings}, indent=2))
                    raise
            client('stepdown')
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                after = [capture(ports[i*3+1]) for i in range(3)]
                if all(report['raft']['$G'] != before[i]['raft']['$G'] for i, report in enumerate(after)):
                    break
                time.sleep(.05)
            else:
                self.fail('owned stream election did not change observed account groups')
            self.assertEqual(after[0]['raft']['$SYS'], before[0]['raft']['$SYS'])
            changed = copy.deepcopy(before[0]); changed['raft'] = after[0]['raft']
            with self.assertRaisesRegex(Refused, 'Raft state changed'):
                QuietWindow({'owned': before[0]}).check({'owned': changed}, {'owned': peers['0']})
            (root/'group-evidence.json').write_text(json.dumps({'before': before, 'after': after}, indent=2))
            succeeded = True
        finally:
            for i, (proc, log) in reversed(list(enumerate(owners))):
                try:
                    if proc.poll() is None:
                        proc.send_signal(signal.SIGTERM)
                    self.assertEqual(proc.wait(timeout=10), 0)
                    self.assertIn('Server Exiting', (root/f'server-{i}.log').read_text())
                except Exception as error:
                    cleanup.append({'pid': proc.pid, 'error': str(error), 'forced': proc.poll() is None})
                    if proc.poll() is None:
                        proc.kill(); proc.wait(timeout=5)
                finally:
                    log.close()
            report = {'root': str(root), 'passed': succeeded and not cleanup, 'cleanupFailures': cleanup,
                      'scope': 'owned three-member cluster only; no production ports or routes'}
            (root/'cleanup.json').write_text(json.dumps(report, indent=2))
            print(json.dumps(report))
            self.assertFalse(cleanup, 'owned cluster shutdown was not normal')


if __name__ == '__main__':
    unittest.main()
