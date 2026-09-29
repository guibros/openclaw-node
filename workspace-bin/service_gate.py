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
    return {'device': info.st_dev, 'inode': info.st_ino,
            'ctime_ns': info.st_ctime_ns, 'uid': info.st_uid,
            'mode': stat.S_IMODE(info.st_mode)}


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


def initialize(root):
    root = pathlib.Path(root).absolute()
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


class Gate:
    def __init__(self, root):
        self.root = pathlib.Path(root).absolute()
        self.handles = []
        try:
            self.directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self.handles.append(self.directory)
            private(self.directory, directory=True)
            self.lock = self.open_private('gate.lock', os.O_RDWR)
            self.handles.append(self.lock)
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
        fd = os.open(name, flags | os.O_NOFOLLOW, dir_fd=self.directory)
        try:
            private(fd)
            return fd
        except BaseException:
            os.close(fd)
            raise

    def validate(self):
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

    def marker(self):
        try:
            fd = self.open_private('closed.json')
        except FileNotFoundError:
            return None
        try:
            value = json.loads(read(fd))
            require(isinstance(value, dict) and set(value) == {'window', 'reason'}
                    and all(isinstance(item, str) and 0 < len(item) <= 256 for item in value.values()),
                    'closed marker schema differs')
            return value
        finally:
            os.close(fd)

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
        try:
            os.write(fd, json.dumps({'window': window, 'reason': reason},
                                   sort_keys=True, allow_nan=False).encode())
            sync(fd)
            require(identity(os.stat(pending, dir_fd=self.directory, follow_symlinks=False))
                    == private(fd), 'prepared closed marker identity changed')
            os.link(pending, 'closed.json', src_dir_fd=self.directory,
                    dst_dir_fd=self.directory, follow_symlinks=False)
            sync(self.directory)
            os.unlink(pending, dir_fd=self.directory)
            sync(self.directory)
        finally:
            os.close(fd)
        self.exclusive(seconds)
        try:
            self.validate()
            require(self.marker() == {'window': window, 'reason': reason}, 'closed marker changed')
            return ClosedGate(self)
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_UN)

    def reopen(self, expected, seconds=5):
        self.exclusive(seconds)
        try:
            self.validate()
            require(self.marker() == expected, 'reopen does not match the closed window')
            os.unlink('closed.json', dir_fd=self.directory)
            sync(self.directory)
            require(self.marker() is None, 'gate did not reopen')
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_UN)

    def close(self):
        for fd in reversed(self.handles):
            os.close(fd)
        self.handles.clear()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class ClosedGate:
    def __init__(self, gate):
        self.gate = gate
        self.marker = gate.marker()
        self.marker_fd = gate.open_private('closed.json')
        self.queue = None
        self.events = []
        self.identities = {fd: identity(os.fstat(fd)) for fd in
                           (*gate.handles, self.marker_fd)}
        try:
            if sys.platform == 'darwin':
                self.queue = select.kqueue()
                returned = self.queue.control([select.kevent(fd, filter=select.KQ_FILTER_VNODE,
                    flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR, fflags=0x7f)
                    for fd in self.identities], len(self.identities), 0)
                require(not returned, 'gate changed while registering watches')
            self.check()
        except BaseException:
            self.close()
            raise

    def check(self):
        if self.queue is not None:
            returned = self.queue.control(None, len(self.identities), 0)
            for event in returned:
                self.events.append({'ident': event.ident, 'filter': event.filter,
                                    'flags': event.flags, 'fflags': event.fflags, 'data': event.data})
                require(len(self.events) <= 4096, 'closed gate watch evidence bound exceeded')
                require(not event.flags & select.KQ_EV_ERROR and event.filter == select.KQ_FILTER_VNODE
                        and event.ident in self.identities, 'unexpected gate watch event')
                require(event.fflags == 0x08
                        and identity(os.fstat(event.ident)) == self.identities[event.ident],
                        'closed gate inode mutated')
        self.gate.validate()
        require(self.gate.marker() == self.marker, 'closed gate marker changed')
        current = os.stat('closed.json', dir_fd=self.gate.directory, follow_symlinks=False)
        require(identity(current) == self.identities[self.marker_fd], 'closed marker inode changed')
        return {'verified': True, 'method': 'application-execution-gate',
                'marker': self.marker, 'identity': self.gate.metadata,
                'kernel_file_watch': self.queue is not None, 'events': list(self.events),
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('init', 'run'))
    parser.add_argument('root')
    parser.add_argument('argv', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.action == 'init' and not os.path.lexists(args.root):
            initialize(args.root)
        with Gate(args.root) as gate:
            if args.action == 'init':
                require(gate.marker() is None, 'installation cannot reopen a closed gate')
                return 0
            return gate.run(args.argv[1:] if args.argv[:1] == ['--'] else args.argv)
    except (Refused, OSError, ValueError, TypeError, KeyError):
        return 78


if __name__ == '__main__':
    raise SystemExit(main())
