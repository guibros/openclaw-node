import hashlib
import json
import os
import pathlib
import re
import stat
import uuid

from preservation_checks import Refused, require


def identity(info):
    return {key: getattr(info, 'st_' + key, 0) for key in
            ('dev', 'ino', 'mode', 'nlink', 'size', 'mtime_ns', 'ctime_ns', 'flags')}


def digest_file(path, expected):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(identity(os.fstat(fd)) == expected, 'source identity changed before read')
        digest = hashlib.sha256()
        while chunk := os.read(fd, 1024 * 1024):
            digest.update(chunk)
        require(identity(os.fstat(fd)) == expected, 'source identity changed during read')
        return digest.hexdigest()
    finally:
        os.close(fd)


def capture_tree(root):
    root = pathlib.Path(root)
    require(stat.S_ISDIR(root.lstat().st_mode), 'store root is not a directory')
    result = {}
    device = root.lstat().st_dev
    def onerror(error):
        raise Refused('store directory could not be listed: ' + str(error.filename)) from error
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=onerror):
        path = pathlib.Path(directory)
        relative = path.relative_to(root).as_posix()
        before = identity(path.lstat())
        require(stat.S_ISDIR(before['mode']) and before['dev'] == device,
                'store directory changed or crossed a volume')
        entries = sorted(os.listdir(path))
        require(entries == sorted(dirs + files), 'store entries changed during traversal')
        result[relative] = {'type': 'directory', 'identity': before, 'entries': entries}
        for name in files:
            child = path / name
            info = child.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_dev == device,
                    'store contains a linked or non-regular file')
            item = identity(info)
            result[child.relative_to(root).as_posix()] = {
                'type': 'file', 'identity': item, 'sha256': digest_file(child, item)}
        for name in dirs:
            child = path / name
            require(stat.S_ISDIR(child.lstat().st_mode), 'store contains a linked directory')
        require(identity(path.lstat()) == before and sorted(os.listdir(path)) == entries,
                'store directory changed during traversal')
    for relative, item in result.items():
        if item['type'] == 'directory':
            require(all((pathlib.PurePosixPath(relative) / name).as_posix() in result
                        for name in item['entries']), 'store directory entry was not inventoried')
    return result


def capture(roots):
    require(isinstance(roots, dict) and len(roots) == 3, 'three store roots are required')
    require(all(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_-]+', name)
                for name in roots), 'store label is invalid')
    resolved = {name: pathlib.Path(root).resolve(strict=True) for name, root in roots.items()}
    require(len(set(resolved.values())) == len(resolved), 'store roots overlap')
    require(len({root.lstat().st_dev for root in resolved.values()}) == 1,
            'stores are on different volumes')
    for name, root in resolved.items():
        require(stat.S_ISDIR(pathlib.Path(roots[name]).lstat().st_mode),
                'store root is a link')
        require(not any(root == other or root in other.parents or other in root.parents
                        for other_name, other in resolved.items() if other_name != name),
                'store roots overlap')
    return {name: capture_tree(root) for name, root in sorted(resolved.items())}


def copy_view(captured):
    return {name: {relative: ({'type': 'file', 'sha256': item['sha256']}
                             if item['type'] == 'file' else
                             {'type': 'directory', 'entries': item['entries']})
                   for relative, item in entries.items()}
            for name, entries in captured.items()}


def verify_candidate(destination, manifest_sha256):
    destination = pathlib.Path(destination)
    root_info = destination.lstat()
    require(stat.S_ISDIR(root_info.st_mode) and root_info.st_uid == os.getuid()
            and stat.S_IMODE(root_info.st_mode) == 0o700,
            'candidate directory is not owner-private')
    manifest_path = destination / 'manifest.json'
    fd = os.open(manifest_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = identity(os.fstat(fd))
        require(stat.S_ISREG(before['mode']) and before['nlink'] == 1,
                'candidate manifest is not a regular file')
        body = bytearray()
        while chunk := os.read(fd, 1024 * 1024):
            body.extend(chunk)
        require(identity(os.fstat(fd)) == before,
                'candidate manifest changed during read')
    finally:
        os.close(fd)
    require(hashlib.sha256(body).hexdigest() == manifest_sha256,
            'candidate manifest differs from publication')
    manifest = json.loads(body)
    require(isinstance(manifest, dict) and set(manifest) ==
            {'schema', 'source_manifest_sha256', 'stores'} and manifest['schema'] == 1,
            'candidate manifest has an invalid schema')
    stores = manifest['stores']
    require(isinstance(stores, dict) and len(stores) == 3 and
            all(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_-]+', name)
                for name in stores), 'candidate manifest has invalid stores')
    require(set(os.listdir(destination)) == set(stores) | {'manifest.json'},
            'candidate root entries differ')
    actual = capture({name: destination / name for name in stores})
    require(copy_view(actual) == stores, 'candidate store bytes or entries differ')
    return {'status': 'candidate', 'manifest_sha256': manifest['source_manifest_sha256'],
            'copy_manifest_sha256': manifest_sha256}


