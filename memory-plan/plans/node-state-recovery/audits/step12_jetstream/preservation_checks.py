import copy
import hashlib
import http.client
import json
import os
import pathlib
import plistlib
import re
import stat
import subprocess
import time
import urllib.parse
import urllib.request


class Refused(RuntimeError):
    pass


STOP_ORDER = (
    'mesh-deploy-listener', 'workplan-viewer', 'gateway', 'health-watch', 'node-watch',
    'scheduler-heartbeat', 'consolidation-scheduler', 'observer',
    'transcript-archive', 'log-rotate', 'lane-watchdog', 'mesh-tool-discord',
    'mission-control', 'mesh-bridge', 'mesh-agent',
    'mesh-task-daemon', 'memory-daemon', 'mesh-health-publisher',
)
RESUME_ORDER = (
    'nats', 'nats-2', 'nats-3', 'mesh-task-daemon', 'memory-daemon',
    'mesh-health-publisher', 'mission-control', 'mesh-bridge', 'mesh-agent',
    'mesh-tool-discord', 'transcript-archive',
    'observer', 'log-rotate', 'lane-watchdog', 'consolidation-scheduler',
    'scheduler-heartbeat', 'node-watch', 'health-watch', 'gateway',
    'workplan-viewer', 'mesh-deploy-listener',
)
APPLE_SYSTEM_SOURCES = (
    '/System/Library/',
    '/System/Volumes/Preboot/Cryptexes/App/System/Library/',
    '/Library/Apple/System/Library/',
)
APPLE_SYSTEM_PROGRAMS = APPLE_SYSTEM_SOURCES + (
    '/System/Cryptexes/App/', '/usr/libexec/', '/usr/sbin/', '/bin/', '/sbin/',
)
AMBIENT_ENVIRONMENT = frozenset({
    'HOME', 'PATH', 'TMPDIR', 'LOGNAME', 'SHELL', 'SSH_AUTH_SOCK',
    'USER', 'XPC_FLAGS', 'XPC_SERVICE_NAME', 'OSLogRateLimit',
})
LOADER_ENVIRONMENT = frozenset({
    'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME',
    'PYTHONINSPECT', 'PYTHONSTARTUP', 'BASH_ENV', 'ENV', 'ZDOTDIR',
})


def verify_environment_hashes(actual, declared):
    expected = {key: hashlib.sha256(value.encode()).hexdigest()
                for key, value in declared.items()}
    require(not (set(actual) & LOADER_ENVIRONMENT)
            and not any(key.startswith(('DYLD_', 'LD_')) for key in actual),
            'loaded environment contains a code loader')
    require(set(actual) <= set(expected) | AMBIENT_ENVIRONMENT,
            'loaded environment contains an undeclared variable')
    require(all(actual.get(key) == digest for key, digest in expected.items()),
            'loaded environment differs from approved declaration')


def launchctl_blocks(text):
    lines = text.split('\n')
    blocks = []
    position = 0
    stack = []
    for line in lines:
        opened = re.fullmatch(r'([ \t]*)[^{}\n]+ (?:=|=>) \{', line)
        closed = re.fullmatch(r'([ \t]*)\}', line)
        if opened:
            stack.append(opened[1])
        elif closed:
            require(stack and stack.pop() == closed[1],
                    'launchd output has an unmatched section boundary')
    require(not stack, 'launchd output has an unterminated section')
    while position < len(lines):
        header = re.fullmatch(r'([ \t]*)([^{}\n]+) = \{', lines[position])
        if header is None:
            position += 1
            continue
        indentation, name = header.groups()
        if name != 'arguments' and not name.endswith('environment'):
            position += 1
            continue
        body = []
        position += 1
        while position < len(lines) and lines[position] != indentation + '}':
            body.append(lines[position])
            position += 1
        require(position < len(lines), 'launchd section is unterminated: ' + name)
        blocks.append((name, indentation, body))
        position += 1
    return blocks


def launchctl_rows(indentation, body, name):
    if not body:
        return []
    prefix = indentation + ('\t' if body[0].startswith(indentation + '\t') else '  ')
    require(all(row.startswith(prefix) for row in body),
            'launchd ' + name + ' contains an unparsed line')
    return [row[len(prefix):] for row in body]


