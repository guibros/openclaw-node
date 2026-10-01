#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile


COHORT = ('scheduler-heartbeat', 'consolidation-scheduler', 'observer',
          'transcript-archive', 'log-rotate')
DEPLOYED_CONSOLIDATION_SHA256 = 'a9eb20eed46875d7a8107c3804ca5d1d6b30da7e83c0a1213f5f1da9ecdab703'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return pathlib.Path(path).read_bytes()


def write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_dir(path):
    info = pathlib.Path(path).stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('transition artifact directory is not owner-private')


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError('old entry source shape differs')
    return source.replace(old, new, 1)


def fence(name, source, target, label=None):
    label = label or 'ai.openclaw.' + name
    if name == 'scheduler-heartbeat':
        old = b'if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();'
        new = ("if (process.env.XPC_SERVICE_NAME !== '" + label +
               "' && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();").encode()
        return replace_once(source, old, new)
    if name == 'consolidation-scheduler':
        old = b"if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/consolidation-scheduler.mjs')) {"
        new = ("if (process.env.XPC_SERVICE_NAME !== '" + label +
               "' && (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/consolidation-scheduler.mjs'))) {").encode()
        return replace_once(source, old, new)
    if name == 'observer':
        uri = pathlib.Path(target).as_uri()
        return ("#!/usr/bin/env node\nif (process.env.XPC_SERVICE_NAME !== '" + label +
                "') await import(" + json.dumps(uri) + ");\n").encode()
    if name in ('transcript-archive', 'log-rotate'):
        if not source.startswith(b'#!'):
            raise RuntimeError('old shell entry lacks shebang')
        first, rest = source.split(b'\n', 1)
        guard = ("if [ \"${XPC_SERVICE_NAME-}\" = '" + label +
                 "' ]; then exit 0; fi\n").encode()
        return first + b'\n' + guard + rest
    raise RuntimeError('unknown timer')