def copy_file(source, target, expected):
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(identity(os.fstat(source_fd)) == expected['identity'],
                'source identity changed before copy')
        target_fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            digest = hashlib.sha256()
            while chunk := os.read(source_fd, 1024 * 1024):
                digest.update(chunk)
                view = memoryview(chunk)
                while view:
                    view = view[os.write(target_fd, view):]
            os.fsync(target_fd)
        finally:
            os.close(target_fd)
        require(identity(os.fstat(source_fd)) == expected['identity']
                and digest.hexdigest() == expected['sha256'],
                'source content changed during copy')
    finally:
        os.close(source_fd)


def copy_candidate(roots, destination, after_baseline=None, after_copy=None):
    baseline = capture(roots)
    if after_baseline is not None:
        after_baseline()
    destination = pathlib.Path(destination)
    destination_path = destination.resolve(strict=False)
    sources = [pathlib.Path(root).resolve(strict=True) for root in roots.values()]
    require(not os.path.lexists(destination) and stat.S_IMODE(destination.parent.stat().st_mode) == 0o700
            and destination.parent.stat().st_uid == os.getuid(),
            'copy destination parent is not owner-private')
    require(all(destination_path != root and destination_path not in root.parents
                and root not in destination_path.parents for root in sources),
            'copy destination overlaps a store')
    staging = destination.parent / ('.partial-' + destination.name + '-' + uuid.uuid4().hex)
    staging.mkdir(mode=0o700)
    for name, entries in baseline.items():
        root = pathlib.Path(roots[name])
        target_root = staging / name
        target_root.mkdir(mode=0o700)
        for relative, item in sorted(entries.items(), key=lambda pair: (pair[0].count('/'), pair[0])):
            if relative == '.':
                continue
            source = root / relative
            target = target_root / relative
            if item['type'] == 'directory':
                target.mkdir(mode=0o700)
            else:
                copy_file(source, target, item)
    if after_copy is not None:
        after_copy()
    require(capture(roots) == baseline, 'source stores changed across copy')
    copied = capture({name: staging / name for name in roots})
    for name, entries in baseline.items():
        require(set(copied[name]) == set(entries), 'copied store entries differ')
        for relative, item in entries.items():
            if item['type'] == 'file':
                require(copied[name][relative]['sha256'] == item['sha256'],
                        'copied store content differs')
            else:
                require(copied[name][relative]['entries'] == item['entries'],
                        'copied store directory entries differ')
    body = json.dumps(baseline, sort_keys=True, separators=(',', ':')).encode()
    source_digest = hashlib.sha256(body).hexdigest()
    manifest = {'schema': 1, 'source_manifest_sha256': source_digest,
                'stores': copy_view(copied)}
    manifest_body = json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()
    fd = os.open(staging / 'manifest.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600)
    try:
        view = memoryview(manifest_body)
        while view:
            view = view[os.write(fd, view):]
        os.fsync(fd)
    finally:
        os.close(fd)
    def sync_error(error):
        raise Refused('candidate directory could not be synced: ' + str(error.filename)) from error
    for directory, _, _ in os.walk(staging, onerror=sync_error):
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    os.rename(staging, destination)
    fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return {'status': 'candidate', 'manifest_sha256': source_digest,
            'copy_manifest_sha256': hashlib.sha256(manifest_body).hexdigest(),
            'files': sum(item['type'] == 'file' for entries in baseline.values()
                         for item in entries.values())}
