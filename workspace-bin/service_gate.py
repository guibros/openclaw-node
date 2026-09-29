#!/usr/bin/env python3
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import secrets
import select
import stat
import sys
import time


class Refused(Exception):
    pass


def require(value, reason):
    if not value:
        raise Refused(reason)


def sync(fd):
    os.fsync(fd)
    if sys.platform == 'darwin':
        fcntl.fcntl(fd, fcntl.F_FULLFSYNC)


def identity(info):
    value = {'device': info.st_dev, 'inode': info.st_ino,
             'ctime_ns': info.st_ctime_ns, 'uid': info.st_uid,
             'mode': stat.S_IMODE(info.st_mode)}
    if hasattr(info, 'st_birthtime_ns'):
        value['birthtime_ns'] = info.st_birthtime_ns
    elif hasattr(info, 'st_birthtime'):
        value['birthtime'] = info.st_birthtime
    return value


def private(fd, directory=False):
    info = os.fstat(fd)
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == (0o700 if directory else 0o600),
            'gate inode is not owner-private')
    return identity(info)


def read(fd):
    data = os.pread(fd, 16385, 0)
    require(len(data) <= 16384, 'gate metadata exceeds its bound')
    return data


def parse_marker(data):
    value = json.loads(data)
    require(isinstance(value, dict) and set(value) == {'window', 'reason'}
            and all(isinstance(item, str) and 0 < len(item) <= 256 for item in value.values()),
            'closed marker schema differs')
    return value


def normalized_root(root):
    value = os.fspath(root)
    require(value.startswith('/') and '//' not in value
            and os.path.normpath(value) == value, 'gate path must be normalized and absolute')
    return pathlib.Path(value)


def lock_pin(info):
    return ':'.join(str(info[key]) for key in ('device', 'inode', 'ctime_ns'))


class PathWatch:
    def __init__(self, root):
        self.handles = []
        self.records = []
        self.events = []
        self.queue = None
        self.session_id = secrets.token_hex(32)
        self.refusal = None
        try:
            self.handles = self.walk(root)
            for path, fd in zip((pathlib.Path('/'), *reversed(tuple(root.parents)[:-1]), root), self.handles):
                info = identity(os.fstat(fd))
                info.pop('ctime_ns')
                self.records.append({'fd': fd, 'path': str(path), 'identity': info})
            if sys.platform == 'darwin':
                self.queue = select.kqueue()
                returned = self.queue.control([select.kevent(fd, filter=select.KQ_FILTER_VNODE,
                    flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR, fflags=0x61)
                    for fd in self.handles], len(self.handles), 0)
                self.record(returned)
            self.check()
        except BaseException as error:
            error.path_evidence = self.evidence()
            self.close()
            raise

    @staticmethod
    def walk(root):
        handles = []
        try:
            handles.append(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
            for component in root.parts[1:]:
                handles.append(os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                       dir_fd=handles[-1]))
            return handles
        except BaseException:
            for fd in reversed(handles):
                os.close(fd)
            raise

    def record(self, returned):
        self.events.extend({'ident': event.ident, 'filter': event.filter,
                            'flags': event.flags, 'fflags': event.fflags, 'data': event.data}
                           for event in returned)
        require(len(self.events) <= 4096, 'path watch evidence bound exceeded')
        for event in returned:
            require(not event.flags & (select.KQ_EV_ERROR | select.KQ_EV_EOF)
                    and event.filter == select.KQ_FILTER_VNODE
                    and event.ident in self.handles, 'unexpected path watch event')
        if returned:
            raise Refused('gate path mapping mutated')

    def check(self):
        require(self.refusal is None, 'path watch session was already refused')
        try:
            self._check()
        except BaseException as error:
            self.refusal = str(error)
            raise

    def _check(self):
        for row in self.records:
            info = identity(os.fstat(row['fd']))
            info.pop('ctime_ns')
            require(info == row['identity'], 'watched path descriptor changed')
        if self.queue is not None:
            self.record(self.queue.control(None, len(self.handles), 0))
        current_handles = self.walk(pathlib.Path(self.records[-1]['path']))
        try:
            for row, current_fd in zip(self.records, current_handles):
                for fd in (row['fd'], current_fd):
                    current = os.fstat(fd)
                    info = identity(current)
                    info.pop('ctime_ns')
                    require(stat.S_ISDIR(current.st_mode) and info == row['identity'],
                            'gate path mapping or watched descriptor changed')
        finally:
            for fd in reversed(current_handles):
                os.close(fd)

    def evidence(self):
        return {'kernel_path_watch': self.queue is not None,
                'paths': [{'path': row['path'], 'identity': row['identity']} for row in self.records],
                'events': list(self.events), 'refusal': self.refusal}

    def close(self):
        if self.queue is not None:
            self.queue.close()
            self.queue = None
        for fd in reversed(self.handles):
            os.close(fd)
        self.handles.clear()


