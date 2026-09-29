import copy
import json
import time
import urllib.request


class Refused(RuntimeError):
    pass


STOP_ORDER = (
    'health-watch', 'mesh-deploy-listener', 'node-watch',
    'scheduler-heartbeat', 'consolidation-scheduler', 'observer',
    'transcript-archive', 'log-rotate', 'lane-watchdog', 'mesh-tool-discord',
    'mission-control', 'mesh-bridge', 'mesh-agent',
    'mesh-task-daemon', 'memory-daemon', 'mesh-health-publisher',
)
RESUME_ORDER = (
    'nats', 'nats-2', 'nats-3', 'mesh-task-daemon', 'memory-daemon',
    'mesh-health-publisher', 'mission-control', 'mesh-bridge', 'mesh-agent',
    'mesh-deploy-listener', 'mesh-tool-discord', 'transcript-archive',
    'observer', 'log-rotate', 'lane-watchdog', 'consolidation-scheduler',
    'scheduler-heartbeat', 'node-watch', 'health-watch',
)
TTL_STREAMS = {'KV_MESH_NODE_HEALTH': 120_000_000_000, 'KV_MESH_TOOLS': 120_000_000_000}


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def http_json(port, path, timeout=2):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=timeout) as response:
            return json.load(response)
    except (OSError, ValueError) as error:
        raise Refused('monitoring request failed or exceeded its deadline: ' + path) from error


def stream_state(details):
    streams = {}
    for account in details:
        for stream in account.get('stream_detail', []):
            key = account['id'] + '/' + stream['name']
            require(key not in streams, 'duplicate stream identity')
            consumers = {}
            for consumer in stream.get('consumer_detail', []):
                if not consumer['config'].get('durable_name'):
                    continue
                require(consumer['num_ack_pending'] == 0, 'durable acknowledgements pending')
                consumers[consumer['name']] = {
                    'config': consumer['config'],
                    'delivered': {k: consumer['delivered'][k] for k in ('consumer_seq', 'stream_seq')},
                    'ack_floor': {k: consumer['ack_floor'][k] for k in ('consumer_seq', 'stream_seq')},
                    'ack_pending': consumer['num_ack_pending'],
                    'redelivered': consumer['num_redelivered'],
                    'pending': consumer['num_pending'],
                }
            streams[key] = {
                'config': stream['config'],
                'state': {k: stream['state'].get(k, 0) for k in (
                    'messages', 'bytes', 'first_seq', 'last_seq', 'num_subjects', 'num_deleted')},
                'consumers': consumers,
            }
    return streams


def capture(port):
    started = time.monotonic()
    def get(path):
        remaining = 2 - (time.monotonic() - started)
        require(remaining > 0, 'monitoring observation stalled')
        return http_json(port, path, remaining)
    before = get('/varz')
    js = get('/jsz?accounts=true&streams=true&consumers=true&config=true')
    opened = get('/connz?limit=10000')
    closed = get('/connz?state=closed&limit=10000')
    routes = get('/routez')
    leaves = get('/leafz')
    gateways = get('/gatewayz')
    raft = get('/raftz') if before.get('cluster') else {}
    after = get('/varz')
    require(before['server_id'] == after['server_id'], 'server changed during observation')
    require(before['start'] == after['start'], 'server restarted during observation')
    require(before['config_digest'] == after['config_digest'], 'server configuration changed during observation')
    require(before['total_connections'] == after['total_connections'], 'admission during observation')
    for report in (js, opened, closed, routes, leaves, gateways):
        require(report['server_id'] == before['server_id'], 'mixed server identities')
    require(opened['total'] == len(opened['connections']), 'open connection inventory truncated')
    require(closed['total'] == len(closed['connections']), 'closed connection inventory truncated')
    require(after['connections'] == opened['num_connections'], 'connection count changed during observation')
    elapsed = time.monotonic() - started
    require(elapsed < 2, 'monitoring observation stalled')
    return {
        'server_id': before['server_id'], 'server_name': before['server_name'],
        'start': before['start'], 'config_digest': before['config_digest'],
        'total_connections': after['total_connections'],
        'open': {c['cid']: {'name': c.get('name'), 'port': c['port']} for c in opened['connections']},
        'closed': {c['cid']: {'name': c.get('name'), 'reason': c.get('reason')} for c in closed['connections']},
        'api': {k: js['api'][k] for k in ('total', 'errors')},
        'streams': stream_state(js.get('account_details', [])),
        'routes': sorted([{'ip': r['ip'], 'remote_id': r['remote_id'], 'rid': r['rid'],
                           'start': r['start']} for r in routes['routes']], key=lambda r: r['rid']),
        'raft': {account: {group: {k: node.get(k) for k in (
                    'id', 'state', 'leader', 'term', 'committed', 'applied', 'pterm', 'pindex')}
                    for group, node in groups.items()} for account, groups in raft.items()},
        'observation_seconds': elapsed,
        'leaves': leaves['leafnodes'],
        'gateways': bool(gateways.get('outbound_gateways') or gateways.get('inbound_gateways')),
    }


def verify_topology(report, peer_ids):
    require(report['leaves'] == 0 and not report['gateways'], 'foreign leaf or gateway')
    require(all(r['ip'] == '127.0.0.1' and r['remote_id'] in peer_ids
                for r in report['routes']), 'foreign route')


