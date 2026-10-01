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
    try:
        for ancestor in reversed((path.parent, *path.parent.parents)):
            info = ancestor.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, uid) or info.st_mode & 0o022:
                raise Refused('writer lock ancestor is not protected')
            require_no_acl(ancestor)
        if path.parent.lstat().st_gid != gid:
            raise Refused('writer lock parent group differs')
    except (OSError, subprocess.CalledProcessError) as error:
        raise Refused('writer lock ancestor is unobservable') from error


def lock_identity(fd, path, uid, gid):
    try:
        actual = os.fstat(fd)
        named = path.lstat()
        if (not stat.S_ISREG(actual.st_mode) or actual.st_uid != uid or actual.st_gid != gid
                or stat.S_IMODE(actual.st_mode) != 0o644 or actual.st_nlink != 1
                or (actual.st_dev, actual.st_ino, actual.st_ctime_ns)
                != (named.st_dev, named.st_ino, named.st_ctime_ns)):
            raise Refused('writer lock identity differs')
        require_no_acl(path)
        return (actual.st_dev, actual.st_ino, actual.st_ctime_ns)
    except (OSError, subprocess.CalledProcessError) as error:
        raise Refused('writer lock identity is unobservable') from error


class WriterExclusion:
    def __init__(self, fd, path, identity, uid, gid):
        self.fd = fd
        self.path = path
        self.identity = identity
        self.uid = uid
        self.gid = gid

    def validate(self):
        if self.fd is None:
            raise Refused('writer lock is closed')
        if lock_identity(self.fd, self.path, self.uid, self.gid) != self.identity:
            raise Refused('writer lock identity changed')

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def _create(path, uid, gid):
    if sys.platform == 'darwin' and os.geteuid() == 0:
        raise Refused('production root writer lock creation awaits lifecycle recovery')
    path = pathlib.Path(path)
    try:
        protected_parent(path, uid, gid)
        previous_umask = os.umask(0o022)
        try:
            try:
                fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            except FileExistsError:
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    identity = lock_identity(fd, path, uid, gid)
                    sync_fd(fd)
                    sync_dir(path.parent)
                    return identity
                finally:
                    os.close(fd)
        finally:
            os.umask(previous_umask)
        try:
            os.fchmod(fd, 0o644)
            os.fchown(fd, uid, gid)
            sync_fd(fd)
            sync_dir(path.parent)
            return lock_identity(fd, path, uid, gid)
        finally:
            os.close(fd)
    except (OSError, subprocess.CalledProcessError) as error:
        raise Refused('writer lock creation refused') from error


def _acquire(path, uid, gid, seconds):
    path = pathlib.Path(path)
    try:
        protected_parent(path, uid, gid)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except (OSError, subprocess.CalledProcessError) as error:
        raise Refused('writer lock is absent or unobservable') from error
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
            except OSError as error:
                raise Refused('writer lock acquisition failed') from error
        if lock_identity(fd, path, uid, gid) != identity:
            raise Refused('writer lock path changed during acquisition')
        return WriterExclusion(fd, path, identity, uid, gid)
    except BaseException:
        os.close(fd)
        raise


def acquire_root_writer_lock(seconds=10):
    if sys.platform != 'darwin' or os.geteuid() != 0:
        raise Refused('root-owned NATS writer exclusion requires macOS root')
    return _acquire(LOCK, 0, 0, seconds)
