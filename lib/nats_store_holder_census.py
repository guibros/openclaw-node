import os
from pathlib import Path

import nats_macos_proc as proc
from nats_live_census import store_identity
from nats_root_lock import Refused


SUFFIXES = ('', '-1', '-2', '-3')


def _under(path, root):
    if not path or not os.path.isabs(path):
        return False
    return os.path.commonpath((os.path.normpath(path), root)) == root


def _linked_at_path(entry, store):
    relative = os.path.relpath(os.path.normpath(entry['path']), store['realpath'])
    if relative == '.':
        return False
    parts = relative.split(os.sep)
    directory_fd = None
    try:
        directory_fd = os.open(store['realpath'], os.O_RDONLY | os.O_DIRECTORY |
                               os.O_NOFOLLOW)
        root = os.fstat(directory_fd)
        if (root.st_dev, root.st_ino) != (store['device'], store['inode']):
            return False
        for part in parts[:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                              dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        named = os.stat(parts[-1], dir_fd=directory_fd, follow_symlinks=False)
    except OSError:
        return False
    finally:
        if directory_fd is not None:
            os.close(directory_fd)
    return (named.st_dev, named.st_ino) == (entry['device'], entry['inode'])


def observe(user_home):
    try:
        return _observe(user_home)
    except OSError as error:
        raise Refused('NATS holder census is unobservable') from error


def _observe(user_home):
    home = Path(user_home).resolve()
    stores = {}
    for suffix in SUFFIXES:
        label = 'ai.openclaw.nats' + suffix
        store = store_identity(home / '.openclaw' / 'nats' / ('jetstream' + suffix))
        stores[label] = {**store, 'realpath': os.path.realpath(store['path']),
                         'holders': []}
    before = proc.list_pids()
    failed = []
    retried = []
    unattributed_unlinked = 0
    devices = {device for store in stores.values()
               for device, _ in store['inodes']}
    for pid in before:
        try:
            process = proc.vnode_snapshot(pid)
        except Refused:
            try:
                process = proc.vnode_snapshot(pid)
            except Refused:
                failed.append(pid)
                continue
            retried.append(pid)
        for entry in process['vnodes']:
            matched = False
            for store in stores.values():
                by_inode = (entry['device'], entry['inode']) in store['inodes']
                by_path = (not by_inode and _under(entry['path'], store['realpath'])
                           and (entry['links'] == 0 or _linked_at_path(entry, store)))
                if by_inode or by_path:
                    store['holders'].append({
                        'pid': pid, 'uid': process['uid'], 'fd': entry['fd'],
                        'inode': entry['inode'], 'unlinked': entry['links'] == 0,
                        'match': 'inode' if by_inode else 'path'})
                    matched = True
            if not matched and entry['links'] == 0 and entry['device'] in devices:
                unattributed_unlinked += 1
    after = proc.list_pids()
    remaining = set(after)
    unreadable = [pid for pid in failed if pid in remaining]
    exited = [pid for pid in failed if pid not in remaining]
    for store in stores.values():
        store['holders'].sort(key=lambda item: (item['pid'], item['fd']))
        del store['inodes']
        del store['realpath']
    return {'scope': 'readable-process-vnode-census',
            'coverage': {'process_name_filter': None,
                         'readable_processes_only': True,
                         'unreadable_pids': len(unreadable),
                         'exited_pids': len(exited),
                         'retry_recovered_pids': len(retried),
                         'pid_list_stable': before == after,
                         'single_instant': False,
                         'physical_absence_certified': False,
                         'reference_types': 'open vnode file descriptors only; excludes closed-fd mappings, cwd/root and in-flight descriptors',
                         'path_matching': 'lexical kernel paths; linked paths require a fresh identity match; alternate firmlink or case spelling may be unattributed'},
            'unreadable_pids': unreadable,
            'exited_pids': exited,
            'retry_recovered_pids': retried,
            'unattributed_unlinked_vnodes_on_store_devices': unattributed_unlinked,
            'stores': stores}
