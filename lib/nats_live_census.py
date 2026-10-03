import hashlib
import hmac
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import unicodedata

import nats_macos_proc as proc
from nats_root_lock import Refused


LEGACY_LABELS = ('ai.openclaw.nats', 'ai.openclaw.nats-1',
                 'ai.openclaw.nats-2', 'ai.openclaw.nats-3')
LISTENER_PORTS = (4222, 8222, 6222, 4223, 8223, 6223, 4224, 8224, 6224)
SERVICE_PORTS = {'ai.openclaw.nats': (4222, 8222),
                 'ai.openclaw.nats-1': (4222, 8222, 6222),
                 'ai.openclaw.nats-2': (4223, 8223, 6223),
                 'ai.openclaw.nats-3': (4224, 8224, 6224)}


def _safe_arguments(arguments):
    return all(not any(unicodedata.category(char)[0] == 'C' or
                       unicodedata.category(char) in ('Zl', 'Zp')
                       for char in argument) for argument in arguments)


def _command(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=10)
    return result.returncode, result.stdout, result.stderr


def _field(output, name):
    matches = re.findall(r'^\t' + re.escape(name) + r' = (.+)$', output, re.MULTILINE)
    if len(matches) != 1:
        raise Refused(f'launchd {name} is unobservable')
    return matches[0]


def launchd_service(domain, label):
    code, output, error = _command('/bin/launchctl', 'print', f'{domain}/{label}')
    if code:
        if f'Could not find service "{label}" in domain' in error:
            return {'loaded': False}
        raise Refused(f'launchd service {label} is unobservable')
    prefix = f'{domain}/{label} = {{'
    if not output.startswith(prefix):
        raise Refused(f'launchd service {label} differs')
    state = _field(output, 'state')
    path = _field(output, 'path')
    program = _field(output, 'program')
    arguments = re.findall(r'^\targuments = \{\n((?:\t\t[^\n]*\n)+)\t\}$',
                           output, re.MULTILINE)
    if len(arguments) != 1:
        raise Refused(f'launchd service {label} arguments are unobservable')
    arguments = [line[2:] for line in arguments[0].split('\n')[:-1]]
    if not _safe_arguments(arguments):
        raise Refused(f'launchd service {label} arguments contain control characters')
    pid = re.findall(r'^\tpid = (\d+)$', output, re.MULTILINE)
    if len(pid) > 1 or state == 'running' and len(pid) != 1:
        raise Refused(f'launchd service {label} has ambiguous process state')
    return {'loaded': True, 'state': state, 'pid': int(pid[0]) if pid else None,
            'plist': path, 'program': program, 'arguments': arguments}


def disabled_overrides(domain):
    code, output, _ = _command('/bin/launchctl', 'print-disabled', domain)
    if code:
        raise Refused(f'launchd disabled overrides for {domain} are unobservable')
    result = {}
    for label in LEGACY_LABELS:
        matches = re.findall(r'^\s*"' + re.escape(label) +
                             r'" => ([^\n]+)$', output, re.MULTILINE)
        if len(matches) > 1:
            raise Refused(f'launchd disabled override for {label} is ambiguous')
        if matches and matches[0] not in ('enabled', 'disabled', 'true', 'false'):
            raise Refused(f'launchd disabled override for {label} is unrecognized')
        result[label] = None if not matches else matches[0] in ('disabled', 'true')
    return result