def initialize(root):
    root = normalized_root(root)
    root.mkdir(mode=0o700)
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        nonce = secrets.token_hex(32)
        fd = os.open('gate.lock', os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory)
        try:
            os.write(fd, nonce.encode())
            sync(fd)
            lock = private(fd)
        finally:
            os.close(fd)
        root_identity = private(directory, directory=True)
        root_identity.pop('ctime_ns')
        fd = os.open('identity.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory)
        try:
            data = json.dumps({'root': root_identity, 'lock': lock, 'nonce': nonce},
                              sort_keys=True, allow_nan=False).encode()
            os.write(fd, data)
            sync(fd)
        finally:
            os.close(fd)
        sync(directory)
        parent = os.open(root.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            sync(parent)
        finally:
            os.close(parent)
    finally:
        os.close(directory)
    return lock_pin(lock)


class Gate:
    def __init__(self, root, expected_lock):
        self.root = normalized_root(root)
        self.handles = []
        self.paths = None
        self.closed_receipt = None
        self._drain_verified = False
        try:
            self.paths = PathWatch(self.root)
            self.directory = os.dup(self.paths.handles[-1])
            self.handles.append(self.directory)
            private(self.directory, directory=True)
            self.lock = self.open_private('gate.lock')
            self.handles.append(self.lock)
            self.expected_lock = expected_lock
            require(lock_pin(private(self.lock)) == self.expected_lock, 'gate lock pin differs')
            self.metadata_fd = self.open_private('identity.json')
            self.handles.append(self.metadata_fd)
            raw = read(self.metadata_fd)
            self.metadata = json.loads(raw)
            self.metadata_identity = private(self.metadata_fd)
            self.metadata_sha = hashlib.sha256(raw).hexdigest()
            require(isinstance(self.metadata, dict) and set(self.metadata) == {'root', 'lock', 'nonce'}
                    and isinstance(self.metadata['nonce'], str) and len(self.metadata['nonce']) == 64
                    and all(item in '0123456789abcdef' for item in self.metadata['nonce']),
                    'gate identity schema differs')
            self.validate()
        except BaseException:
            self.close()
            raise

    def open_private(self, name, flags=os.O_RDONLY):
        fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.directory)
        try:
            private(fd)
            return fd
        except BaseException:
            os.close(fd)
            raise

    def validate(self):
        if self.paths is not None:
            self.paths.check()
        root = private(self.directory, directory=True)
        root.pop('ctime_ns')
        require(root == self.metadata['root'], 'gate directory identity changed')
        path_info = self.root.lstat()
        require(stat.S_ISDIR(path_info.st_mode)
                and (path_info.st_dev, path_info.st_ino) == (root['device'], root['inode']),
                'gate directory mapping changed')
        for name, fd, expected in [('gate.lock', self.lock, self.metadata['lock']),
                                   ('identity.json', self.metadata_fd, self.metadata_identity)]:
            current = os.stat(name, dir_fd=self.directory, follow_symlinks=False)
            require(stat.S_ISREG(current.st_mode) and identity(current) == expected
                    and private(fd) == expected, 'gate file identity changed')
        require(read(self.lock) == self.metadata['nonce'].encode()
                and hashlib.sha256(read(self.metadata_fd)).hexdigest() == self.metadata_sha,
                'gate identity contents changed')
        require(lock_pin(private(self.lock)) == self.expected_lock, 'gate lock pin differs')

    def marker(self):
        try:
            fd = self.open_private('closed.json')
        except FileNotFoundError:
            return None
        try:
            return parse_marker(read(fd))
        finally:
            os.close(fd)

    def _hold_receipt(self, published_fd=None):
        fd = self.open_private('closed.json')
        try:
            data = read(fd)
            info = private(fd)
            require(identity(os.stat('closed.json', dir_fd=self.directory, follow_symlinks=False))
                    == info, 'closed marker mapping changed')
            if published_fd is not None:
                require(private(published_fd) == info, 'published marker was replaced')
            root_stat = os.fstat(self.directory)
            root_info = identity(root_stat)
            root_info['mtime_ns'] = root_stat.st_mtime_ns
            return {'marker': parse_marker(data), 'marker_identity': info,
                    'marker_sha256': hashlib.sha256(data).hexdigest(),
                    'metadata_sha256': self.metadata_sha, 'gate_identity': self.metadata,
                    'object_identities': {'root': root_info, 'lock': private(self.lock),
                                          'metadata': private(self.metadata_fd), 'marker': info},
                    'lock_pin': self.expected_lock,
                    'path_identities': self.paths.evidence()['paths']}
        finally:
            os.close(fd)

    def _drained_guard(self, restoration_only):
        self._drain_verified = True
        try:
            return RestorationGate(self) if restoration_only else ClosedGate(self)
        finally:
            self._drain_verified = False

    def run(self, argv):
        require(argv and pathlib.Path(argv[0]).is_absolute(), 'gated executable must be absolute')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        self.validate()
        if self.marker() is not None:
            return 0
        os.set_inheritable(self.lock, True)
        os.execv(argv[0], argv)

    def exclusive(self, seconds):
        end = time.monotonic() + seconds
        while True:
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.monotonic() >= end:
                    raise Refused('foreground run did not drain before deadline')
                time.sleep(.01)

    def close_and_drain(self, window, reason, seconds):
        self.validate()
        require(self.marker() is None, 'existing closed gate requires restoration')
        require(all(isinstance(item, str) and 0 < len(item) <= 256 for item in (window, reason)),
                'closed gate needs a window and reason')
        pending = '.closed-' + secrets.token_hex(16)
        fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=self.directory)
        published = False
        try:
            os.write(fd, json.dumps({'window': window, 'reason': reason},
                                   sort_keys=True, allow_nan=False).encode())
            sync(fd)
            require(identity(os.stat(pending, dir_fd=self.directory, follow_symlinks=False))
                    == private(fd), 'prepared closed marker identity changed')
            os.link(pending, 'closed.json', src_dir_fd=self.directory,
                    dst_dir_fd=self.directory, follow_symlinks=False)
            published = True
            sync(self.directory)
            os.unlink(pending, dir_fd=self.directory)
            sync(self.directory)
            self.closed_receipt = self._hold_receipt(fd)
        except BaseException as error:
            if published:
                try:
                    self.closed_receipt = self._hold_receipt(fd)
                except BaseException as receipt_error:
                    error.receipt_refusal = str(receipt_error)
            error.closed_receipt = self.closed_receipt
            raise
        finally:
            os.close(fd)
        self.exclusive(seconds)
        try:
            self.validate()
            require(self._hold_receipt() == self.closed_receipt, 'closed hold receipt changed')
            return self._drained_guard(False)
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_UN)

    def reattach(self, receipt, seconds=5):
        self.validate()
        require(self._hold_receipt() == receipt, 'hold receipt does not match the closed window')
        self.exclusive(seconds)
        try:
            self.validate()
            require(self._hold_receipt() == receipt, 'hold receipt changed while draining')
            self.closed_receipt = receipt
            return self._drained_guard(True)
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_UN)

    def reopen(self, receipt, seconds=5):
        self.validate()
        require(self._hold_receipt() == receipt, 'reopen receipt does not match the closed window')
        self.exclusive(seconds)
        try:
            self.validate()
            require(self._hold_receipt() == receipt, 'reopen receipt changed while draining')
            os.unlink('closed.json', dir_fd=self.directory)
            sync(self.directory)
            require(self.marker() is None, 'gate did not reopen')
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_UN)

    def close(self):
        if self.paths is not None:
            self.paths.close()
        for fd in reversed(self.handles):
            os.close(fd)
        self.handles.clear()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class HeldGate:
    def __init__(self, gate):
        require(gate._drain_verified, 'closed guard requires a fresh exclusive drain')
        self.gate = gate
        self.receipt = gate.closed_receipt
        self.marker = gate.marker()
        self.marker_fd = gate.open_private('closed.json')
        self.queue = None
        self.events = []
        self.tolerated_events = 0
        self.last_tolerated_event = None
        self.refusal = None
        self.identities = {fd: identity(os.fstat(fd)) for fd in
                           (*gate.handles, self.marker_fd)}
        try:
            if sys.platform == 'darwin':
                self.queue = select.kqueue()
                returned = self.queue.control([select.kevent(fd, filter=select.KQ_FILTER_VNODE,
                    flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR, fflags=0x7f)
                    for fd in self.identities], len(self.identities), 0)
                self.events.extend({'ident': event.ident, 'filter': event.filter,
                                    'flags': event.flags, 'fflags': event.fflags, 'data': event.data}
                                   for event in returned)
                require(not returned, 'gate changed while registering watches')
            self.check()
        except BaseException:
            self.close()
            raise

    def check(self):
        require(self.refusal is None, 'closed watch session was already refused')
        try:
            return self._check()
        except BaseException as error:
            self.refusal = str(error)
            raise

    def _check(self):
        if self.queue is not None:
            returned = self.queue.control(None, len(self.identities), 0)
            raw = [{'ident': event.ident, 'filter': event.filter,
                    'flags': event.flags, 'fflags': event.fflags, 'data': event.data}
                   for event in returned]
            self.events.extend(raw)
            for event, row in zip(returned, raw):
                require(len(self.events) <= 4096, 'closed gate watch evidence bound exceeded')
                require(not event.flags & (select.KQ_EV_ERROR | select.KQ_EV_EOF)
                        and event.filter == select.KQ_FILTER_VNODE
                        and event.ident in self.identities, 'unexpected gate watch event')
                require(event.fflags == 0x08
                        and identity(os.fstat(event.ident)) == self.identities[event.ident],
                        'closed gate inode mutated')
                self.events.remove(row)
                self.tolerated_events += 1
                self.last_tolerated_event = row
        self.gate.validate()
        require(self.gate.marker() == self.marker, 'closed gate marker changed')
        current = os.stat('closed.json', dir_fd=self.gate.directory, follow_symlinks=False)
        require(identity(current) == self.identities[self.marker_fd], 'closed marker inode changed')
        require(self.gate._hold_receipt() == self.receipt, 'closed hold receipt changed')
        return {'hold_present': True, 'freshly_drained': True, 'method': 'application-execution-gate',
                'marker': self.marker, 'identity': self.gate.metadata,
                'kernel_file_watch': self.queue is not None, 'events': list(self.events),
                'path_watch': self.gate.paths.evidence(),
                'marker_identity': self.receipt['marker_identity'],
                'metadata_sha256': self.receipt['metadata_sha256'], 'receipt': self.receipt,
                'tolerated_event_count': self.tolerated_events,
                'last_tolerated_event': self.last_tolerated_event,
                'requires_foreground_contract': True,
                'os_spawn_coverage': False}

    def close(self):
        if self.queue is not None:
            self.queue.close()
            self.queue = None
        if self.marker_fd is not None:
            os.close(self.marker_fd)
            self.marker_fd = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class ClosedGate(HeldGate):
    def check(self):
        return {**super().check(), 'verified': True, 'restoration_only': False,
                'watch_session_id': self.gate.paths.session_id}


class RestorationGate(HeldGate):
    def check(self):
        return {**super().check(), 'restoration_only': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('init', 'run'))
    parser.add_argument('root')
    parser.add_argument('--lock')
    args, argv = parser.parse_known_args()
    argv = argv[1:] if argv[:1] == ['--'] else argv
    try:
        if args.action == 'init':
            require(not argv and args.lock is None, 'init accepts no runner arguments')
            if not os.path.lexists(args.root):
                expected = initialize(args.root)
            else:
                root = normalized_root(args.root)
                expected = lock_pin(identity(os.stat(root / 'gate.lock', follow_symlinks=False)))
        else:
            require(args.lock is not None, 'runner requires its installed gate pin')
            expected = args.lock
        with Gate(args.root, expected) as gate:
            if args.action == 'init':
                require(gate.marker() is None, 'installation cannot reopen a closed gate')
                return 0
            return gate.run(argv)
    except (Refused, OSError, ValueError, TypeError, KeyError, RecursionError):
        return 78


if __name__ == '__main__':
    raise SystemExit(main())