def candidate_check(candidate):
    candidate = pathlib.Path(candidate)
    script = pathlib.Path(__file__).with_name('stage-timer-entries.py')
    result = subprocess.run([sys.executable, str(script), str(candidate), '--verify'],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('saved timer candidate no longer verifies: ' + result.stderr.strip())
    evidence = json.loads(read(candidate / 'evidence.json'))
    manifest_bytes = read(candidate / 'timer-entry-manifest.json')
    if digest(manifest_bytes) != evidence['manifest_sha256']:
        raise RuntimeError('candidate manifest differs')
    return json.loads(manifest_bytes), evidence


def stage(candidate, output):
    candidate = pathlib.Path(candidate).resolve()
    output = pathlib.Path(output).resolve()
    manifest, evidence = candidate_check(candidate)
    private_dir(output.parent)
    if os.path.lexists(output):
        raise RuntimeError('transition output already exists')
    staged = pathlib.Path(tempfile.mkdtemp(prefix='.' + output.name + '-', dir=output.parent))
    try:
        (staged / 'originals').mkdir(mode=0o700)
        (staged / 'fences').mkdir(mode=0o700)
        jobs = {}
        for name in COHORT:
            label = 'ai.openclaw.' + name
            plist_path = pathlib.Path.home() / 'Library/LaunchAgents' / (label + '.plist')
            plist_bytes = read(plist_path)
            if digest(plist_bytes) != manifest['originals'][label]['plist_sha256']:
                raise RuntimeError('original plist differs: ' + label)
            plist = plistlib.loads(plist_bytes)
            if plist.get('AbandonProcessGroup') is True:
                raise RuntimeError('old job can abandon its child group: ' + label)
            path = pathlib.Path(plist['ProgramArguments'][1])
            link_info = path.lstat()
            if link_info.st_uid != os.getuid():
                raise RuntimeError('old source is not owner-owned: ' + label)
            if path.parent.stat().st_dev != staged.stat().st_dev:
                raise RuntimeError('atomic source fence crosses a filesystem: ' + label)
            is_link = path.is_symlink()
            if is_link != (name == 'observer'):
                raise RuntimeError('old source link shape differs: ' + label)
            link_target = os.readlink(path) if is_link else None
            target = path.resolve() if is_link else path
            source_bytes = read(target)
            if is_link:
                prior = manifest['originals'][label]
                if link_target != prior['source_link'] or digest(source_bytes) != prior['source_sha256']:
                    raise RuntimeError('observer source target differs')
            elif str(path) in manifest['files'] and digest(source_bytes) != manifest['files'][str(path)]:
                raise RuntimeError('old source differs from candidate pin: ' + label)
            if name == 'consolidation-scheduler' and digest(source_bytes) != DEPLOYED_CONSOLIDATION_SHA256:
                raise RuntimeError('deployed consolidation source differs from reviewed entry')
            replacement = fence(name, source_bytes, target)
            write(staged / 'originals' / (name + '.plist'), plist_bytes)
            write(staged / 'originals' / (name + '.source'), source_bytes)
            write(staged / 'fences' / (name + '.source'), replacement)
            jobs[label] = {
                'path': str(path), 'link_target': link_target,
                'mode': stat.S_IMODE(target.stat().st_mode),
                'identity': [link_info.st_dev, link_info.st_ino, link_info.st_ctime_ns],
                'source_sha256': digest(source_bytes), 'fence_sha256': digest(replacement),
                'plist_sha256': digest(plist_bytes),
            }
        data = {'version': 1, 'candidate': str(candidate),
                'candidate_manifest_sha256': evidence['manifest_sha256'], 'jobs': jobs}
        write(staged / 'transition-manifest.json', (json.dumps(data, sort_keys=True, indent=2) + '\n').encode())
        for part in (staged / 'originals', staged / 'fences', staged):
            sync_dir(part)
        os.replace(staged, output)
        sync_dir(output.parent)
        return {'staged': True, 'jobs': len(jobs),
                'manifest_sha256': digest(read(output / 'transition-manifest.json'))}
    finally:
        if staged.exists():
            shutil.rmtree(staged)


def verify(output):
    output = pathlib.Path(output).resolve()
    for part in (output, output / 'originals', output / 'fences'):
        private_dir(part)
    data = json.loads(read(output / 'transition-manifest.json'))
    if data['version'] != 1 or set(data['jobs']) != {'ai.openclaw.' + name for name in COHORT}:
        raise RuntimeError('transition manifest shape differs')
    candidate, evidence = candidate_check(data['candidate'])
    if data['candidate_manifest_sha256'] != evidence['manifest_sha256']:
        raise RuntimeError('timer candidate changed')
    originals = {name + suffix for name in COHORT for suffix in ('.plist', '.source')}
    fences = {name + '.source' for name in COHORT}
    if {p.name for p in output.iterdir()} != {'originals', 'fences', 'transition-manifest.json'} \
            or {p.name for p in (output / 'originals').iterdir()} != originals \
            or {p.name for p in (output / 'fences').iterdir()} != fences:
        raise RuntimeError('transition artifact inventory differs')
    artifacts = [output / 'transition-manifest.json']
    artifacts.extend((output / 'originals' / name for name in originals))
    artifacts.extend((output / 'fences' / name for name in fences))
    for artifact in artifacts:
        info = artifact.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() \
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
            raise RuntimeError('transition artifact is not owner-private')
    for name in COHORT:
        label = 'ai.openclaw.' + name
        job = data['jobs'][label]
        path = pathlib.Path(job['path'])
        info = path.lstat()
        if [info.st_dev, info.st_ino, info.st_ctime_ns] != job['identity']:
            raise RuntimeError('old source identity changed: ' + label)
        if (os.readlink(path) if path.is_symlink() else None) != job['link_target']:
            raise RuntimeError('old source link changed: ' + label)
        source_bytes = read(path.resolve())
        if digest(source_bytes) != job['source_sha256'] \
                or digest(read(output / 'originals' / (name + '.source'))) != job['source_sha256'] \
                or digest(read(output / 'fences' / (name + '.source'))) != job['fence_sha256'] \
                or digest(read(output / 'originals' / (name + '.plist'))) != job['plist_sha256']:
            raise RuntimeError('transition source or artifact changed: ' + label)
        plist_path = pathlib.Path.home() / 'Library/LaunchAgents' / (label + '.plist')
        if digest(read(plist_path)) != job['plist_sha256']:
            raise RuntimeError('installed plist changed: ' + label)
    return {'verified': True, 'jobs': len(COHORT),
            'manifest_sha256': digest(read(output / 'transition-manifest.json'))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output')
    parser.add_argument('--candidate')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    old_umask = os.umask(0o077)
    try:
        result = verify(args.output) if args.verify else stage(args.candidate, args.output)
        print(json.dumps(result, sort_keys=True))
    finally:
        os.umask(old_umask)


if __name__ == '__main__':
    main()
