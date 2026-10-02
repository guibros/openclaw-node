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
    with path.open('rb') as handle:
        raw = handle.read()
        opened = os.fstat(handle.fileno())
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


def store_identity(path):
    root = Path(path)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise Refused('NATS store is not a directory')
    count = 0
    bytes_total = 0
    inodes = {(info.st_dev, info.st_ino)}
    def refuse_walk(error):
        raise Refused('NATS store tree is unobservable') from error
    try:
        for directory, dirs, files in os.walk(root, followlinks=False, onerror=refuse_walk):
            for name in dirs + files:
                item = Path(directory) / name
                current = item.lstat()
                if stat.S_ISLNK(current.st_mode) or not (
                        stat.S_ISREG(current.st_mode) or stat.S_ISDIR(current.st_mode)):
                    raise Refused('NATS store contains a non-regular entry')
                inodes.add((current.st_dev, current.st_ino))
                if stat.S_ISREG(current.st_mode):
                    count += 1
                    bytes_total += current.st_size
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
    system = {label: launchd_service('system', label) for label in LEGACY_LABELS}
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
    stores = {}
    for suffix in ('', '-1', '-2', '-3'):
        label = 'ai.openclaw.nats' + suffix
        store = store_identity(home / '.openclaw' / 'nats' /
                               ('jetstream' + suffix))
        stores[label] = {key: value for key, value in store.items() if key != 'inodes'}
        stores[label]['nats_server_open_vnodes'] = sorted(
            ({'pid': process['pid'], 'fd': entry['fd'], 'inode': entry['inode']}
            for process in processes for entry in process['vnodes']
            if (entry['device'], entry['inode']) in store['inodes']),
            key=lambda item: (item['pid'], item['fd']))
    summaries = [{'pid': process['pid'], 'uid': process['uid'],
                  'start_sec': process['start_sec'],
                  'start_usec': process['start_usec'],
                  'executable': process['executable'],
                  'argv_hmac_sha256': argument_digest(process['arguments']),
                  'vnode_count': len(process['vnodes'])} for process in processes]
    return {'scope': 'live-census-only',
            'coverage': {'domains': [gui, 'system'],
                         'other_domains': 'not checked',
                         'unloaded_plists': 'not checked',
                         'waiting_job_arguments': 'launchctl text; embedded newlines are ambiguous',
                         'processes': 'readable processes named nats-server',
                         'vnode_holders': 'those processes only; linked store entries only',
                         'single_instant': False, 'physical_absence_certified': False},
            'gui': units, 'system': system,
            'processes': summaries, 'unreadable_pids': unreadable,
            'stores': stores}