def launchctl_arguments(text):
    sections = [(indentation, body) for name, indentation, body in launchctl_blocks(text)
                if name == 'arguments']
    require(len(sections) <= 1, 'launchd arguments occur more than once')
    return launchctl_rows(*sections[0], 'arguments') if sections else []


def launchctl_environment(text):
    sections = [(name, indentation, body) for name, indentation, body in launchctl_blocks(text)
                if name.endswith('environment')]
    environment = {}
    order = {'inherited environment': 0, 'default environment': 1, 'environment': 2}
    variable_row = re.compile(r'[ \t]*[A-Za-z_][A-Za-z0-9_]* => .*')
    visible_rows = sum(bool(variable_row.fullmatch(line)) for line in text.split('\n'))
    section_rows = sum(bool(variable_row.fullmatch(line)) for _, _, body in sections for line in body)
    require(visible_rows == section_rows,
            'launchd environment contains a variable outside its section')
    require(len(sections) == len({name for name, _, _ in sections})
            and all(name in order for name, _, _ in sections)
            and [order[name] for name, _, _ in sections]
                == sorted(order[name] for name, _, _ in sections),
            'launchd environment contains a duplicate or unknown section')
    for name, indentation, body in sections:
        within = set()
        for line in launchctl_rows(indentation, body, name):
            entry = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*) => (.*)', line)
            require(entry is not None and entry[1] not in within,
                    'launchd environment contains an unparsed or duplicate variable')
            within.add(entry[1])
            environment[entry[1]] = entry[2]
    return environment


def protected_system_path(path, roots):
    try:
        original = pathlib.Path(path)
        if not original.is_absolute():
            return False
        for component in (original, *original.parents):
            info = component.lstat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                return False
        resolved = original.resolve(strict=True)
        if not any(str(resolved).startswith(root) for root in roots):
            return False
        for component in (resolved, *resolved.parents):
            info = component.stat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                return False
        return True
    except (OSError, ValueError):
        return False


def apple_system_source(source, program=''):
    return (protected_system_path(source, APPLE_SYSTEM_SOURCES)
            and protected_system_path(program, APPLE_SYSTEM_PROGRAMS))


def production_entrypoint_roots(home=None):
    home = pathlib.Path(home or pathlib.Path.home())
    return (home / 'openclaw-nodedev', home / '.openclaw', home / 'openclaw',
            home / '.npm-global/lib/node_modules/openclaw', home / '.codex/worktrees',
            home / 'Documents/openclaw infrastructure/companion-bridge',
            pathlib.Path('/usr/local/lib/node_modules/openclaw'),
            pathlib.Path('/opt/homebrew/lib/node_modules/openclaw'))


def suspicious_hardlink(path, source, label):
    if apple_system_source(source, path):
        return False
    if label.startswith('application.') and '.app/Contents/MacOS/' in str(path):
        return False
    try:
        info = pathlib.Path(path).stat()
        return stat.S_ISREG(info.st_mode) and info.st_nlink > 1
    except OSError:
        return False


def relevant_entrypoint(label, values, roots, home=None, environment=None,
                        working_directory=None, source=None):
    if label.startswith(('ai.openclaw.', 'com.openclaw.')):
        return True
    home = str(pathlib.Path(home or pathlib.Path.home()))
    environment = {'HOME': home, **(environment or {})}
    def expand(value):
        expanded = value
        for _ in range(5):
            changed = re.sub(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)',
                lambda match: environment.get(match[1] or match[2], match[0]), expanded)
            if changed == expanded:
                break
            expanded = changed
        return re.sub(r'(?<![A-Za-z0-9_/])~(?=/)', home, expanded)
    cwd = pathlib.Path(expand(working_directory)) if isinstance(working_directory, str) else None
    for value in values:
        if not isinstance(value, str):
            continue
        expanded = expand(value)
        for root in roots:
            if str(root) in expanded:
                return True
        for token in re.findall(r'[^\s"\'`;,|&()]+', expanded):
            candidate = pathlib.Path(token)
            if not candidate.is_absolute() and cwd is not None and '/' in token:
                candidate = cwd / candidate
            if not candidate.is_absolute():
                continue
            resolved = candidate.resolve(strict=False)
            if any(resolved == root or root in resolved.parents for root in roots):
                return True
            if suspicious_hardlink(candidate, source, label):
                return True
    return False


