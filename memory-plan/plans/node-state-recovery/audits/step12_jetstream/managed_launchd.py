import ctypes
import hashlib
import os
import pathlib
import plistlib
import re
import select
import struct
import subprocess
import time

from preservation_checks import (Refused, launchctl_arguments, require,
                                 verify_completion, verify_environment_hashes, verify_timer_idle)


EXIT_FLAGS = 0x84000000
CHANGE_FLAGS = 0x60000000


def command(argv, timeout=10):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, 'inspection or managed action failed: ' + pathlib.Path(argv[0]).name)
    return result.stdout


def process_exists(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def decode_process_arguments(data):
    argc = struct.unpack_from('i', data)[0]
    offset = data.index(b'\0', 4) + 1
    while offset < len(data) and data[offset] == 0:
        offset += 1
    argv = []
    for _ in range(argc):
        end = data.index(b'\0', offset)
        argv.append(data[offset:end].decode())
        offset = end + 1
    environment = {}
    for item in data[offset:].split(b'\0'):
        if not item:
            break
        if b'=' in item:
            name, value = item.split(b'=', 1)
            environment[name.decode()] = hashlib.sha256(value).hexdigest()
    return argv, environment


def process_arguments(pid):
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    mib = (ctypes.c_int * 3)(1, 49, pid)
    size = ctypes.c_size_t()
    require(library.sysctl(mib, 3, None, ctypes.byref(size), None, 0) == 0, 'process argv unavailable')
    buffer = ctypes.create_string_buffer(size.value)
    require(library.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) == 0, 'process argv changed or unavailable')
    return decode_process_arguments(buffer.raw[:size.value])


def process_argv(pid):
    return process_arguments(pid)[0]


class BSDInfo(ctypes.Structure):
    _fields_ = [('values', ctypes.c_uint32 * 12), ('comm', ctypes.c_char * 16),
                ('name', ctypes.c_char * 32), ('fields', ctypes.c_uint32 * 6),
                ('start_seconds', ctypes.c_uint64), ('start_microseconds', ctypes.c_uint64)]


def process_info(pid):
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    info = BSDInfo()
    require(library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info)) == ctypes.sizeof(info),
            'process start identity unavailable')
    return {'pid': info.values[3], 'state': info.values[1],
            'start_ns': info.start_seconds * 1000000000 + info.start_microseconds * 1000}


def running_identity(pid, executable, files, declared_environment):
    started = process_info(pid)
    require(started['state'] != 5, 'service owner is a zombie')
    argv, environment = process_arguments(pid)
    verify_environment_hashes(environment, declared_environment)
    pins = {}
    for path, expected_hash in files.items():
        info = pathlib.Path(path).stat()
        require(info.st_ctime_ns <= started['start_ns'], 'identity file changed after process startup')
        digest = hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
        require(digest == expected_hash, 'identity file differs from approved bytes')
        pins[path] = {'sha256': digest, 'device': info.st_dev, 'inode': info.st_ino,
                      'ctime_ns': info.st_ctime_ns}
    text = command(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'txt', '-FDin'])
    entries, current = [], {}
    for line in text.splitlines():
        if line.startswith('f'):
            current = {}
            entries.append(current)
        elif line.startswith('D'):
            current['device'] = int(line[1:], 16)
        elif line.startswith('i'):
            current['inode'] = int(line[1:])
        elif line.startswith('n'):
            current['name'] = line[1:]
    binary = pins[executable]
    require(any(row.get('name') == executable and row.get('device') == binary['device']
                and row.get('inode') == binary['inode'] for row in entries),
            'running executable text inode differs from approved file')
    current = process_info(pid)
    require(current['pid'] == started['pid'] and current['start_ns'] == started['start_ns']
            and current['state'] != 5, 'process generation changed during identity inspection')
    return {'process': {key: started[key] for key in ('pid', 'start_ns')},
            'files': pins, 'environment_sha256': environment, 'argv': argv}


def process_executable(pid):
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    buffer = ctypes.create_string_buffer(4096)
    require(library.proc_pidpath(pid, buffer, len(buffer)) > 0, 'process executable unavailable')
    return str(pathlib.Path(buffer.value.decode()).resolve(strict=True))


