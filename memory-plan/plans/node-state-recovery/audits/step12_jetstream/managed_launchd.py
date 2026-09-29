import ctypes
import os
import pathlib
import re
import select
import struct
import subprocess
import time

from preservation_checks import require, verify_completion, verify_timer_idle


EXIT_FLAGS = 0x84000000


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


def process_argv(pid):
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    mib = (ctypes.c_int * 3)(1, 49, pid)
    size = ctypes.c_size_t()
    require(library.sysctl(mib, 3, None, ctypes.byref(size), None, 0) == 0, 'process argv unavailable')
    buffer = ctypes.create_string_buffer(size.value)
    require(library.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) == 0, 'process argv changed or unavailable')
    data = buffer.raw[:size.value]
    argc = struct.unpack_from('i', data)[0]
    offset = data.index(b'\0', 4) + 1
    while offset < len(data) and data[offset] == 0:
        offset += 1
    return [value.decode() for value in data[offset:].split(b'\0')[:argc]]


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


def process_tree(owner):
    rows = {}
    for line in command(['/bin/ps', '-axo', 'pid=,ppid=,pgid=']).splitlines():
        pid, parent, group = map(int, line.split())
        rows[pid] = {'parent': parent, 'group': group}
    require(owner in rows, 'service owner disappeared')
    descendants = {owner}
    while True:
        found = {pid for pid, row in rows.items() if row['parent'] in descendants}
        if found <= descendants:
            break
        descendants |= found
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

    def status(self):
        result = subprocess.run(['/bin/launchctl', 'print', self.target], capture_output=True, text=True)
        if result.returncode:
            require(result.returncode == 113 and 'Could not find service' in result.stderr,
                    'managed unit inspection failed')
            return {'loaded': False, 'running': False, 'pid': None}
        result = result.stdout
        values = {'loaded': True, 'running': False, 'pid': None}
        for key, field in (('pid', 'pid'), ('runs', 'runs'), ('last exit code', 'last_exit_code')):
            match = re.search(r'^\s*' + re.escape(key) + r' = (\d+)$', result, re.M)
            if match:
                values[field] = int(match[1])
        values['running'] = values['pid'] is not None
        return values

    def bind(self, expected_argv, executable, cwd):
        before = self.status()
        require(before['loaded'] and before['running'], 'service is not running')
        pid = before['pid']
        require(process_argv(pid) == expected_argv, 'running process argv does not match approved entry')
        require(process_executable(pid) == str(pathlib.Path(executable).resolve(strict=True)),
                'running executable differs from approved binary')
        require(process_cwd(pid) == str(pathlib.Path(cwd).resolve(strict=True)), 'running cwd differs')
        tree = process_tree(pid)
        require(self.status() == before, 'service generation changed during binding')
        return {'status': before, 'tree': tree, 'argv': expected_argv,
                'executable': process_executable(pid), 'cwd': process_cwd(pid)}

    def bootstrap(self):
        require(not self.status()['loaded'], 'refusing to bootstrap an existing owner')
        command(['/bin/launchctl', 'bootstrap', 'gui/' + str(os.getuid()), str(self.plist)])

    def kickstart(self):
        require(self.status()['loaded'] and not self.status()['running'], 'refusing to restart an existing owner')
        command(['/bin/launchctl', 'kickstart', self.target])


class StopWatch:
    def __init__(self, service, binding, paths, completion_service, allowed_signals=(),
                 startup_segment=None, bus_client_names=None):
        self.service = service
        self.binding = binding
        self.offsets = log_offsets(paths)
        self.completion_service = completion_service
        self.allowed_signals = set(allowed_signals)
        self.startup_segment = startup_segment
        self.bus_client_names = bus_client_names
        self.events = {}
        self.queue = select.kqueue()
        try:
            events = [select.kevent(pid, filter=select.KQ_FILTER_PROC,
                       flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                       fflags=EXIT_FLAGS) for pid in binding['tree']]
            returned = self.queue.control(events, len(events), 0)
            require(not returned, 'owner exited before durable stop intent')
            require(service.status() == binding['status'], 'service generation changed before stop')
        except BaseException:
            self.queue.close()
            raise

    def apply(self):
        require(self.service.status() == self.binding['status'], 'service generation changed before signal')
        require(process_tree(self.binding['status']['pid']) == self.binding['tree'],
                'process descendants changed before signal')
        command(['/bin/launchctl', 'bootout', self.service.target])

    def verify(self, connection_check, listener_check, deadline=15):
        end = time.monotonic() + deadline
        while len(self.events) < len(self.binding['tree']) and time.monotonic() < end:
            for event in self.queue.control(None, len(self.binding['tree']), max(0, min(.1, end - time.monotonic()))):
                require(event.ident in self.binding['tree'] and event.ident not in self.events,
                        'unexpected or repeated process exit')
                require(event.fflags & EXIT_FLAGS == EXIT_FLAGS, 'exit status was not returned')
                self.events[event.ident] = {'flags': event.fflags, 'wait_status': event.data}
        require(set(self.events) == set(self.binding['tree']), 'service or descendant exit was not observed')
        require(not self.service.status()['loaded'], 'managed service remains loaded')
        for pid, event in self.events.items():
            require(not process_exists(pid), 'service or descendant survives')
            status = event['wait_status']
            require((os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0)
                    or (os.WIFSIGNALED(status) and os.WTERMSIG(status) in self.allowed_signals),
                    'process termination violates declared normal-exit contract')
        require(connection_check() is True, 'former bus connection is not normally closed')
        require(listener_check() is True, 'former process listener survives')
        owner_status = self.events[self.binding['status']['pid']]['wait_status']
        termination = {'signal': os.WTERMSIG(owner_status)} if os.WIFSIGNALED(owner_status) else {'exit': 0}
        segment = log_segment(self.offsets)
        verify_completion(self.completion_service, segment, [], [],
                          startup_segment=self.startup_segment, termination=termination,
                          bus_client_names=self.bus_client_names)
        return {'verified': True, 'owner': self.binding['status']['pid'],
                'exit_flags_requested': EXIT_FLAGS, 'exits': self.events,
                'unit_unloaded': True, 'descendants_absent': True,
                'connections_closed': True, 'listeners_absent': True,
                'log_offsets': self.offsets, 'termination': termination}

    def close(self):
        self.queue.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def unload_idle_timer(service, paths):
    before = service.status()
    require(before['loaded'] and not before['running'], 'timer is not idle')
    offsets = log_offsets(paths)
    require(service.status() == before, 'timer started before durable stop intent')
    def apply():
        current = service.status()
        require(current == before, 'timer started before unload')
        command(['/bin/launchctl', 'bootout', service.target])
    def verify():
        after = service.status()
        verify_timer_idle(before, after['loaded'], offsets, log_offsets(paths))
        return {'verified': True, 'prior': before, 'unloaded': True, 'logs_unchanged': True}
    return apply, verify
