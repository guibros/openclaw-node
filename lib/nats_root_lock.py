import fcntl
import os
import pathlib
import stat
import subprocess
import sys
import time


LOCK = pathlib.Path('/private/var/db/openclaw-nats-writer.lock')


class Refused(RuntimeError):
    pass


def sync_fd(fd):
    os.fsync(fd)
    if sys.platform == 'darwin':
        fcntl.fcntl(fd, fcntl.F_FULLFSYNC)


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        sync_fd(fd)
    finally:
        os.close(fd)


def require_no_acl(path):
    if sys.platform != 'darwin':
        return
    result = subprocess.run(['/bin/ls', '-lde', str(path)], capture_output=True, text=True, check=True)
    if not result.stdout or any(' allow ' in line for line in result.stdout.splitlines()[1:]):
        raise Refused('writer lock path has an ACL')


def protected_parent(path, uid, gid):
    for ancestor in reversed((path.parent, *path.parent.parents)):
        info = ancestor.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, uid) or info.st_mode & 0o022:
            raise Refused('writer lock ancestor is not protected')
        require_no_acl(ancestor)
    if path.parent.lstat().st_gid != gid:
        raise Refused('writer lock parent group differs')


def lock_identity(fd, path, uid, gid):
    actual = os.fstat(fd)
    named = path.lstat()
    if (not stat.S_ISREG(actual.st_mode) or actual.st_uid != uid or actual.st_gid != gid
            or stat.S_IMODE(actual.st_mode) != 0o644 or actual.st_nlink != 1
            or (actual.st_dev, actual.st_ino) != (named.st_dev, named.st_ino)):
        raise Refused('writer lock identity differs')
    require_no_acl(path)
    return (actual.st_dev, actual.st_ino)


class WriterExclusion:
    def __init__(self, fd, path, identity, created):
        self.fd = fd
        self.path = path
        self.identity = identity
        self.created = created

    def validate(self, uid, gid):
        if lock_identity(self.fd, self.path, uid, gid) != self.identity:
            raise Refused('writer lock identity changed')

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def _acquire(path, uid, gid, seconds):
    path = pathlib.Path(path)
    protected_parent(path, uid, gid)
    created = False
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    except FileExistsError:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    else:
        created = True
        try:
            os.fchmod(fd, 0o644)
            os.fchown(fd, uid, gid)
            sync_fd(fd)
            sync_dir(path.parent)
        except BaseException:
            os.close(fd)
            raise
    try:
        identity = lock_identity(fd, path, uid, gid)
        deadline = time.monotonic() + seconds
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Refused(f'legacy NATS writer still holds {path}; inspect holders with lsof')
                time.sleep(0.05)
        if lock_identity(fd, path, uid, gid) != identity:
            raise Refused('writer lock path changed during acquisition')
        return WriterExclusion(fd, path, identity, created)
    except BaseException:
        os.close(fd)
        raise


def acquire_root_writer_lock(seconds=10):
    if sys.platform != 'darwin' or os.geteuid() != 0:
        raise Refused('root-owned NATS writer exclusion requires macOS root')
    return _acquire(LOCK, 0, 0, seconds)