def unclassified_executable(program, arguments, source, label):
    executable = program or (arguments[0] if arguments else '')
    name = pathlib.Path(executable).name
    if apple_system_source(source, executable):
        return False
    if (name in {'sh', 'bash', 'zsh', 'env', 'osascript', 'npm', 'npx', 'bun', 'deno',
                 'caffeinate', 'nice', 'nohup', 'arch', 'xcrun'}
            or re.fullmatch(r'(?:node|nodejs|python|ruby|perl|php)(?:[0-9]+(?:\.[0-9]+)*)?', name)):
        return True
    return suspicious_hardlink(executable, source, label)


def installed_entrypoints(directory, protected_roots):
    roots = tuple({pathlib.Path(root).resolve(strict=False) for root in protected_roots})
    found = {}
    directories = (directory,) if isinstance(directory, (str, pathlib.Path)) else directory
    paths = []
    for item in directories:
        folder = pathlib.Path(item)
        require(folder.is_dir(), 'LaunchAgent inventory directory is missing: ' + str(folder))
        try:
            paths.extend(path for path in folder.iterdir() if path.name.endswith('.plist'))
        except OSError as error:
            raise Refused('LaunchAgent inventory directory cannot be read: ' + str(folder)) from error
    for path in paths:
        try:
            plist = plistlib.loads(path.read_bytes())
        except (OSError, ValueError, TypeError) as error:
            raise Refused('installed LaunchAgent plist cannot be read: ' + path.name) from error
        require(isinstance(plist, dict), 'installed LaunchAgent plist is not a dictionary: ' + path.name)
        if not plist:
            continue
        label = plist.get('Label')
        require(isinstance(label, str), 'installed launchd job lacks a label: ' + path.name)
        values = plist.get('ProgramArguments', [])
        location = plist.get('WorkingDirectory', '')
        environment = plist.get('EnvironmentVariables', {})
        scan = [plist.get('Program'), location]
        if isinstance(values, list):
            scan.extend(values)
        relevant = (not apple_system_source(path, plist.get('Program'))
                    or relevant_entrypoint(label, scan, roots,
                                           environment=environment if isinstance(environment, dict) else {},
                                           working_directory=location, source=path)
                    or unclassified_executable(plist.get('Program'),
                                               values if isinstance(values, list) else [], path, label))
        if not relevant:
            continue
        require(isinstance(values, list) and all(isinstance(value, str) for value in values),
                'installed launchd job has invalid arguments: ' + path.name)
        require(label not in found and not path.is_symlink(),
                'installed launchd job has ambiguous identity: ' + path.name)
        found[label] = str(path.resolve(strict=True))
    return found


def inert_entrypoint_artifacts(directories):
    found = {}
    for item in directories:
        folder = pathlib.Path(item)
        require(folder.is_dir(), 'LaunchAgent artifact directory is missing: ' + str(folder))
        for path in folder.glob('*.plist'):
            try:
                raw = path.read_bytes()
                plist = plistlib.loads(raw)
            except (OSError, ValueError, TypeError) as error:
                raise Refused('installed LaunchAgent plist cannot be read: ' + path.name) from error
            if plist == {}:
                require(not path.is_symlink(), 'inert LaunchAgent artifact is a symlink: ' + path.name)
                found[str(path.resolve(strict=True))] = hashlib.sha256(raw).hexdigest()
    return found


def disabled_entrypoint_artifacts(directories):
    found = {}
    paths = []
    for item in directories:
        folder = pathlib.Path(item)
        require(folder.is_dir(), 'LaunchAgent artifact directory is missing: ' + str(folder))
        try:
            paths.extend(path for path in folder.iterdir() if path.name.endswith('.plist.disabled'))
        except OSError as error:
            raise Refused('LaunchAgent artifact directory cannot be read: ' + str(folder)) from error
    for path in paths:
        try:
            raw = path.read_bytes()
            label = plistlib.loads(raw).get('Label')
        except (OSError, ValueError, TypeError, AttributeError) as error:
            raise Refused('disabled LaunchAgent artifact cannot be read: ' + path.name) from error
        if not isinstance(label, str) or not label.startswith(('ai.openclaw.', 'com.openclaw.')):
            continue
        require(path.name == label + '.plist.disabled' and not path.is_symlink()
                and str(path) not in found, 'disabled OpenClaw artifact has ambiguous identity')
        found[str(path)] = hashlib.sha256(raw).hexdigest()
    return found


