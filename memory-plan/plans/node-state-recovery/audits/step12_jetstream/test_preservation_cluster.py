import copy
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

from cold_copy import capture_tree, copy_candidate, copy_view, verify_candidate
from preservation_checks import QuietWindow, Refused, capture, http_json, stream_state


class Cluster(unittest.TestCase):
    def raft_files(self, store):
        return copy_view({'raft': capture_tree(store/'jetstream'/'$SYS'/'_js_')})['raft']

    def corrupt_and_check(self, mode, stage):
        result = subprocess.run([sys.executable, '-m', 'unittest', '-q',
                                 'test_preservation_cluster.Cluster.test_stream_and_consumer_groups_and_real_stream_election'],
                                env={**os.environ, 'RECOVERY_CORRUPT_RESTORE': mode},
                                cwd=pathlib.Path(__file__).parent, capture_output=True,
                                text=True, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(stage, result.stderr)
        if mode == 'latent-junk-raft-snapshot-1':
            if 'Raft replay logged damage' in result.stderr:
                self.assertIn('Snapshot corrupt', result.stderr)
            else:
                self.assertIn('isolated member 1 Raft replay did not reach committed index',
                              result.stderr)
                self.assertRegex(result.stderr,
                                 r"\('\$G', 'S-[^']+', [0-9]+, [1-9][0-9]*\)")
        if mode == 'latent-hollow-raft-wal-1':
            self.assertRegex(result.stderr,
                             r"\('\$G', 'S-[^']+', [0-9]+, [1-9][0-9]*\)")
        if stage == 'restore-message-get':
            self.assertIn('"code":"404"', result.stderr)

    @unittest.skipIf(bool(os.environ.get('RECOVERY_CORRUPT_RESTORE')),
                     'negative-control child runs only the restore test')
    def test_corrupted_message_copy_cannot_pass_restore(self):
        self.corrupt_and_check('1', 'restore-message-get')

    @unittest.skipIf(bool(os.environ.get('RECOVERY_CORRUPT_RESTORE')),
                     'negative-control child runs only the restore test')
    def test_corrupted_follower_copy_cannot_pass_restore(self):
        for i in range(3):
            with self.subTest(replica=i):
                self.corrupt_and_check(f'single-{i}', 'restore-message-get')

    @unittest.skipIf(bool(os.environ.get('RECOVERY_CORRUPT_RESTORE')),
                     'negative-control child runs only the restore test')
    def test_hollow_raft_wal_cannot_replay(self):
        self.corrupt_and_check('latent-hollow-raft-wal-1',
                               'isolated member 1 Raft replay did not reach committed index')

    @unittest.skipIf(bool(os.environ.get('RECOVERY_CORRUPT_RESTORE')),
                     'negative-control child runs only the restore test')
    def test_missing_local_history_cannot_be_healed_into_a_valid_candidate(self):
        for mode in ('empty-1', 'empty-0-2', 'missing-1', 'missing-group-1',
                     'missing-consumer-1', 'empty-raft-1', 'no-raft-log-1',
                     'no-raft-term-1', 'latent-junk-raft-snapshot-1',
                     'junk-raft-snapshot-1', 'junk-raft-log-1',
                     'junk-raft-peers-1', 'junk-raft-vote-1'):
            with self.subTest(mode=mode):
                member = 0 if mode == 'empty-0-2' else 1
                stage = (f'isolated member {member} raft groups differ' if mode == 'missing-group-1'
                         else f'isolated member {member} raft group content differs'
                         if mode in ('empty-raft-1', 'no-raft-log-1', 'no-raft-term-1')
                         else 'isolated member 1 Raft replay'
                         if mode == 'latent-junk-raft-snapshot-1'
                         else f'isolated member {member} raft bytes differ from stopped baseline'
                         if mode.startswith('junk-raft-')
                         else f'isolated member {member} stream state differs')
                self.corrupt_and_check(mode, stage)

    def isolated_member_state(self, root, index, candidate_root, before, raft_reference, binary,
                              route_password, token):
        expected_groups = {group for entries in raft_reference['raft'].values() for group in entries}
        stored_groups = set(os.listdir(candidate_root / str(index) / 'jetstream' / '$SYS' / '_js_'))
        self.assertEqual(stored_groups, expected_groups,
                         f'isolated member {index} raft groups differ from pre-stop state')
        for entries in raft_reference['raft'].values():
            for group, state in entries.items():
                directory = candidate_root / str(index) / 'jetstream' / '$SYS' / '_js_' / group
                tav = directory / 'tav.idx'
                peers = directory / 'peers.idx'
                self.assertTrue(tav.is_file() and tav.stat().st_size >= 8 and
                                int.from_bytes(tav.read_bytes()[:8], 'little') >= state['term'] and
                                peers.is_file() and peers.stat().st_size > 0 and
                                any(path.is_file() and path.stat().st_size > 0 for path in
                                    list((directory / 'snapshots').glob('snap.*')) +
                                    list((directory / 'msgs').glob('*.blk'))),
                                f'isolated member {index} raft group content differs from pre-stop state')
        working = root / f'isolated-{index}'
        shutil.copytree(candidate_root / str(index), working)
        held = []
        for _ in range(5):
            sock = socket.socket()
            sock.bind(('127.0.0.1', 0))
            held.append(sock)
        ports = [sock.getsockname()[1] for sock in held]
        config = root / f'isolated-{index}.conf'
        routes = ','.join(f'"nats://owned:{route_password}@127.0.0.1:{port}"'
                          for port in ports[3:])
        config.write_text(f'''server_name: owned-raft-{index}
listen: 127.0.0.1:{ports[0]}
http: 127.0.0.1:{ports[1]}
authorization {{ token: "{token}" }}
jetstream {{ store_dir: "{working}" }}
cluster {{ name: owned-preservation
 listen: 127.0.0.1:{ports[2]}
 authorization {{ user: owned, password: "{route_password}" }}
 routes: [{routes}]
 no_advertise: true
}}
''')
        for sock in held[:3]:
            sock.close()
        log = open(root / f'isolated-{index}.log', 'ab', buffering=0)
        proc = None
        def local_view(streams):
            return {name: {'state': stream['state'],
                           'consumers': {consumer: {key: value for key, value in details.items()
                                                   if key != 'pending'}
                                         for consumer, details in stream['consumers'].items()}}
                    for name, stream in streams.items()}
        expected = local_view(before['streams'])
        try:
            proc = subprocess.Popen([binary, '--config', str(config)], stdout=log, stderr=log)
            deadline = time.monotonic() + 10
            local = None
            while time.monotonic() < deadline:
                self.assertIsNone(proc.poll(), 'isolated member exited before local inspection')
                try:
                    js = http_json(ports[1], '/jsz?accounts=true&streams=true&consumers=true&config=true')
                    local = stream_state(js.get('account_details', []))
                    if local_view(local) == expected:
                        break
                except Refused:
                    pass
                time.sleep(.05)
            if local is None:
                self.fail('isolated member did not expose local stream state')
            self.assertEqual(http_json(ports[1], '/varz')['server_name'],
                             f'owned-raft-{index}')
            self.assertEqual(http_json(ports[1], '/routez')['num_routes'], 0,
                             'isolated member connected to a peer')
            self.assertEqual(local_view(local), expected,
                             f'isolated member {index} stream state differs from pre-stop state')
            return local_view(local)
        finally:
            active_error = sys.exc_info()[0] is not None
            cleanup_error = None
            try:
                if proc is not None:
                    if proc.poll() is None:
                        proc.send_signal(signal.SIGTERM)
                    self.assertEqual(proc.wait(timeout=10), 0)
            except Exception as error:
                cleanup_error = error
                if proc is not None and proc.poll() is None:
                    proc.kill()
                    try:
                        proc.wait(timeout=5)
                    except Exception as kill_error:
                        cleanup_error = kill_error
            finally:
                log.close()
                for sock in held[3:]:
                    sock.close()
            if cleanup_error is not None and not active_error:
                raise cleanup_error

    def replay_member_raft(self, root, index, candidate_root, raft_reference, binary,
                           route_password, token):
        working = root / f'replay-{index}'
        blank = root / f'replay-blank-{index}'
        shutil.copytree(candidate_root / str(index), working)
        blank.mkdir()
        held = []
        for _ in range(6):
            sock = socket.socket()
            sock.bind(('127.0.0.1', 0))
            held.append(sock)
        ports = [sock.getsockname()[1] for sock in held]
        self.assertFalse(set(ports) & {4222, 4223, 4224, 6222, 6223, 6224,
                                       8222, 8223, 8224})
        configs = []
        for name, store, offset, peer in ((f'owned-raft-{index}', working, 0, 5),
                                          (f'owned-replay-blank-{index}', blank, 3, 2)):
            config = root / f'{name}.conf'
            config.write_text(f'''server_name: {name}
listen: 127.0.0.1:{ports[offset]}
http: 127.0.0.1:{ports[offset+1]}
authorization {{ token: "{token}" }}
jetstream {{ store_dir: "{store}" }}
cluster {{ name: owned-preservation
 listen: 127.0.0.1:{ports[offset+2]}
 authorization {{ user: owned, password: "{route_password}" }}
 routes: ["nats://owned:{route_password}@127.0.0.1:{ports[peer]}"]
 no_advertise: true
}}
''')
            configs.append(config)
        for sock in held:
            sock.close()
        owners = []
        cleanup = []
        observations = None
        try:
            for name, config in zip((f'replay-{index}', f'replay-blank-{index}'), configs):
                log = open(root / f'{name}.log', 'ab', buffering=0)
                proc = subprocess.Popen([binary, '--config', str(config)], stdout=log, stderr=log)
                owners.append((proc, log))
            deadline = time.monotonic() + 20
            stable_since = None
            previous = None
            last_shortfall = None
            while time.monotonic() < deadline:
                self.assertTrue(all(proc.poll() is None for proc, _ in owners),
                                f'isolated member {index} Raft replay server exited')
                try:
                    routes = [http_json(ports[offset+1], '/routez') for offset in (0, 3)]
                    member = http_json(ports[1], '/raftz')
                    member.update(http_json(ports[1], '/raftz?acc=%24G'))
                    blank_groups = http_json(ports[4], '/raftz?acc=%24G').get('$G', {})
                    route_ids = [{route['remote_id'] for route in report['routes']}
                                 for report in routes]
                    observations = {'member': member, 'blank': blank_groups,
                                    'route_ids': [list(ids) for ids in route_ids],
                                    'expected_groups': {account: list(groups)
                                                        for account, groups in raft_reference.items()}}
                    if not (all(len(ids) == 1 for ids in route_ids)
                            and set(member) == set(raft_reference)
                            and all(set(member[account]) == set(groups)
                                    for account, groups in raft_reference.items())):
                        stable_since = None
                        last_shortfall = None
                        time.sleep(.2)
                        continue
                    self.assertFalse(blank_groups,
                                     f'isolated member {index} replay blank acquired account state')
                    self.assertTrue(all(group.get('state') != 'LEADER' and
                                        not group.get('leader') and
                                        group.get('id') == raft_reference[account][name]['id']
                                        for account, groups in member.items()
                                        for name, group in groups.items()),
                                    f'isolated member {index} replay elected a leader')
                    indexes = {account: {name: group.get('pindex') for name, group in groups.items()}
                               for account, groups in member.items()}
                    low = [(account, name, group.get('pindex'),
                            max(expected['committed'], expected['applied']))
                           for account, groups in raft_reference.items()
                           for name, expected in groups.items()
                           for group in [member[account][name]]
                           if not isinstance(group.get('pindex'), int) or
                           group['pindex'] < max(expected['committed'], expected['applied'])]
                    if low:
                        stable_since = None
                        last_shortfall = low
                    elif indexes == previous:
                        last_shortfall = None
                        if stable_since is None:
                            stable_since = time.monotonic()
                        if time.monotonic() - stable_since >= 2:
                            break
                    else:
                        stable_since = None
                        last_shortfall = None
                    previous = indexes
                except Refused:
                    stable_since = None
                    last_shortfall = None
                time.sleep(.2)
            else:
                if last_shortfall:
                    self.fail(f'isolated member {index} Raft replay did not reach committed index: '
                              f'{last_shortfall}')
                self.fail(f'isolated member {index} Raft replay did not settle: {observations}')
        finally:
            for proc, log in reversed(owners):
                try:
                    if proc.poll() is None:
                        proc.send_signal(signal.SIGTERM)
                    self.assertEqual(proc.wait(timeout=10), 0)
                except Exception as error:
                    cleanup.append(str(error))
                    if proc.poll() is None:
                        proc.kill()
                        proc.wait(timeout=5)
                finally:
                    log.close()
            self.assertFalse(cleanup, f'isolated member {index} replay cleanup failed: {cleanup}')
        warnings = []
        for line in (root / f'replay-{index}.log').read_text().splitlines():
            if re.search(r'Snapshot corrupt|Corrupt WAL|Could not load|Error storing entry|'
                         r'corrupt state|Stream state outdated|will rebuild|index mismatch|'
                         r'checksum did not match|prior state|no checksum|Resetting WAL|Wrong index',
                         line, re.I):
                warnings.append(line)
        self.assertFalse(warnings,
                         f'isolated member {index} Raft replay logged damage: {warnings}')
        return {account: {name: group['pindex'] for name, group in groups.items()}
                for account, groups in observations['member'].items()}

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
 stage='account-info';const jm=await nc.jetstreamManager({timeout:10000});
 if(process.env.OWNED_ACTION==='ready')await jm.getAccountInfo();
 else if(process.env.OWNED_ACTION==='create'){
  stage='stream-add';
  try{
   await jm.streams.add({name:'HISTORY',subjects:['history'],storage:'file',num_replicas:3});
  }catch(error){
   if(error.code!=='TIMEOUT')throw error;
   stage='stream-add-readback';
   const info=await jm.streams.info('HISTORY');
   const config=info.config;
   if(config.name!=='HISTORY'||config.storage!=='file'||config.num_replicas!==3||
      config.subjects.length!==1||config.subjects[0]!=='history')throw Error('owned stream create timed out without matching committed config');
  }
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
 }else if(process.env.OWNED_ACTION==='ack'){
  stage='consumer-next';
  const consumer=await nc.jetstream().consumers.get('HISTORY','stable');
  const message=await consumer.next({expires:5000});
  if(!message||StringCodec().decode(message.data)!=='preserved')throw Error('owned durable delivery differs');
  stage='consumer-ack';await message.ackAck({timeout:5000});
  stage='consumer-info';
  const info=await jm.consumers.info('HISTORY','stable');
  if(info.delivered.consumer_seq!==1||info.ack_floor.consumer_seq!==1)
   throw Error('owned durable acknowledgement did not persist');
 }else if(process.env.OWNED_ACTION==='leader'){
  stage='stream-info';const info=await jm.streams.info('HISTORY');
  console.log(JSON.stringify({leader:info.cluster?.leader}));
 }else if(process.env.OWNED_ACTION==='read'||process.env.OWNED_ACTION==='read-local'){
  if(process.env.OWNED_ACTION==='read-local'){
   stage='local-leader-check';const info=await jm.streams.info('HISTORY');
   if(info.cluster?.leader!==nc.info.server_name)throw Error('connected member is not stream leader');
  }
  stage=process.env.OWNED_ACTION==='read-local'?'restore-message-get':'message-get';
  const message=await jm.streams.getMessage('HISTORY',{seq:1});
  if(process.env.OWNED_ACTION==='read-local'){
   stage='local-leader-recheck';const info=await jm.streams.info('HISTORY');
   if(info.cluster?.leader!==nc.info.server_name)throw Error('stream leader changed during read');
  }
  console.log(JSON.stringify({seq:message.seq,subject:message.subject,data:StringCodec().decode(message.data)}));
 }else{
  stage='stepdown';
  const placement=process.env.OWNED_PREFERRED?{placement:{preferred:process.env.OWNED_PREFERRED}}:{};
  const reply=await nc.request('$JS.API.STREAM.LEADER.STEPDOWN.HISTORY',Buffer.from(JSON.stringify(placement)),{timeout:5000});
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
        def client(action, startup=False, port=None, preferred=None):
            result = subprocess.run([node, str(script)], env={**os.environ, 'OWNED_NATS_MODULE': module,
                'OWNED_URL': f'nats://127.0.0.1:{port or ports[0]}', 'OWNED_TOKEN': token,
                'OWNED_ACTION': action, 'OWNED_PREFERRED': preferred or ''},
                capture_output=True, text=True, timeout=30)
            if result.returncode and startup:
                error = json.loads(result.stderr)
                if (error.get('stage') == 'account-info' and error.get('code') == '503'
                        or error.get('stage') == 'stream-add' and error.get('code') == '400'
                        and 'no suitable peers for placement' in error.get('message', '')
                        or action in ('read', 'read-local', 'leader')
                        and error.get('stage') in ('account-info', 'message-get',
                                                   'restore-message-get', 'stream-info')
                        and error.get('code') in ('503', 'TIMEOUT')
                        or action == 'ack' and error.get('stage') == 'consumer-next'
                        and error.get('code') == '503'):
                    with (root/'startup-api-refusals.jsonl').open('a') as handle:
                        handle.write(json.dumps(error)+'\n')
                    return False
            self.assertEqual(result.returncode, 0, result.stderr.replace(token, '[owned token omitted]'))
            return json.loads(result.stdout) if action in ('create', 'read', 'read-local', 'leader') else True
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
                    meta = [report['meta_cluster'] for i, report in enumerate(js)
                            if report.get('meta_cluster', {}).get('leader') == f'owned-raft-{i}']
                    if (len(meta) == 1 and meta[0].get('cluster_size') == 3
                            and len(meta[0].get('replicas', [])) == 2
                            and all(peer.get('current') for peer in meta[0]['replicas'])
                            and all(len({route['remote_id'] for route in report['routes']}) == 2
                                    for report in routes) and client('ready', startup=True)):
                        break
                except Refused:
                    pass
                time.sleep(.05)
            else:
                (root/'readiness-refused.json').write_text(json.dumps({'jsz': js, 'routes': routes}, indent=2))
                self.fail('owned cluster failed readiness')
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                creation = client('create', startup=True)
                if creation:
                    break
                time.sleep(.05)
            else:
                self.fail('owned placement did not become ready')
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
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if client('ack', startup=True, port=ports[leader*3]):
                    break
                time.sleep(.05)
            else:
                self.fail('owned durable did not become ready for delivery')
            original_message = client('read')
            self.assertEqual(original_message, {'seq': 1, 'subject': 'history', 'data': 'preserved'})
            previous = None
            stable_since = None
            before = None
            last_refusal = None
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                try:
                    before = [capture(ports[i*3+1]) for i in range(3)]
                except Refused as error:
                    last_refusal = str(error)
                    previous = None
                    stable_since = None
                    time.sleep(.05)
                    continue
                groups = [report['raft'] for report in before]
                elected = all('$G' in report['raft']
                              and len(report['raft']['$G']) >= 2
                              and all(node['leader'] for node in report['raft']['$G'].values())
                              for report in before)
                if elected and groups == previous:
                    if stable_since is None:
                        stable_since = time.monotonic()
                    if time.monotonic() - stable_since >= 1:
                        break
                else:
                    stable_since = None
                previous = groups
                time.sleep(.05)
            else:
                (root/'raft-readiness-refused.json').write_text(json.dumps({
                    'last_observation': before, 'last_refusal': last_refusal
                }, indent=2))
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
            after = None
            while time.monotonic() < deadline:
                try:
                    after = [capture(ports[i*3+1]) for i in range(3)]
                except Refused:
                    time.sleep(.05)
                    continue
                if all(report['raft']['$G'] != before[i]['raft']['$G'] for i, report in enumerate(after)):
                    break
                time.sleep(.05)
            else:
                self.fail(f'owned stream election did not change observed account groups: {after}')
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
        corruption = os.environ.get('RECOVERY_CORRUPT_RESTORE')
        post_baseline_damage = bool(corruption and corruption.startswith('junk-raft-'))
        if post_baseline_damage:
            stopped_raft_files = [self.raft_files(root/f'store-{i}') for i in range(3)]
        if corruption == '1' or corruption in ('single-0', 'single-1', 'single-2'):
            targets = range(3) if corruption == '1' else (int(corruption[-1]),)
            for i in targets:
                block = root/f'store-{i}'/'jetstream'/'$G'/'streams'/'HISTORY'/'msgs'/'1.blk'
                content = block.read_bytes()
                self.assertIn(b'preserved', content)
                block.write_bytes(content.replace(b'preserved', b'corrupted'))
        elif corruption in ('empty-1', 'empty-0-2'):
            targets = (1,) if corruption == 'empty-1' else (0, 2)
            for i in targets:
                (root/f'store-{i}'/'jetstream'/'$G'/'streams'/'HISTORY'/'msgs'/'1.blk').write_bytes(b'')
        elif corruption == 'missing-1':
            shutil.rmtree(root/'store-1'/'jetstream'/'$G'/'streams'/'HISTORY')
        elif corruption == 'missing-group-1':
            group = next(group for group in before[1]['raft']['$G'] if group.startswith('S-'))
            shutil.rmtree(root/'store-1'/'jetstream'/'$SYS'/'_js_'/group)
        elif corruption == 'missing-consumer-1':
            shutil.rmtree(root/'store-1'/'jetstream'/'$G'/'streams'/'HISTORY'/'obs'/'stable')
        elif corruption in ('empty-raft-1', 'no-raft-log-1', 'no-raft-term-1'):
            group = next(group for group in before[1]['raft']['$G'] if group.startswith('S-'))
            directory = root/'store-1'/'jetstream'/'$SYS'/'_js_'/group
            if corruption == 'empty-raft-1':
                shutil.rmtree(directory)
                directory.mkdir()
            elif corruption == 'no-raft-log-1':
                shutil.rmtree(directory/'msgs')
                shutil.rmtree(directory/'snapshots')
            else:
                (directory/'tav.idx').unlink()
        elif corruption == 'latent-hollow-raft-wal-1':
            group = next(group for group in before[1]['raft']['$G'] if group.startswith('S-'))
            directory = root/'store-1'/'jetstream'/'$SYS'/'_js_'/group
            for snapshot in (directory/'snapshots').glob('snap.*'):
                snapshot.unlink()
            for block in (directory/'msgs').glob('*.blk'):
                block.write_bytes(bytes([0xa5]) * block.stat().st_size)
            (directory/'msgs'/'index.db').unlink()
        elif corruption in ('latent-junk-raft-snapshot-1', 'junk-raft-snapshot-1', 'junk-raft-log-1',
                            'junk-raft-peers-1', 'junk-raft-vote-1'):
            group = next(group for group in before[1]['raft']['$G'] if group.startswith('S-'))
            directory = root/'store-1'/'jetstream'/'$SYS'/'_js_'/group
            if corruption.endswith('snapshot-1'):
                path = next((directory/'snapshots').glob('snap.*'))
            elif corruption == 'junk-raft-log-1':
                path = next((directory/'msgs').glob('*.blk'))
            elif corruption == 'junk-raft-peers-1':
                path = directory/'peers.idx'
            else:
                path = directory/'tav.idx'
            original = path.read_bytes()
            junk = (original[:8] + bytes([0xa5]) * (len(original) - 8)
                    if corruption == 'junk-raft-vote-1' else bytes([0xa5]) * len(original))
            self.assertTrue(original and original != junk)
            path.write_bytes(junk)
        if not post_baseline_damage:
            stopped_raft_files = [self.raft_files(root/f'store-{i}') for i in range(3)]
        candidate = copy_candidate({str(i): root/f'store-{i}' for i in range(3)}, root/'candidate')
        verified = verify_candidate(root/'candidate', candidate['copy_manifest_sha256'])
        self.assertEqual(verified['manifest_sha256'], candidate['manifest_sha256'])
        for i in range(3):
            self.assertEqual(self.raft_files(root/'candidate'/str(i)), stopped_raft_files[i],
                             f'isolated member {i} raft bytes differ from stopped baseline')
        local_states = [self.isolated_member_state(root, i, root/'candidate', before[i], after[i],
                        binary, route_password, token) for i in range(3)]
        replay_indexes = [self.replay_member_raft(root, i, root/'candidate', after[i]['raft'], binary,
                          route_password, token) for i in range(3)]
        verify_candidate(root/'candidate', candidate['copy_manifest_sha256'])
        restored_sockets = []
        for _ in range(9):
            sock = socket.socket(); sock.bind(('127.0.0.1', 0)); restored_sockets.append(sock)
        restored_ports = [sock.getsockname()[1] for sock in restored_sockets]
        self.assertFalse(set(restored_ports) & set(ports))
        restored = []
        restored_cleanup = []
        restore_proof = None
        try:
            for sock in restored_sockets:
                sock.close()
            for i in range(3):
                routes = ','.join(f'"nats://owned:{route_password}@127.0.0.1:{restored_ports[j*3+2]}"'
                                  for j in range(3) if j != i)
                config = root/f'restored-{i}.conf'
                config.write_text(f'''server_name: owned-raft-{i}
listen: 127.0.0.1:{restored_ports[i*3]}
http: 127.0.0.1:{restored_ports[i*3+1]}
authorization {{ token: "{token}" }}
jetstream {{ store_dir: "{root}/candidate/{i}" }}
cluster {{ name: owned-preservation
 listen: 127.0.0.1:{restored_ports[i*3+2]}
 authorization {{ user: owned, password: "{route_password}" }}
 routes: [{routes}]
 no_advertise: true
}}
''')
                log = open(root/f'restored-{i}.log', 'ab', buffering=0)
                proc = subprocess.Popen([binary, '--config', str(config)], stdout=log, stderr=log)
                restored.append((proc, log))
            deadline = time.monotonic() + 30
            reports = None
            while time.monotonic() < deadline:
                self.assertTrue(all(proc.poll() is None for proc, _ in restored))
                try:
                    reports = [capture(restored_ports[i*3+1]) for i in range(3)]
                    elected = all('$G' in report['raft']
                                  and len(report['raft']['$G']) >= 2
                                  and all(node['leader'] and node['committed'] == node['applied']
                                          for node in report['raft']['$G'].values())
                                  for report in reports)
                    actual_streams = sorted(json.dumps(report['streams'], sort_keys=True)
                                            for report in reports)
                    expected_streams = sorted(json.dumps(report['streams'], sort_keys=True)
                                              for report in before)
                    if elected and actual_streams == expected_streams:
                        break
                except Refused:
                    pass
                time.sleep(.05)
            else:
                (root/'restore-refused.json').write_text(json.dumps({
                    'expected': [report['streams'] for report in before],
                    'actual': [report['streams'] for report in reports] if reports else None,
                    'raft': [report['raft'] for report in reports] if reports else None
                }, indent=2))
                self.fail('isolated candidate restore did not recover the stream and consumer state')
            leaders_checked = []
            for i in range(3):
                target = f'owned-raft-{i}'
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    leader = client('leader', startup=True, port=restored_ports[i*3])
                    if leader and leader['leader'] == target:
                        break
                    if leader:
                        client('stepdown', preferred=target, port=restored_ports[i*3])
                    time.sleep(.05)
                else:
                    self.fail('restored member did not become stream leader')
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    restored_message = client('read-local', startup=True, port=restored_ports[i*3])
                    if restored_message:
                        self.assertEqual(restored_message, original_message,
                                         'restored member cannot serve the original message as leader')
                        leaders_checked.append(target)
                        break
                    time.sleep(.05)
                else:
                    self.fail('restored leader did not serve the original message')
            warnings = []
            for i in range(3):
                for line in (root/f'restored-{i}.log').read_text().splitlines():
                    if 'Error snapshotting JetStream cluster state: raft: snapshot can not be installed while catchups running' in line:
                        continue
                    if re.search(r'catchup|stream state outdated|rebuild|corrupt', line, re.I):
                        warnings.append(f'member {i}: {line}')
            self.assertFalse(warnings, f'logged repair or corruption before acceptance: {warnings}')
            restore_proof = {
                'status': candidate['status'], 'manifest_sha256': candidate['manifest_sha256'],
                'copy_manifest_sha256': candidate['copy_manifest_sha256'],
                'files': candidate['files'], 'restored_streams': len(reports[0]['streams']),
                'isolated_member_states': local_states,
                'isolated_replay_indexes': replay_indexes,
                'stopped_raft_sha256': [hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
                                        for files in stopped_raft_files],
                'restored_message_leaders': leaders_checked,
                'restored_message_sha256': hashlib.sha256(
                    original_message['data'].encode()).hexdigest(),
                'scope': 'owned isolated restore; no full-node certification'
            }
        finally:
            for i, (proc, log) in reversed(list(enumerate(restored))):
                try:
                    if proc.poll() is None:
                        proc.send_signal(signal.SIGTERM)
                    self.assertEqual(proc.wait(timeout=10), 0)
                    self.assertIn('Server Exiting', (root/f'restored-{i}.log').read_text())
                except Exception as error:
                    restored_cleanup.append({'pid': proc.pid, 'error': str(error),
                                             'forced': proc.poll() is None})
                    if proc.poll() is None:
                        proc.kill(); proc.wait(timeout=5)
                finally:
                    log.close()
            self.assertFalse(restored_cleanup, 'owned restored cluster shutdown was not normal')
        (root/'candidate-restore.json').write_text(json.dumps({
            **restore_proof, 'owned_server_cleanup': 'normal'
        }, indent=2))


if __name__ == '__main__':
    unittest.main()