def plist_identity(path, report_key):
    path = Path(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise Refused('launchd plist is not a regular single-link file')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise Refused('launchd plist changed during census') from error
    try:
        opened = os.fstat(fd)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                or opened.st_size > 1 << 20):
            raise Refused('launchd plist is not a bounded regular single-link file')
        raw = os.read(fd, opened.st_size + 1)
        if len(raw) != opened.st_size or os.fstat(fd).st_ctime_ns != opened.st_ctime_ns:
            raise Refused('launchd plist changed during census')
    finally:
        os.close(fd)
    after = path.lstat()
    if (before.st_dev, before.st_ino, before.st_ctime_ns) != (
            opened.st_dev, opened.st_ino, opened.st_ctime_ns) or (
            before.st_dev, before.st_ino, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_ctime_ns):
        raise Refused('launchd plist changed during census')
    try:
        parsed = plistlib.loads(raw)
    except (ValueError, TypeError, OverflowError) as error:
        raise Refused('launchd plist cannot be parsed') from error
    if not isinstance(parsed, dict):
        raise Refused('launchd plist is invalid')
    return {'path': str(path),
            'content_hmac_sha256': hmac.new(report_key, raw, hashlib.sha256).hexdigest(),
            'device': before.st_dev, 'inode': before.st_ino,
            'uid': before.st_uid, 'gid': before.st_gid,
            'mode': stat.S_IMODE(before.st_mode),
            'label': parsed.get('Label'), 'argv': parsed.get('ProgramArguments'),
            'run_at_load': parsed.get('RunAtLoad'), 'keep_alive': parsed.get('KeepAlive')}


def nats_processes():
    processes = []
    unreadable = 0
    for pid in proc.list_pids():
        try:
            info = proc.bsd_info(pid)
        except Refused:
            unreadable += 1
            continue
        if info['name'] != 'nats-server':
            continue
        processes.append(proc.snapshot(pid))
    return processes, unreadable


def tcp_listener_census():
    result = {}
    for port in LISTENER_PORTS:
        code, output, error = _command('/usr/sbin/lsof', '-nP', f'-iTCP:{port}',
                                       '-sTCP:LISTEN', '-Fpcn')
        if code not in (0, 1) or error or code == 1 and output:
            raise Refused(f'TCP listener {port} is unobservable')
        rows = []
        pid = command = descriptor = None
        for line in output.splitlines():
            field, value = line[:1], line[1:]
            if field == 'p':
                if not value.isdecimal():
                    raise Refused(f'TCP listener {port} has an invalid PID')
                pid, command, descriptor = int(value), None, None
            elif field == 'c':
                command = value
            elif field == 'f':
                descriptor = value
            elif field == 'n':
                if pid is None or command is None or descriptor is None:
                    raise Refused(f'TCP listener {port} has incomplete process identity')
                rows.append({'pid': pid, 'command': command,
                             'descriptor': descriptor, 'address': value})
        if code == 0 and not rows or len(rows) > 1:
            raise Refused(f'TCP listener {port} is ambiguous')
        if rows and (rows[0]['address'] != f'127.0.0.1:{port}'
                     or rows[0]['command'] != 'nats-server'):
            raise Refused(f'TCP listener {port} is not the expected loopback NATS server')
        result[str(port)] = rows[0] if rows else None
    return result


def tcp_socket_census():
    code, output, error = _command('/usr/sbin/netstat', '-an', '-p', 'tcp')
    if code or error or 'Proto Recv-Q Send-Q  Local Address' not in output:
        raise Refused('system TCP listening sockets are unobservable')
    result = {str(port): [] for port in LISTENER_PORTS}
    for line in output.splitlines():
        parts = line.split()
        if not parts or parts[-1] != 'LISTEN' or not parts[0].startswith('tcp'):
            continue
        if len(parts) < 6:
            raise Refused('system TCP listening row is incomplete')
        local = parts[3]
        address, separator, port = local.rpartition('.')
        if not separator or not port.isdecimal():
            raise Refused('system TCP listening address is unobservable')
        if port in result:
            result[port].append((parts[0], address))
    for port, sockets in result.items():
        if len(sockets) > 1 or sockets and sockets[0] != ('tcp4', '127.0.0.1'):
            raise Refused(f'system TCP listener {port} differs from loopback cohort')
    return {port: bool(sockets) for port, sockets in result.items()}