def loaded_entrypoints(domain_text, domain, protected_roots, inspect=None, include_identity=False,
                       approved_labels=None):
    match = re.search(r'^\s*services = \{\n(.*?)^\s*\}', domain_text, re.M | re.S)
    require(match is not None, 'launchd domain lacks a services inventory')
    roots = tuple({pathlib.Path(root).resolve(strict=False) for root in protected_roots})
    require_header = inspect is None
    inspect = inspect or (lambda label: subprocess.check_output(
        ['/bin/launchctl', 'print', domain + '/' + label], text=True, timeout=10))
    labels = set()
    identities = {}
    seen = set()
    for line in match[1].splitlines():
        row = re.fullmatch(r'\s*\d+\s+\S+\s+([A-Za-z0-9._:@/+\-]+)\s*', line)
        require(row is not None, 'launchd services inventory contains an unparsed job')
        label = row[1]
        require(label not in seen, 'launchd services inventory contains a duplicate job')
        seen.add(label)
        try:
            service_text = inspect(label)
        except (OSError, subprocess.SubprocessError) as error:
            raise Refused('loaded launchd service cannot be inspected: ' + label) from error
        if require_header:
            require(service_text.startswith(domain + '/' + label + ' = {\n'),
                    'launchd service inspection identity differs: ' + label)
        lines = service_text.splitlines()[1:] if require_header else service_text.splitlines()
        header = []
        for line in lines:
            if re.fullmatch(r'[ \t]*[^{}\n]+ (?:=|=>) \{', line):
                break
            header.append(line)
        fields = {}
        field_prefix = '\t' if require_header else ''
        for key in ('path', 'program', 'working directory'):
            field = re.escape(field_prefix + key) + r' = (.+)'
            matches = re.findall(r'^' + field + r'$', service_text, re.M)
            require(len(matches) <= 1, 'launchd service has a duplicate ' + key + ': ' + label)
            top = [match[1] for line in header
                   if (match := re.fullmatch(field, line))]
            if top:
                fields[key] = top[0]
        source = fields.get('path', '')
        program = fields.get('program', '')
        if approved_labels is not None and label not in approved_labels:
            if not apple_system_source(source, program):
                labels.add(label)
                identities[label] = {'unclassified': True, 'source': source, 'program': program}
            continue
        values = list(fields.values())
        argv = launchctl_arguments(service_text)
        values.extend(argv)
        environment = launchctl_environment(service_text)
        relevant = (relevant_entrypoint(label, [*values, *environment.values()], roots,
                                        environment=environment,
                                        working_directory=fields.get('working directory'), source=source)
                    or unclassified_executable(program, argv, source, label))
        if relevant or not apple_system_source(source, program):
            labels.add(label)
            identities[label] = {
                'source': source,
                'program': program,
                'working_directory': fields.get('working directory', ''),
                'arguments_sha256': hashlib.sha256(json.dumps(argv, separators=(',', ':')).encode()).hexdigest(),
                'environment_sha256': {key: hashlib.sha256(value.encode()).hexdigest()
                                       for key, value in sorted(environment.items())},
            }
    return identities if include_identity else labels


