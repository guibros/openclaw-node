#!/usr/bin/env python3
import fcntl
import os
import pathlib
import stat
import subprocess
import sys
import time


LOCK = pathlib.Path('/private/var/db/openclaw-nats-writer.lock')
MARKER = pathlib.Path('/private/var/db/openclaw-nats/writer-handoff.json')


def acquire(lock_file, expected_uid, expected_gid, seconds=10):
    for ancestor in reversed((lock_file.parent, *lock_file.parent.parents)):
        parent = ancestor.lstat()
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid not in (0, expected_uid) or parent.st_mode & 0o022:
            raise RuntimeError('legacy writer lock ancestor is not protected')
    if lock_file.parent.lstat().st_gid != expected_gid:
        raise RuntimeError('legacy writer lock parent group is invalid')
    fd = os.open(lock_file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        actual = os.fstat(fd)
        named = lock_file.lstat()
        if (not stat.S_ISREG(actual.st_mode) or actual.st_uid != expected_uid
                or actual.st_gid != expected_gid or stat.S_IMODE(actual.st_mode) != 0o644
                or actual.st_nlink != 1 or (actual.st_dev, actual.st_ino) != (named.st_dev, named.st_ino)):
            raise RuntimeError('legacy writer lock identity is invalid')
        deadline = time.monotonic() + seconds
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('protected NATS migration holds the legacy writer lock')
                time.sleep(0.05)
        latest = lock_file.lstat()
        if (latest.st_dev, latest.st_ino) != (actual.st_dev, actual.st_ino):
            raise RuntimeError('legacy writer lock path changed')
        return fd
    except BaseException:
        os.close(fd)
        raise


def require_no_marker(marker):
    try:
        marker.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise RuntimeError('protected NATS handoff state is unobservable') from error
    raise RuntimeError('protected NATS writer handoff active; legacy writer changes refused')


def verify_inherited(token, lock_file=LOCK):
    try:
        fd_text, dev_text, ino_text = token.split(':')
        fd, dev, ino = int(fd_text), int(dev_text), int(ino_text)
        actual = os.fstat(fd)
        named = lock_file.lstat()
    except (AttributeError, OSError, ValueError) as error:
        raise RuntimeError('inherited legacy writer lock is invalid') from error
    if fd < 3 or (actual.st_dev, actual.st_ino) != (dev, ino) or (named.st_dev, named.st_ino) != (dev, ino):
        raise RuntimeError('inherited legacy writer lock identity changed')


def run_locked(command, lock_file=LOCK, marker=MARKER, expected_uid=0, expected_gid=0):
    fd = acquire(lock_file, expected_uid, expected_gid)
    try:
        require_no_marker(marker)
        info = os.fstat(fd)
        env = {**os.environ, 'OPENCLAW_NATS_LEGACY_LOCK_HELD': f'{fd}:{info.st_dev}:{info.st_ino}'}
        result = subprocess.run(command, env=env, pass_fds=(fd,))
        return result.returncode if result.returncode >= 0 else 128 - result.returncode
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        if len(sys.argv) == 2 and sys.argv[1] == '--verify':
            verify_inherited(os.environ.get('OPENCLAW_NATS_LEGACY_LOCK_HELD'))
            raise SystemExit(0)
        if len(sys.argv) < 3 or sys.argv[1] != '--':
            raise SystemExit('usage: nats-legacy-lock.py -- command [args...]')
        raise SystemExit(run_locked(sys.argv[2:]))
    except (OSError, RuntimeError) as error:
        print(f'nats-legacy-lock: {error}', file=sys.stderr)
        raise SystemExit(1)