def verify_socket_visibility(listeners, sockets):
    if set(listeners) != set(sockets) or any((listener is not None) != sockets[port]
                                             for port, listener in listeners.items()):
        raise Refused('lsof and system TCP listener views differ')
    return True


def verify_listener_owners(units, system, processes, listeners):
    by_pid = {process['pid']: process for process in processes}
    running = [(label, service) for domain in (units, system)
               for label, service in domain.items()
               if service['loaded'] and service['state'] == 'running']
    for port in LISTENER_PORTS:
        if sum(domain[label]['loaded'] for domain in (units, system)
               for label, ports in SERVICE_PORTS.items() if port in ports) > 1:
            raise Refused(f'loaded NATS jobs compete for TCP listener {port}')
    for port, listener in listeners.items():
        if listener is not None and (listener['pid'] not in by_pid or
                                     len([label for label, service in running
                                          if int(port) in SERVICE_PORTS[label]
                                          and service['pid'] == listener['pid']]) != 1):
            raise Refused(f'TCP listener {port} has no bound launchd NATS process identity')
    for domain in (units, system):
        for label, ports in SERVICE_PORTS.items():
            unit = domain[label]
            if unit['loaded'] and unit['state'] == 'running':
                if any(listeners[str(port)] is None or
                       listeners[str(port)]['pid'] != unit['pid'] for port in ports):
                    raise Refused(f'launchd service {label} does not own its client and monitor listeners')
    return True


