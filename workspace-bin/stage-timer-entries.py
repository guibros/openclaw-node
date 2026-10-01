#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import plistlib
import re
import shutil
import subprocess
import time
import uuid


COHORT = ('scheduler-heartbeat', 'consolidation-scheduler', 'observer',
          'transcript-archive', 'log-rotate')
DELEGATED = {
    'scheduler-heartbeat': (),
    'consolidation-scheduler': (),
    'observer': ('launchctl', 'sqlite3'),
    'transcript-archive': ('mkdir', 'rsync', 'date', 'find', 'wc', 'tr', 'du', 'cut'),
    'log-rotate': ('date', 'wc', 'tr', 'gzip', 'ls', 'tail', 'xargs', 'rm'),
}
PROBE = '''import hashlib,json,os,sys
with open(sys.argv[1], 'x') as f:
 os.chmod(sys.argv[1], 0o600)
 json.dump({'environment':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in os.environ.items()},'path':os.environ.get('PATH',''),'cwd':os.getcwd(),'label':os.environ.get('XPC_SERVICE_NAME')},f)
'''


def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def run(*args):
    result = subprocess.run(args, text=True, capture_output=True, check=True)
    return result.stdout


def block(text, name):
    match = re.search(r'\n\t' + re.escape(name) + r' = \{\n(.*?)\n\t\}', text, re.S)
    if not match:
        raise RuntimeError('loaded service lacks ' + name)
    return [line.strip() for line in match.group(1).splitlines()]


def loaded(label, plist):
    text = run('launchctl', 'print', f'gui/{os.getuid()}/{label}')
    argv = block(text, 'arguments')
    if argv != plist['ProgramArguments']:
        raise RuntimeError('loaded argv differs: ' + label)
    if f'\tprogram = {argv[0]}' not in text:
        raise RuntimeError('loaded program differs: ' + label)
    for key, field in (('StandardOutPath', 'stdout path'), ('StandardErrorPath', 'stderr path')):
        if f'\t{field} = {plist[key]}' not in text:
            raise RuntimeError('loaded log path differs: ' + label)
    configured = plist.get('EnvironmentVariables', {})
    current = {}
    for row in block(text, 'environment'):
        name, value = row.split(' => ', 1)
        current[name] = value
    if any(current.get(key) != value for key, value in configured.items()):
        raise RuntimeError('loaded configured environment differs: ' + label)
    if 'StartInterval' in plist and f'\trun interval = {plist["StartInterval"]} seconds' not in text:
        raise RuntimeError('loaded interval differs: ' + label)
    if plist.get('RunAtLoad') and 'runatload' not in text:
        raise RuntimeError('loaded run-at-load differs: ' + label)
    if 'StartCalendarInterval' in plist:
        if 'stream = com.apple.launchd.calendarinterval' not in text:
            raise RuntimeError('loaded calendar schedule missing: ' + label)
        if any(f'"{key}" => {value}' not in text
               for key, value in plist['StartCalendarInterval'].items()):
            raise RuntimeError('loaded calendar schedule differs: ' + label)
    if 'WorkingDirectory' in plist and f'\tworking directory = {plist["WorkingDirectory"]}' not in text:
        raise RuntimeError('loaded cwd differs: ' + label)
    return sha_bytes(text.encode())


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def received_environment(received, configured, label):
    environment = dict(received['environment'])
    if 'SSH_AUTH_SOCK' in configured:
        raise RuntimeError('SSH_AUTH_SOCK must be inherited: ' + label)
    if 'SSH_AUTH_SOCK' in environment:
        domain_value = run('/bin/launchctl', 'getenv', 'SSH_AUTH_SOCK').removesuffix('\n')
        if not domain_value or environment.pop('SSH_AUTH_SOCK') != sha_bytes(domain_value.encode()):
            raise RuntimeError('SSH_AUTH_SOCK domain environment differs: ' + label)
    environment['XPC_SERVICE_NAME'] = sha_bytes(label.encode())
    return environment


