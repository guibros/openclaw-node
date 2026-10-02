import os
from pathlib import Path

import nats_macos_proc as proc
from nats_live_census import store_identity
from nats_root_lock import Refused


SUFFIXES = ('', '-1', '-2', '-3')


def _under(path, root):
    if not path or not os.path.isabs(path):
        return False
    resolved = os.path.realpath(path)
    return os.path.commonpath((resolved, root)) == root


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
    unreadable = []
    unattributed_unlinked = 0
    devices = {device for store in stores.values()
               for device, _ in store['inodes']}
    for pid in before:
        try:
            process = proc.vnode_snapshot(pid)
        except Refused:
            unreadable.append(pid)
            continue
        for entry in process['vnodes']:
            matched = False
            for store in stores.values():
                by_inode = (entry['device'], entry['inode']) in store['inodes']
                by_path = _under(entry['path'], store['realpath'])
                if by_inode or by_path:
                    store['holders'].append({
                        'pid': pid, 'uid': process['uid'], 'fd': entry['fd'],
                        'inode': entry['inode'], 'unlinked': entry['links'] == 0,
                        'match': 'inode' if by_inode else 'path'})
                    matched = True
            if not matched and entry['links'] == 0 and entry['device'] in devices:
                unattributed_unlinked += 1
    after = proc.list_pids()
    for store in stores.values():
        store['holders'].sort(key=lambda item: (item['pid'], item['fd']))
        del store['inodes']
        del store['realpath']
    return {'scope': 'readable-process-vnode-census',
            'coverage': {'process_name_filter': None,
                         'readable_processes_only': True,
                         'unreadable_pids': len(unreadable),
                         'pid_list_stable': before == after,
                         'single_instant': False,
                         'physical_absence_certified': False},
            'unreadable_pids': unreadable,
            'unattributed_unlinked_vnodes_on_store_devices': unattributed_unlinked,
            'stores': stores}