def process_cwd(pid):
    output = command(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'])
    names = [line[1:] for line in output.splitlines() if line.startswith('n')]
    require(len(names) == 1, 'process working directory is ambiguous')
    return str(pathlib.Path(names[0]).resolve(strict=True))


def process_tree(owner, group=None):
    rows = {}
    for line in command(['/bin/ps', '-axo', 'pid=,ppid=,pgid=']).splitlines():
        pid, parent, process_group = map(int, line.split())
        rows[pid] = {'parent': parent, 'group': process_group}
    require(owner in rows or group is not None, 'service owner disappeared')
    group = rows[owner]['group'] if group is None else group
    descendants = {owner} if owner in rows else set()
    while True:
        found = {pid for pid, row in rows.items() if row['parent'] in descendants}
        if found <= descendants:
            break
        descendants |= found
    descendants |= {pid for pid, row in rows.items() if row['group'] == group}
    return {pid: rows[pid] for pid in descendants}


def log_offsets(paths):
    result = {}
    for path in set(paths):
        path = pathlib.Path(path)
        info = path.stat()
        result[str(path)] = {'device': info.st_dev, 'inode': info.st_ino, 'size': info.st_size}
    return result


def log_segment(offsets):
    pieces = []
    for name, before in offsets.items():
        path = pathlib.Path(name)
        info = path.stat()
        require((info.st_dev, info.st_ino) == (before['device'], before['inode'])
                and info.st_size >= before['size'], 'service log rotated across stop')
        with path.open('rb') as handle:
            handle.seek(before['size'])
            pieces.append(handle.read().decode('utf8', 'replace'))
    return '\n'.join(pieces)


class Launchd:
    def __init__(self, label, plist):
        require(re.fullmatch(r'ai\.openclaw\.[A-Za-z0-9._-]+', label), 'unexpected service label')
        self.label = label
        self.target = 'gui/' + str(os.getuid()) + '/' + label
        self.plist = pathlib.Path(plist)

    def status(self, domain='gui'):
        target = domain + '/' + str(os.getuid()) + '/' + self.label
        result = subprocess.run(['/bin/launchctl', 'print', target], capture_output=True, text=True)
        if result.returncode:
            require(result.returncode == 113 and 'Could not find service' in result.stderr,
                    'managed unit inspection failed')
            return {'loaded': False, 'running': False, 'pid': None}
        result = result.stdout
        values = {'loaded': True, 'running': False, 'pid': None}
        for key, field in (('pid', 'pid'), ('runs', 'runs'), ('last exit code', 'last_exit_code'),
                           ('exit timeout', 'exit_timeout')):
            match = re.search(r'^\s*' + re.escape(key) + r' = (\d+)$', result, re.M)
            if match:
                values[field] = int(match[1])
        values['running'] = values['pid'] is not None
        return values

    def bind(self, expected_argv, executable, cwd, identity_files=None):
        before = self.status()
        require(before['loaded'] and before['running'], 'service is not running')
        pid = before['pid']
        require(process_argv(pid) == expected_argv, 'running process argv does not match approved entry')
        require(process_executable(pid) == str(pathlib.Path(executable).resolve(strict=True)),
                'running executable differs from approved binary')
        require(process_cwd(pid) == str(pathlib.Path(cwd).resolve(strict=True)), 'running cwd differs')
        plist = plistlib.loads(self.plist.read_bytes())
        loaded = self.configuration()
        require(loaded['path'] == str(self.plist.resolve(strict=True)),
                'loaded plist provenance differs from approved file')
        require(loaded['arguments'] == plist['ProgramArguments'], 'loaded arguments differ from approved plist')
        approved_program = plist.get('Program', plist['ProgramArguments'][0])
        require(loaded['program'] == str(pathlib.Path(approved_program).resolve(strict=True)),
                'loaded program differs from approved plist')
        executable = str(pathlib.Path(executable).resolve(strict=True))
        paths = {self.plist.resolve(strict=True), pathlib.Path(executable)}
        paths.update(pathlib.Path(arg).resolve(strict=True) for arg in expected_argv
                     if arg and pathlib.Path(arg).is_absolute() and pathlib.Path(arg).is_file())
        files = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
        files.update(identity_files or {})
        identity = running_identity(pid, executable, files, plist.get('EnvironmentVariables', {}))
        tree = process_tree(pid)
        require(self.status() == before, 'service generation changed during binding')
        return {'status': before, 'tree': tree, 'argv': expected_argv,
                'executable': executable, 'cwd': process_cwd(pid), 'identity': identity,
                'logs': loaded['logs']}

    def configuration(self):
        text = command(['/bin/launchctl', 'print', self.target])
        def field(name):
            match = re.search(r'^\s*' + re.escape(name) + r' = (.+)$', text, re.M)
            require(match is not None, 'loaded job lacks ' + name)
            return match[1]
        arguments = launchctl_arguments(text)
        require(arguments, 'loaded job lacks arguments')
        return {'path': str(pathlib.Path(field('path')).resolve(strict=True)),
                'program': str(pathlib.Path(field('program')).resolve(strict=True)),
                'arguments': arguments,
                'logs': sorted({str(pathlib.Path(field(name)).resolve(strict=True))
                                for name in ('stdout path', 'stderr path')})}

    def bootstrap(self):
        require(not self.status()['loaded'], 'refusing to bootstrap an existing owner')
        require(not self.status('user')['loaded'], 'refusing to bootstrap an owner in another domain')
        command(['/bin/launchctl', 'bootstrap', 'gui/' + str(os.getuid()), str(self.plist)])

    def kickstart(self):
        require(self.status()['loaded'] and not self.status()['running'], 'refusing to restart an existing owner')
        command(['/bin/launchctl', 'kickstart', self.target])


class StopWatch:
    def __init__(self, service, binding, paths, completion_service, allowed_signals=(),
                 startup_segment=None, bus_client_names=None, process_contracts=None):
        self.service = service
        self.binding = binding
        require(sorted({str(pathlib.Path(path).resolve(strict=True)) for path in paths}) == binding['logs'],
                'stop log paths differ from actual loaded job')
        self.offsets = log_offsets(paths)
        self.completion_service = completion_service
        owner = binding['status']['pid']
        self.contracts = process_contracts or {
            pid: {'role': 'owner' if pid == owner else 'descendant-or-group-member',
                  'allowed_signals': list(allowed_signals) if pid == owner else []}
            for pid in binding['tree']}
        require(set(self.contracts) == set(binding['tree']), 'process termination contracts are incomplete')
        require(all(set(item) == {'role', 'allowed_signals'} and isinstance(item['role'], str)
                    and 9 not in item['allowed_signals'] for item in self.contracts.values()),
                'invalid process termination contract')
        self.startup_segment = startup_segment
        self.bus_client_names = bus_client_names
        self.events = {}
        self.lifecycle = []
        self.kernel_events = []
        self.bootout = None
        self.file_handles = {}
        self.prepared = False
        self.group = binding['tree'][owner]['group']
        require(isinstance(binding['status'].get('exit_timeout'), int) and binding['status']['exit_timeout'] > 0,
                'loaded finite exit timeout unavailable')
        self.queue = select.kqueue()
        try:
            events = [select.kevent(pid, filter=select.KQ_FILTER_PROC,
                       flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_CLEAR,
                       fflags=EXIT_FLAGS | CHANGE_FLAGS) for pid in binding['tree']]
            returned = self.queue.control(events, len(events), 0)
            self.record_kernel(returned, 'register-process')
            require(not returned, 'owner exited before durable stop intent')
            require(service.status() == binding['status'], 'service generation changed before stop')
            for path in binding['identity']['files']:
                fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
                self.file_handles[fd] = path
            returned = self.queue.control([select.kevent(fd, filter=select.KQ_FILTER_VNODE,
                flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_CLEAR,
                fflags=0x7f) for fd in self.file_handles], len(self.file_handles), 0)
            self.record_kernel(returned, 'register-identity')
            require(not returned, 'identity file changed while preparing watch')
            current = self.service.bind(binding['argv'], binding['executable'], binding['cwd'],
                        {path: pin['sha256'] for path, pin in binding['identity']['files'].items()})
            require(current['identity'] == binding['identity'] and current['logs'] == binding['logs'],
                    'running code, environment or log identity changed')
            self.prepared = True
            self.ready_for_intent()
        except BaseException as error:
            self.retain_error(error)
            self.close()
            raise

    def failure_evidence(self, error):
        evidence = {'kernel_events': list(self.kernel_events),
                    'lifecycle': list(self.lifecycle),
                    'exits': {str(pid): event for pid, event in self.events.items()},
                    'bootout': self.bootout}
        error.stop_evidence = evidence
        return evidence

    def retain_error(self, error):
        self.failure_evidence(error)

    def record_kernel(self, events, phase):
        for event in events:
            self.kernel_events.append({'phase': phase, 'filter': event.filter,
                'ident': event.ident, 'flags': event.flags, 'fflags': event.fflags,
                'data': event.data, 'observed_monotonic_ns': time.monotonic_ns()})
        errors = [event for event in events if event.flags & select.KQ_EV_ERROR]
        if errors:
            error = Refused('kernel watch error: ' + ','.join(str(event.data) for event in errors))
            self.retain_error(error)
            raise error

    def drain(self, timeout=0):
        owner = self.binding['status']['pid']
        returned = self.queue.control(None, max(1, len(self.binding['tree']) + len(self.file_handles)), timeout)
        self.record_kernel(returned, 'drain')
        owner_exits = any(item.filter == select.KQ_FILTER_PROC and item.ident == owner
                          and item.fflags & 0x80000000 for item in returned)
        for event in returned:
            if event.filter == select.KQ_FILTER_VNODE:
                require(event.ident in self.file_handles, 'unknown identity-file event')
                path = self.file_handles[event.ident]
                if event.fflags == 0x08:
                    before = self.binding['identity']['files'][path]
                    try:
                        current, opened = pathlib.Path(path).stat(), os.fstat(event.ident)
                        # Reading code can update atime without changing its approved identity.
                        if all((info.st_dev, info.st_ino, info.st_ctime_ns)
                               == (before['device'], before['inode'], before['ctime_ns'])
                               for info in (current, opened)):
                            continue
                    except OSError:
                        pass
                self.lifecycle.append({'kind': 'identity-file', 'path': self.file_handles[event.ident],
                    'flags': event.fflags, 'observed_order': len(self.lifecycle),
                    'observed_monotonic_ns': time.monotonic_ns()})
                continue
            require(event.filter == select.KQ_FILTER_PROC, 'unexpected kernel event filter')
            require(event.ident in self.binding['tree'], 'unknown process lifecycle event')
            item = {'pid': event.ident, 'flags': event.fflags,
                    'observed_order': len(self.lifecycle), 'observed_monotonic_ns': time.monotonic_ns()}
            self.lifecycle.append(item)
            if event.fflags & 0x80000000:
                require(event.ident not in self.events, 'repeated process exit')
                require(event.fflags & EXIT_FLAGS == EXIT_FLAGS, 'exit status was not returned')
                owner_alive = False
                if event.ident != owner and not owner_exits and owner not in self.events:
                    try:
                        info = process_info(owner)
                        owner_alive = info['state'] != 5 and all(info[key] == value
                                      for key, value in self.binding['identity']['process'].items())
                    except Exception:
                        owner_alive = False
                self.events[event.ident] = {**item, 'wait_status': event.data,
                                           'owner_alive_at_observation': owner_alive}

    def unchanged_lifecycle(self):
        require(not any(item.get('kind') == 'identity-file' for item in self.lifecycle),
                'identity file mutated after watch preparation')
        require(not any(item['flags'] & CHANGE_FLAGS for item in self.lifecycle),
                'process fork or exec prevents complete stop evidence')

    def ready_for_intent(self):
        require(self.prepared, 'stop watch is not prepared')
        self.drain()
        self.unchanged_lifecycle()
        require(self.service.status() == self.binding['status'], 'service generation changed before signal')
        if self.service.label == 'ai.openclaw.mesh-deploy-listener':
            require(set(self.binding['tree']) == {self.binding['status']['pid']},
                    'deploy listener has a child; wait for deployment to finish')
        for pid in self.events:
            self.normal_exit(pid)
        require(set(process_tree(self.binding['status']['pid']))
                == set(self.binding['tree']) - set(self.events),
                'process descendants or group changed before signal')

    def normal_exit(self, pid):
        event = self.events[pid]
        status = event['wait_status']
        require((os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0)
                or (os.WIFSIGNALED(status) and os.WTERMSIG(status) in self.contracts[pid]['allowed_signals']),
                'process termination violates declared normal-exit contract')
        if pid != self.binding['status']['pid']:
            require(event['owner_alive_at_observation'], 'group member exit was not observed before live owner')

    def apply(self):
        self.ready_for_intent()
        self.drain()
        self.unchanged_lifecycle()
        started = time.monotonic()
        result = subprocess.Popen(['/bin/launchctl', 'bootout', self.service.target],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        end = started + self.binding['status']['exit_timeout'] + 5
        while result.poll() is None and time.monotonic() < end:
            self.drain(.02)
        timed_out = result.poll() is None
        if timed_out:
            result.terminate()
        stdout, stderr = result.communicate(timeout=5)
        self.bootout = {'returncode': result.returncode, 'timed_out': timed_out,
                        'stdout': stdout, 'stderr': stderr,
                        'elapsed_seconds': time.monotonic() - started}

    def verify(self, connection_check, listener_check, deadline=None):
        deadline = self.binding['status']['exit_timeout'] + 5 if deadline is None else deadline
        end = time.monotonic() + deadline
        while len(self.events) < len(self.binding['tree']) and time.monotonic() < end:
            self.drain(max(0, min(.02, end - time.monotonic())))
        self.drain()
        require(set(self.events) == set(self.binding['tree']), 'service or descendant exit was not observed')
        require(not self.service.status()['loaded'], 'managed service remains loaded')
        require(self.bootout is not None and not self.bootout['timed_out'] and self.bootout['returncode'] == 0,
                'bootout did not complete successfully; exit evidence retained')
        self.unchanged_lifecycle()
        for pid, event in self.events.items():
            require(not process_exists(pid), 'service or descendant survives')
            self.normal_exit(pid)
        require(not process_tree(self.binding['status']['pid'], self.group), 'former process group survives')
        require(connection_check() is True, 'former bus connection is not normally closed')
        require(listener_check() is True, 'former process listener survives')
        owner_status = self.events[self.binding['status']['pid']]['wait_status']
        termination = {'signal': os.WTERMSIG(owner_status)} if os.WIFSIGNALED(owner_status) else {'exit': 0}
        segment = log_segment(self.offsets)
        verify_completion(self.completion_service, segment, [], [],
                          startup_segment=self.startup_segment, termination=termination,
                          bus_client_names=self.bus_client_names)
        return {'verified': True, 'owner': self.binding['status']['pid'],
                'exit_flags_requested': EXIT_FLAGS,
                'exits': {str(pid): event for pid, event in self.events.items()},
                'lifecycle': self.lifecycle, 'kernel_events': self.kernel_events,
                'bootout': self.bootout,
                'process_contracts': {str(pid): contract for pid, contract in self.contracts.items()},
                'unit_unloaded': True, 'descendants_absent': True,
                'connections_closed': True, 'listeners_absent': True,
                'log_offsets': self.offsets, 'termination': termination}

    def mutate(self, journal, unit, connection_check, listener_check):
        self.ready_for_intent()
        return journal.mutate(unit, 'stop', self.apply,
                              lambda: self.verify(connection_check, listener_check),
                              failure_evidence=self.failure_evidence)

    def close(self):
        self.queue.close()
        for fd in self.file_handles:
            os.close(fd)
        self.file_handles.clear()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        if args[1] is not None:
            self.retain_error(args[1])
        self.close()


def unload_idle_timer(service, paths, spawn_evidence=None):
    before = service.status()
    require(before['loaded'] and not before['running'], 'timer is not idle')
    loaded = service.configuration()
    require(loaded['path'] == str(service.plist.resolve(strict=True))
            and sorted({str(pathlib.Path(path).resolve(strict=True)) for path in paths}) == loaded['logs'],
            'timer plist or log provenance differs from loaded job')
    offsets = log_offsets(paths)
    require(service.status() == before, 'timer started before durable stop intent')
    def apply():
        current = service.status()
        require(current == before, 'timer started before unload')
        command(['/bin/launchctl', 'bootout', service.target])
    def verify():
        after = service.status()
        verify_timer_idle(before, after['loaded'], offsets, log_offsets(paths))
        require(spawn_evidence is not None, 'timer spawn-race evidence is absent; idle observations alone are insufficient')
        evidence = spawn_evidence()
        require(evidence['label'] == service.label and evidence['coverage_complete'] is True
                and evidence['spawns'] == [], 'timer spawned during unload or spawn evidence is incomplete')
        return {'verified': True, 'prior': before, 'unloaded': True, 'logs_unchanged': True,
                'spawn_evidence': evidence}
    return apply, verify
