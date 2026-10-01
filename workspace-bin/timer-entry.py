#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys


class Refused(Exception):
    pass


def require(value, reason):
    if not value:
        raise Refused(reason)


def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def private(path):
    info = os.lstat(path)
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1,
            'entry file is not owner-private')


def regular_owner(path):
    info = os.lstat(path)
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1, 'entry source is not a single owner file')


def verify(manifest, label, argv):
    require(manifest['version'] == 1 and label in manifest['jobs'], 'entry manifest or label differs')
    job = manifest['jobs'][label]
    require(argv == job['argv'], 'application argv differs')
    require(os.getcwd() == job['cwd'], 'application working directory differs')
    require(os.environ.get('XPC_SERVICE_NAME') == label, 'launchd service identity differs')
    actual = set(os.environ)
    require(job['dynamic_environment'] == ['SSH_AUTH_SOCK'],
            'dynamic environment policy differs')
    require(actual - {'SSH_AUTH_SOCK'} == set(job['environment']),
            'received environment keys differ')
    for key, value in job['environment'].items():
        require(hashlib.sha256(os.environ[key].encode()).hexdigest() == value,
                'received environment value differs: ' + key)
    require(sha('/bin/launchctl') == manifest['executables']['/bin/launchctl'],
            'launchd environment reader differs')
    if 'SSH_AUTH_SOCK' in actual:
        domain_socket = subprocess.run(['/bin/launchctl', 'getenv', 'SSH_AUTH_SOCK'],
                                       check=True, capture_output=True, text=True).stdout.removesuffix('\n')
        require(bool(domain_socket) and os.environ['SSH_AUTH_SOCK'] == domain_socket,
                'SSH_AUTH_SOCK domain environment differs')
    for key in actual:
        require(not (key.startswith('DYLD_') or key.startswith('LD_') or key in {
            'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV', 'PYTHONPATH',
            'PYTHONHOME', 'PYTHONINSPECT', 'PYTHONSTARTUP'}),
            'unsupported loader or delegation environment: ' + key)
    for path, expected_sha in manifest['files'].items():
        regular_owner(path)
        require(sha(path) == expected_sha, 'entry source differs: ' + path)
    for path, expected_sha in manifest['executables'].items():
        require(pathlib.Path(path).is_file() and sha(path) == expected_sha,
                'delegated executable differs: ' + path)
    for name, path in manifest['resolution'].items():
        require(shutil.which(name) == path, 'delegated command resolution differs: ' + name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest')
    parser.add_argument('manifest_sha')
    parser.add_argument('label')
    parser.add_argument('gate_root')
    parser.add_argument('gate_lock_pin')
    parser.add_argument('gate_root_pin')
    args, argv = parser.parse_known_args()
    argv = argv[1:] if argv[:1] == ['--'] else argv
    try:
        private(args.manifest)
        require(sha(args.manifest) == args.manifest_sha, 'entry manifest differs')
        manifest = json.loads(pathlib.Path(args.manifest).read_text())
        require(sys.flags.isolated == 1 and sys.flags.no_site == 1
                and sys.executable == manifest['launcher_interpreter'],
                'timer entry interpreter or isolation differs')
        require(args.gate_root == manifest['gate_root']
                and {'lock': args.gate_lock_pin, 'root': args.gate_root_pin} == manifest['gate_pins'],
                'gate arguments differ')
        verify(manifest, args.label, argv)
        gate_path = manifest['gate_code']
        spec = importlib.util.spec_from_file_location('protected_service_gate', gate_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with module.Gate(args.gate_root, {'lock': args.gate_lock_pin,
                                          'root': args.gate_root_pin}) as gate:
            return gate.run(argv)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError, Refused) as error:
        print('timer entry refused: ' + str(error), file=sys.stderr)
        return 78


if __name__ == '__main__':
    sys.exit(main())