def store_identity(path):
    root = Path(path)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise Refused('NATS store is not a directory')
    count = 0
    bytes_total = 0
    inodes = {(info.st_dev, info.st_ino)}
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK
    def walk(directory_fd):
        nonlocal count, bytes_total
        with os.scandir(directory_fd) as entries:
            for entry in entries:
                current = entry.stat(follow_symlinks=False)
                if stat.S_ISDIR(current.st_mode):
                    child_fd = os.open(entry.name, flags, dir_fd=directory_fd)
                    try:
                        opened = os.fstat(child_fd)
                        if (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
                            raise Refused('NATS store tree changed during census')
                        inodes.add((opened.st_dev, opened.st_ino))
                        walk(child_fd)
                    finally:
                        os.close(child_fd)
                elif stat.S_ISREG(current.st_mode):
                    inodes.add((current.st_dev, current.st_ino))
                    count += 1
                    bytes_total += current.st_size
                else:
                    raise Refused('NATS store contains a non-regular entry')
    try:
        root_fd = os.open(root, flags)
        try:
            opened = os.fstat(root_fd)
            if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                raise Refused('NATS store root changed during census')
            walk(root_fd)
        finally:
            os.close(root_fd)
    except OSError as error:
        raise Refused('NATS store tree changed during census') from error
    after = root.lstat()
    if (info.st_dev, info.st_ino, info.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_ctime_ns):
        raise Refused('NATS store root changed during census')
    return {'path': str(root), 'device': info.st_dev, 'inode': info.st_ino,
            'files': count, 'bytes': bytes_total, 'inodes': inodes}


def observe(user_uid, user_home):
    try:
        return _observe(user_uid, user_home)
    except (OSError, subprocess.SubprocessError) as error:
        raise Refused('live NATS census is unobservable') from error


def _observe(user_uid, user_home):
    report_key = os.urandom(32)
    def argument_digest(arguments):
        return hmac.new(report_key, '\0'.join(arguments).encode(),
                        hashlib.sha256).hexdigest()
    home = Path(user_home).resolve()
    gui = f'gui/{user_uid}'
    overrides = disabled_overrides(gui)
    units = {}
    for label in LEGACY_LABELS:
        service = launchd_service(gui, label)
        service['disabled'] = overrides[label]
        units[label] = service
    system_overrides = disabled_overrides('system')
    system = {label: launchd_service('system', label) for label in LEGACY_LABELS}
    for label in LEGACY_LABELS:
        system[label]['disabled'] = system_overrides[label]
    processes, unreadable = nats_processes()
    by_pid = {process['pid']: process for process in processes}
    for domain_units in (units, system):
        for label, service in domain_units.items():
            if not service['loaded']:
                continue
            plist = plist_identity(service['plist'], report_key)
            if (plist['label'] != label or not isinstance(plist['argv'], list)
                    or not plist['argv'] or not all(isinstance(arg, str)
                                                   for arg in plist['argv'])
                    or not _safe_arguments(plist['argv'])):
                raise Refused(f'launchd service {label} does not match its plist')
            if service['program'] != plist['argv'][0] or service['arguments'] != plist['argv']:
                raise Refused(f'launchd service {label} arguments differ from its plist')
            pid = service['pid']
            service['process_matches_plist'] = (pid in by_pid and
                                                by_pid[pid]['arguments'] == plist['argv'])
            if service['state'] == 'running' and not service['process_matches_plist']:
                raise Refused(f'launchd service {label} process differs from its plist')
            plist['argv_hmac_sha256'] = argument_digest(plist['argv'])
            del plist['argv']
            del service['arguments']
            service['plist_identity'] = plist
    listeners = tcp_listener_census()
    sockets = tcp_socket_census()
    verify_socket_visibility(listeners, sockets)
    verify_listener_owners(units, system, processes, listeners)
    stores = {}
    for suffix in ('', '-1', '-2', '-3'):
        label = 'ai.openclaw.nats' + suffix
        store = store_identity(home / '.openclaw' / 'nats' /
                               ('jetstream' + suffix))
        stores[label] = {key: value for key, value in store.items() if key != 'inodes'}
        stores[label]['nats_server_open_vnodes'] = sorted(
            ({'pid': process['pid'], 'start_sec': process['start_sec'],
              'start_usec': process['start_usec'], 'fd': entry['fd'],
              'inode': entry['inode']}
            for process in processes for entry in process['vnodes']
            if (entry['device'], entry['inode']) in store['inodes']),
            key=lambda item: (item['pid'], item['fd']))
        stores[label]['nats_server_cwd'] = sorted(
            ({'pid': process['pid'], 'start_sec': process['start_sec'],
              'start_usec': process['start_usec'],
              'inode': process['cwd']['inode']}
             for process in processes if
             (process['cwd']['device'], process['cwd']['inode']) in store['inodes']),
            key=lambda item: item['pid'])
        stores[label]['nats_server_mappings'] = sorted(
            ({'pid': process['pid'], 'start_sec': process['start_sec'],
              'start_usec': process['start_usec'], 'inode': entry['inode']}
             for process in processes for entry in process['mappings']
             if (entry['device'], entry['inode']) in store['inodes']),
            key=lambda item: (item['pid'], item['inode']))
    summaries = [{'pid': process['pid'], 'uid': process['uid'],
                  'start_sec': process['start_sec'],
                  'start_usec': process['start_usec'],
                  'executable': process['executable'],
                  'argv_hmac_sha256': argument_digest(process['arguments']),
                  'vnode_count': len(process['vnodes']),
                  'mapping_count': len(process['mappings'])} for process in processes]
    return {'scope': 'live-census-only',
            'coverage': {'domains': [gui, 'system'],
                         'other_domains': 'not checked',
                         'unloaded_plists': 'not checked',
                         'waiting_job_arguments': 'launchctl text; embedded newlines are ambiguous',
                         'processes': 'readable processes named nats-server',
                         'vnode_holders': 'open descriptors, mapped files and working directories of those processes only; linked store entries only',
                         'process_identity': 'PID and start time stable within each snapshot, not across the full scan',
                         'listener_ports': 'nine named ports, separately read with lsof and system netstat; listening state only, no connected-client, future-owner, atomic or physical absence claim',
                         'single_instant': False, 'physical_absence_certified': False},
            'gui': units, 'system': system,
            'processes': summaries, 'unreadable_pids': unreadable,
            'listeners': listeners, 'system_sockets': sockets,
            'stores': stores}