def probe(label, original, root):
    probe_label = 'ai.openclaw.timer-entry-probe-' + uuid.uuid4().hex[:12]
    output = root / (probe_label + '.json')
    plist_path = root / (probe_label + '.plist')
    probe_plist = {'Label': probe_label,
                   'ProgramArguments': ['/usr/bin/python3', '-I', '-S', '-c', PROBE, str(output)],
                   'EnvironmentVariables': original.get('EnvironmentVariables', {}),
                   'RunAtLoad': True,
                   'StandardOutPath': str(root / 'probe.stdout'),
                   'StandardErrorPath': str(root / 'probe.stderr')}
    if 'WorkingDirectory' in original:
        probe_plist['WorkingDirectory'] = original['WorkingDirectory']
    plist_path.write_bytes(plistlib.dumps(probe_plist))
    domain = f'gui/{os.getuid()}'
    try:
        run('launchctl', 'bootstrap', domain, str(plist_path))
        result = None
        for _ in range(100):
            if output.exists():
                try:
                    result = json.loads(output.read_text())
                    break
                except json.JSONDecodeError:
                    pass
            time.sleep(.05)
        if result is None:
            raise RuntimeError('launchd environment probe timed out: ' + label)
        if result['label'] != probe_label:
            raise RuntimeError('launchd environment identity differs: ' + label)
        return result
    finally:
        subprocess.run(['launchctl', 'bootout', f'{domain}/{probe_label}'],
                       capture_output=True)
        for item in (output, plist_path):
            item.unlink(missing_ok=True)


def source_files(release, jobs):
    found = [release / 'consolidation-graph.json']
    for tree in ('bin', 'lib', 'packages', 'node_modules'):
        found += [path for path in (release / tree).rglob('*') if path.is_file()]
    found += [release / 'package.json', release / 'package-lock.json']
    found += [pathlib.Path(path) for job in jobs.values() for path in job['source']]
    return sorted(set(found))