def verify_admissions(anchor, report):
    require((report['server_id'], report['start']) == (anchor['server_id'], anchor['start']),
            'server restarted inside quiet window')
    require(report['config_digest'] == anchor['config_digest'], 'server configuration changed inside quiet window')
    require(report['total_connections'] == anchor['total_connections'], 'new client admission')
    known = set(anchor['open']) | set(anchor['closed'])
    require(set(report['open']) <= set(anchor['open']), 'new open client identity')
    require(set(report['closed']) <= known, 'new closed client identity')


def verify_streams(anchor, report):
    require(set(report['streams']) == set(anchor['streams']), 'stream inventory changed')
    for key, before in anchor['streams'].items():
        after = report['streams'][key]
        require(after['config'] == before['config'], 'stream policy changed')
        require(after['consumers'] == before['consumers'], 'durable positions or policy changed')
        name = key.split('/', 1)[1]
        if name not in TTL_STREAMS:
            require(after['state'] == before['state'], 'non-expiring stream changed')
            continue
        require(before['config']['max_age'] == TTL_STREAMS[name], 'undeclared health TTL policy')
        old, new = before['state'], after['state']
        require(new['last_seq'] == old['last_seq'], 'health stream received a new message')
        require(new['messages'] <= old['messages'] and new['bytes'] <= old['bytes'],
                'health expiry increased content')
        require(new['first_seq'] >= old['first_seq'] and new['num_subjects'] <= old['num_subjects'],
                'health expiry reversed retention')


class QuietWindow:
    def __init__(self, anchors):
        self.anchors = copy.deepcopy(anchors)
        self.readings = 0
        for report in anchors.values():
            require(not report['open'], 'quiet anchor has connected clients')

    def check(self, reports, peers, retired_peers=frozenset()):
        require(set(reports) <= set(self.anchors), 'unknown monitored server')
        for name, report in reports.items():
            before = self.anchors[name]
            verify_admissions(before, report)
            require(not report['open'], 'client appeared in quiet window')
            require(report['api'] == before['api'], 'JetStream API activity after observer close')
            verify_streams(before, report)
            verify_topology(report, peers[name])
            expected_routes = [r for r in before['routes'] if r['remote_id'] not in retired_peers]
            require(report['routes'] == expected_routes, 'route identity changed inside quiet window')
            if not retired_peers:
                require(report['raft'] == before['raft'], 'Raft state changed inside quiet window')
        self.readings += 1


def verify_timer_idle(before, after_loaded, before_logs, after_logs):
    require(before['loaded'] and before.get('pid') is None, 'timer started before unload')
    require(not after_loaded, 'timer remains loaded')
    require(before_logs == after_logs, 'timer ran across unload boundary')


def verify_queue(snapshot, owner, modified_at, anchor_after, now):
    require(snapshot['pid'] == owner, 'memory queue owner changed')
    require(modified_at > anchor_after and now - modified_at < 2, 'memory queue anchor is not new and immediate')
    require(not snapshot.get('shutting_down', False), 'memory is already shutting down')
    require(snapshot['current_job'] is None and snapshot['queue_depth'] == 0
            and snapshot['external_jobs'] == [], 'memory queue is busy')


def verify_completion(service, segment, descendants, listeners, killed=False):
    require(not killed, 'forced termination is not clean completion')
    require(not descendants and not listeners, 'service child or listener survived completion')
    markers = {
        'mesh-task-daemon': 'Shutdown complete.', 'mesh-bridge': 'Bridge stopped.',
        'mesh-agent': 'Agent worker stopped.', 'memory-daemon': 'Daemon stopped',
        'health-watch': '[health-watch] shutting down', 'node-watch': '[node-watch] stopped',
        'mesh-deploy-listener': 'SIGTERM — shutting down',
        'lane-watchdog': 'Received SIGTERM, shutting down', 'nats': 'Server Exiting',
        'nats-2': 'Server Exiting', 'nats-3': 'Server Exiting',
    }
    if service in markers:
        require(segment.count(markers[service]) == 1, 'normal completion marker missing or repeated')
    require('permanently closed' not in segment and 'closing anyway' not in segment,
            'stop reported a failure or abandoned work')
    if service == 'memory-daemon':
        lowered = segment.lower()
        require(not any(s in lowered for s in (
            'extraction requested by', 'entering idle', 'starting flush',
            'starting import', 'importing sessions', 'flush started', 'import started',
            'phase 2:', 'pre-compression flush', 'end-of-session flush',
            'nats-triggered flush', 'session-store: imported')),
            'memory work started after idle anchor')


def restore_prior(prior, changed, start, ready, actual):
    records, errors = [], []
    bus_ready = True
    for name in RESUME_ORDER:
        if name not in changed:
            continue
        if not name.startswith('nats') and not bus_ready:
            errors.append({'unit': name, 'reason': 'bus restoration incomplete'})
            continue
        try:
            start(name, prior[name])
            ready(name, prior[name])
            state = actual(name)
            require(state['loaded'] == prior[name]['loaded'], 'loaded state was not restored')
            require(bool(state.get('pid')) == bool(prior[name].get('pid')), 'running state was not restored')
            records.append({'unit': name, 'verified': True, 'state': state})
        except Exception as error:
            errors.append({'unit': name, 'reason': str(error)})
            if name.startswith('nats'):
                bus_ready = False
    return {'restored': not errors, 'verified': records, 'errors': errors}