def verify_entrypoint_inventory(installed, gui_loaded, user_loaded, system_loaded, expected,
                                roots=(), disabled_artifacts=None, inert_artifacts=None,
                                loaded_identity=None):
    expected = {'ai.openclaw.' + unit for unit in expected}
    require(set(installed) == expected, 'installed launchd jobs differ from the approved cohort')
    require(gui_loaded <= expected and user_loaded <= expected and system_loaded <= expected,
            'unclassified launchd job is loaded')
    require(not (gui_loaded & user_loaded or gui_loaded & system_loaded or user_loaded & system_loaded),
            'OpenClaw job is loaded in two launchd domains')
    if loaded_identity is not None:
        require(set(loaded_identity) == {'gui', 'user', 'system'}
                and all(set(loaded_identity[domain]) == labels for domain, labels in (
                    ('gui', gui_loaded), ('user', user_loaded), ('system', system_loaded))),
                'loaded launchd identity does not cover every job')
        for domain, entries in loaded_identity.items():
            for label, identity in entries.items():
                if label in expected:
                    require(identity['source'] == installed[label],
                            'approved loaded job differs from its installed plist: ' + domain + '/' + label)
                    plist = plistlib.loads(pathlib.Path(installed[label]).read_bytes())
                    arguments = plist['ProgramArguments']
                    declared = plist.get('EnvironmentVariables', {})
                    verify_environment_hashes(identity['environment_sha256'], declared)
                    require(identity['program'] == plist.get('Program', arguments[0])
                            and identity['working_directory'] == plist.get('WorkingDirectory', '')
                            and identity['arguments_sha256'] == hashlib.sha256(
                                json.dumps(arguments, separators=(',', ':')).encode()).hexdigest(),
                            'approved loaded job configuration differs from its plist: ' + domain + '/' + label)
    return {'verified': True,
            'installed': {label: {'path': path,
                                  'sha256': hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()}
                          for label, path in sorted(installed.items())},
            'loaded': {'gui': sorted(gui_loaded), 'user': sorted(user_loaded),
                       'system': sorted(system_loaded)},
            'loaded_identity': loaded_identity or {'gui': {}, 'user': {}, 'system': {}},
            'roots': sorted(str(pathlib.Path(root).resolve(strict=False)) for root in roots),
            'disabled_artifacts': dict(sorted((disabled_artifacts or {}).items())),
            'inert_artifacts': dict(sorted((inert_artifacts or {}).items()))}


def capture_entrypoint_inventory(expected):
    home = pathlib.Path.home()
    directories = (home / 'Library/LaunchAgents', pathlib.Path('/Library/LaunchAgents'),
                   pathlib.Path('/Library/LaunchDaemons'))
    roots = production_entrypoint_roots(home)
    installed = installed_entrypoints(directories, roots)
    disabled = disabled_entrypoint_artifacts(directories)
    inert = inert_entrypoint_artifacts(directories)
    domains = ('gui/' + str(os.getuid()), 'user/' + str(os.getuid()), 'system')
    approved = {'ai.openclaw.' + unit for unit in expected}
    identities = [loaded_entrypoints(subprocess.check_output(['/bin/launchctl', 'print', domain],
                  text=True, timeout=10), domain, roots, include_identity=True,
                  approved_labels=approved) for domain in domains]
    loaded = [set(entries) for entries in identities]
    evidence = verify_entrypoint_inventory(installed, *loaded, expected,
                                           roots=roots, disabled_artifacts=disabled,
                                           inert_artifacts=inert,
                                           loaded_identity=dict(zip(('gui', 'user', 'system'), identities)))
    again = installed_entrypoints(directories, roots)
    require(again == installed and all(hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
            == evidence['installed'][label]['sha256'] for label, path in again.items()),
            'installed entrypoint changed during preflight')
    require(inert_entrypoint_artifacts(directories) == inert,
            'inert entrypoint artifact changed during preflight')
    return evidence


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def http_json(port, path, timeout=2):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=timeout) as response:
            return json.load(response)
    except (OSError, ValueError, http.client.HTTPException) as error:
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
    if before.get('cluster'):
        for account in js.get('account_details', []):
            groups = get('/raftz?acc=' + urllib.parse.quote(account['id'], safe=''))
            require(set(groups) <= {account['id']}, 'unexpected Raft account')
            raft.update(groups)
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
        if before['config'].get('max_age', 0) <= 0:
            require(after['state'] == before['state'], 'non-expiring stream changed')
            continue
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


def verify_completion(service, segment, descendants, listeners, killed=False,
                      startup_segment=None, termination=None, bus_client_names=None):
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
        if service == 'mesh-deploy-listener':
            require(isinstance(startup_segment, str), 'current listener startup log is absent')
            if '═══ Ready ═══' not in startup_segment:
                require(termination == {'signal': 15}, 'unready listener did not receive default SIGTERM')
                require(markers[service] not in segment, 'unready listener unexpectedly registered a handler')
                require(bus_client_names is not None and not any(name.startswith('deploy-listener-')
                        for name in bus_client_names), 'unready listener has a bus connection or lacks inventory')
            else:
                require(segment.count(markers[service]) == 1, 'normal completion marker missing or repeated')
        else:
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