def _stage(output, release, source_root):
    if output.exists():
        raise RuntimeError('candidate already exists; baseline will not be recaptured')
    if not release.is_dir() or sha(release / 'consolidation-graph.json') != '6159fb51b28dfc6834962c95afc61fac609cdb758438616a68928290049ddab8':
        raise RuntimeError('accepted Node24 private release differs')
    output.mkdir(mode=0o700)
    (output / 'candidates').mkdir(mode=0o700)
    code = output / 'timer-entry.py'
    gate_code = output / 'service_gate.py'
    shutil.copyfile(source_root / 'workspace-bin/timer-entry.py', code)
    shutil.copyfile(source_root / 'workspace-bin/service_gate.py', gate_code)
    code.chmod(0o600)
    gate_code.chmod(0o600)
    observer_root = output / 'observer'
    (observer_root / 'bin').mkdir(parents=True, mode=0o700)
    (observer_root / 'lib').mkdir(mode=0o700)
    for rel in ('bin/observer.mjs', 'lib/observer.mjs'):
        target = observer_root / rel
        shutil.copyfile(source_root / rel, target)
        target.chmod(0o600)
    spec = importlib.util.spec_from_file_location('staged_service_gate', gate_code)
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    pins = gate.initialize(str(output / 'gate'))
    jobs = {}
    originals = {}
    loaded_hashes = {}
    resolutions = {}
    executables = {}
    for name in COHORT:
        label = 'ai.openclaw.' + name
        path = pathlib.Path.home() / 'Library/LaunchAgents' / (label + '.plist')
        original = plistlib.loads(path.read_bytes())
        if original['Label'] != label:
            raise RuntimeError('installed label differs: ' + label)
        loaded_hashes[label] = loaded(label, original)
        received = probe(label, original, output)
        environment = received_environment(received, original.get('EnvironmentVariables', {}), label)
        argv = list(original['ProgramArguments'])
        if name == 'consolidation-scheduler':
            expected_script = str(pathlib.Path.home() / '.openclaw/workspace/bin/consolidation-scheduler.mjs')
            if argv != ['/usr/local/bin/node', expected_script] or not pathlib.Path(expected_script).is_file():
                raise RuntimeError('loaded consolidation application argv shape differs')
            argv[1] = str(release / 'bin/consolidation-scheduler.mjs')
        if name == 'observer':
            if len(argv) != 3 or argv[0] != '/usr/local/bin/node' or argv[2] != '--sample':
                raise RuntimeError('loaded observer application argv shape differs')
            live_script = pathlib.Path(argv[1])
            if not live_script.is_symlink() or sha(live_script) != sha(source_root / 'bin/observer.mjs'):
                raise RuntimeError('observer source link or tracked content differs')
            live_lib = live_script.parent.parent / 'lib/observer.mjs'
            if sha(live_lib) != sha(source_root / 'lib/observer.mjs'):
                raise RuntimeError('observer local module differs')
            argv[1] = str(observer_root / 'bin/observer.mjs')
        sources = [argv[1]]
        if name == 'observer':
            sources.append(str(observer_root / 'lib/observer.mjs'))
        if name == 'consolidation-scheduler':
            sources = []
        jobs[label] = {'argv': argv, 'cwd': received['cwd'],
                       'environment': environment,
                       'dynamic_environment': ['SSH_AUTH_SOCK'], 'source': sources}
        originals[label] = {'plist_sha256': sha(path), 'loaded_sha256': loaded_hashes[label]}
        if name == 'observer':
            originals[label]['source_link'] = os.readlink(live_script)
            originals[label]['source_sha256'] = sha(live_script)
            originals[label]['module_sha256'] = sha(live_lib)
        executables[argv[0]] = sha(argv[0])
        for command in DELEGATED[name]:
            resolved = shutil.which(command, path=received['path'])
            if not resolved or not pathlib.Path(resolved).is_absolute():
                raise RuntimeError('unresolved delegated command: ' + command)
            if command in resolutions and resolutions[command] != resolved:
                raise RuntimeError('delegated command changes by unit: ' + command)
            resolutions[command] = resolved
            executables[resolved] = sha(resolved)
    executables['/usr/bin/python3'] = sha('/usr/bin/python3')
    executables['/usr/sbin/sysctl'] = sha('/usr/sbin/sysctl')
    executables['/bin/launchctl'] = sha('/bin/launchctl')
    launcher_interpreter = run('/usr/bin/python3', '-I', '-S', '-c', 'import sys;print(sys.executable)').strip()
    executables[launcher_interpreter] = sha(launcher_interpreter)
    files = source_files(release, jobs) + [code, gate_code]
    for path in files:
        info = path.lstat()
        if not path.is_file() or path.is_symlink() or info.st_nlink != 1 or info.st_uid != os.getuid():
            raise RuntimeError('source path is not a single regular file: ' + str(path))
    manifest = {'version': 1, 'gate_code': str(gate_code), 'gate_root': str(output / 'gate'),
                'launcher_interpreter': launcher_interpreter, 'jobs': jobs,
                'files': {str(path): sha(path) for path in files},
                'executables': executables, 'resolution': resolutions,
                'originals': originals, 'gate_pins': pins,
                'release_manifest_sha256': sha(release / 'consolidation-graph.json')}
    manifest_path = output / 'timer-entry-manifest.json'
    manifest_path.write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n')
    manifest_path.chmod(0o600)
    manifest_sha = sha(manifest_path)
    for name in COHORT:
        label = 'ai.openclaw.' + name
        path = pathlib.Path.home() / 'Library/LaunchAgents' / (label + '.plist')
        original = plistlib.loads(path.read_bytes())
        candidate = dict(original)
        candidate['ProgramArguments'] = ['/usr/bin/python3', '-I', '-S', str(code),
            str(manifest_path), manifest_sha, label, str(output / 'gate'),
            pins['lock'], pins['root'], '--', *jobs[label]['argv']]
        candidate_path = output / 'candidates' / (label + '.plist')
        candidate_path.write_bytes(plistlib.dumps(candidate))
        candidate_path.chmod(0o600)
    evidence = {'candidate_root': str(output), 'manifest_sha256': manifest_sha,
                'release_manifest_sha256': manifest['release_manifest_sha256'],
                'jobs': {name: {'environment_keys': sorted(set(job['environment']) | set(job['dynamic_environment'])),
                                'cwd': job['cwd'], 'candidate_plist_sha256': sha(output / 'candidates' / (name + '.plist'))}
                         for name, job in jobs.items()},
                'source_files': len(files), 'delegated_executables': sorted(executables)}
    (output / 'evidence.json').write_text(json.dumps(evidence, sort_keys=True, indent=2) + '\n')
    (output / 'evidence.json').chmod(0o600)
    return evidence


def stage(output, release, source_root):
    if output.exists():
        raise RuntimeError('candidate already exists; baseline will not be recaptured')
    try:
        return _stage(output, release, source_root)
    except BaseException:
        if output.exists():
            shutil.rmtree(output)
        raise


def verify(output):
    manifest_path = output / 'timer-entry-manifest.json'
    evidence_path = output / 'evidence.json'
    manifest = json.loads(manifest_path.read_text())
    evidence = json.loads(evidence_path.read_text())
    if sha(manifest_path) != evidence['manifest_sha256']:
        raise RuntimeError('saved candidate manifest differs')
    if manifest['version'] != 1 or set(manifest['jobs']) != {'ai.openclaw.' + name for name in COHORT}:
        raise RuntimeError('saved candidate cohort differs')
    for path, expected in manifest['files'].items():
        item = pathlib.Path(path)
        if not item.is_file() or item.is_symlink() or item.stat().st_nlink != 1 \
                or item.stat().st_uid != os.getuid() or sha(item) != expected:
            raise RuntimeError('saved source differs: ' + path)
    for path, expected in manifest['executables'].items():
        if sha(path) != expected:
            raise RuntimeError('saved executable differs: ' + path)
    spec = importlib.util.spec_from_file_location('verified_service_gate', manifest['gate_code'])
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    with gate.Gate(manifest['gate_root'], manifest['gate_pins']) as held:
        held.validate()
    for name in COHORT:
        label = 'ai.openclaw.' + name
        original_path = pathlib.Path.home() / 'Library/LaunchAgents' / (label + '.plist')
        if sha(original_path) != manifest['originals'][label]['plist_sha256']:
            raise RuntimeError('installed original plist differs: ' + label)
        original = plistlib.loads(original_path.read_bytes())
        loaded(label, original)
        received = probe(label, original, output)
        environment = received_environment(received, original.get('EnvironmentVariables', {}), label)
        if manifest['jobs'][label]['dynamic_environment'] != ['SSH_AUTH_SOCK'] \
                or environment != manifest['jobs'][label]['environment'] \
                or received['cwd'] != manifest['jobs'][label]['cwd']:
            raise RuntimeError('received launch environment drifted: ' + label)
        for command in DELEGATED[name]:
            if shutil.which(command, path=received['path']) != manifest['resolution'][command]:
                raise RuntimeError('delegated command resolution drifted: ' + label + ':' + command)
        if name == 'observer':
            original_script = pathlib.Path(original['ProgramArguments'][1])
            prior = manifest['originals'][label]
            if not original_script.is_symlink() or os.readlink(original_script) != prior['source_link'] \
                    or sha(original_script) != prior['source_sha256'] \
                    or sha(original_script.parent.parent / 'lib/observer.mjs') != prior['module_sha256']:
                raise RuntimeError('original observer source mapping drifted')
        candidate_path = output / 'candidates' / (label + '.plist')
        if sha(candidate_path) != evidence['jobs'][label]['candidate_plist_sha256']:
            raise RuntimeError('saved candidate plist differs: ' + label)
        candidate = plistlib.loads(candidate_path.read_bytes())
        expected = dict(original)
        expected['ProgramArguments'] = ['/usr/bin/python3', '-I', '-S', str(output / 'timer-entry.py'),
            str(manifest_path), evidence['manifest_sha256'], label, manifest['gate_root'],
            manifest['gate_pins']['lock'], manifest['gate_pins']['root'], '--',
            *manifest['jobs'][label]['argv']]
        if candidate != expected:
            raise RuntimeError('candidate does not preserve installed settings: ' + label)
    return {'verified': True, 'candidate_root': str(output),
            'manifest_sha256': evidence['manifest_sha256'], 'jobs': len(COHORT),
            'source_files': len(manifest['files'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('release', type=pathlib.Path, nargs='?')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify(args.output), sort_keys=True))
    else:
        if args.release is None:
            parser.error('release is required to stage a new candidate')
        print(json.dumps(stage(args.output, args.release,
                               pathlib.Path(__file__).resolve().parent.parent), sort_keys=True))
