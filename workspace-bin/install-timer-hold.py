#!/usr/bin/env python3
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import plistlib
import re
import secrets
import stat
import subprocess
import sys
import tempfile
import time


NAMES = ('scheduler-heartbeat', 'consolidation-scheduler', 'observer',
         'transcript-archive', 'log-rotate')
TRANSITION_HASH = '6e9b54f0a9e49c77901be7e97ac2cc48ea6a1c8fd2ea51824cd6c630e2df3e73'
ENTRY_HASH = '96e829f379978d0b67e61d2464d3624e4a9d426e8671fac4dab1e9c5a47d4644'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return pathlib.Path(path).read_bytes()


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
        if sys.platform == 'darwin':
            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
    finally:
        os.close(fd)


def private(path, directory=False):
    info = pathlib.Path(path).lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    mode = 0o700 if directory else 0o600
    if not expected(info.st_mode) or info.st_uid != os.getuid() \
            or stat.S_IMODE(info.st_mode) != mode or (not directory and info.st_nlink != 1):
        raise RuntimeError('commissioning artifact is not owner-private: ' + str(path))


def write_temp(path, data, mode):
    path = pathlib.Path(path)
    if os.path.lexists(path):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 \
                or digest(read(path)) != digest(data) or stat.S_IMODE(info.st_mode) != mode:
            raise RuntimeError('commissioning temporary file differs: ' + str(path))
        return
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fchmod(stream.fileno(), mode)
        os.fsync(stream.fileno())
    sync_dir(path.parent)


def locked_file(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() \
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
        os.close(fd)
        raise RuntimeError('timer commissioning lock is not owner-private: ' + str(path))
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        os.close(fd)
        raise
    return fd


class Installer:
    def __init__(self, transition, entries, home=None):
        self.home = pathlib.Path(home or pathlib.Path.home()).resolve()
        self.transition = pathlib.Path(transition).resolve()
        self.entries = pathlib.Path(entries).resolve()
        for part in (self.transition, self.transition / 'originals',
                     self.transition / 'fences', self.entries, self.entries / 'candidates'):
            private(part, directory=True)
        transition_path = self.transition / 'transition-manifest.json'
        entry_path = self.entries / 'timer-entry-manifest.json'
        private(transition_path)
        private(entry_path)
        if digest(read(transition_path)) != TRANSITION_HASH:
            raise RuntimeError('transition candidate is not the accepted manifest')
        evidence = json.loads(read(self.entries / 'evidence.json'))
        if digest(read(entry_path)) != ENTRY_HASH or evidence['manifest_sha256'] != ENTRY_HASH:
            raise RuntimeError('timer entry candidate is not the accepted manifest')
        self.transition_data = json.loads(read(transition_path))
        self.entry_data = json.loads(read(entry_path))
        if self.transition_data['candidate'] != str(self.entries) \
                or self.transition_data['candidate_manifest_sha256'] != ENTRY_HASH:
            raise RuntimeError('transition and entry candidates do not match')
        self.evidence = evidence
        if set(self.transition_data['jobs']) != {'ai.openclaw.' + name for name in NAMES}:
            raise RuntimeError('transition cohort differs')
        self.verify_artifacts()

    def label(self, name):
        return 'ai.openclaw.' + name

    def job(self, name):
        return self.transition_data['jobs'][self.label(name)]

    def plist_path(self, name):
        return self.home / 'Library/LaunchAgents' / (self.label(name) + '.plist')

    def source_path(self, name):
        return pathlib.Path(self.job(name)['path'])

    def candidate(self, name):
        return self.entries / 'candidates' / (self.label(name) + '.plist')

    def verify_artifacts(self):
        for name in NAMES:
            label = self.label(name)
            job = self.job(name)
            for folder, suffix, key in (('originals', '.plist', 'plist_sha256'),
                                        ('originals', '.source', 'source_sha256'),
                                        ('fences', '.source', 'fence_sha256')):
                path = self.transition / folder / (name + suffix)
                private(path)
                if digest(read(path)) != job[key]:
                    raise RuntimeError('saved transition artifact differs: ' + label)
            candidate = self.candidate(name)
            private(candidate)
            if digest(read(candidate)) != self.evidence['jobs'][label]['candidate_plist_sha256']:
                raise RuntimeError('saved timer entry differs: ' + label)
        for path, expected in self.entry_data['files'].items():
            if path in {self.job(name)['path'] for name in NAMES}:
                continue
            info = pathlib.Path(path).lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() \
                    or info.st_nlink != 1 or digest(read(path)) != expected:
                raise RuntimeError('protected timer source differs: ' + path)
        for path, expected in self.entry_data['executables'].items():
            if digest(read(path)) != expected:
                raise RuntimeError('timer executable differs: ' + path)

    def inherited_path_hash(self, expected):
        with tempfile.TemporaryDirectory(prefix='timer-path-probe-', dir=self.transition.parent) as place:
            root = pathlib.Path(place)
            label = 'ai.openclaw.timer-path-probe-' + secrets.token_hex(6)
            output = root / 'path.sha256'
            probe = {'Label': label,
                     'ProgramArguments': ['/usr/bin/python3', '-I', '-S', '-c',
                                          'import hashlib,os,sys; '
                                          'open(sys.argv[1], "x").write('
                                          'hashlib.sha256(os.environ.get("PATH", "").encode()).hexdigest())',
                                          str(output)],
                     'EnvironmentVariables': expected.get('EnvironmentVariables', {}),
                     'RunAtLoad': True,
                     'StandardOutPath': str(root / 'stdout'),
                     'StandardErrorPath': str(root / 'stderr')}
            plist = root / (label + '.plist')
            plist.write_bytes(plistlib.dumps(probe))
            target = f'gui/{os.getuid()}/{label}'
            subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(plist)],
                           check=True, timeout=5, capture_output=True)
            try:
                for _ in range(100):
                    if output.exists():
                        value = output.read_text()
                        if re.fullmatch(r'[0-9a-f]{64}', value):
                            return value
                        raise RuntimeError('inherited timer PATH probe was invalid')
                    time.sleep(.05)
                raise RuntimeError('inherited timer PATH probe did not run')
            finally:
                subprocess.run(['/bin/launchctl', 'bootout', target],
                               check=True, timeout=5, capture_output=True)

    def launch(self, name):
        target = f'gui/{os.getuid()}/{self.label(name)}'
        result = subprocess.run(['/bin/launchctl', 'print', target], capture_output=True, text=True)
        user = subprocess.run(['/bin/launchctl', 'print',
                               f'user/{os.getuid()}/{self.label(name)}'], capture_output=True, text=True)
        if user.returncode == 0 or user.returncode != 113 or 'Could not find service' not in user.stderr:
            raise RuntimeError('timer label has an unexpected user-domain owner: ' + self.label(name))
        disabled = subprocess.run(['/bin/launchctl', 'print-disabled', f'gui/{os.getuid()}'],
                                  capture_output=True, text=True, check=True).stdout
        values = re.findall(r'^\s*"' + re.escape(self.label(name)) + r'" => ([^\n]+)$', disabled, re.M)
        if len(values) > 1 or values == ['disabled'] or values and values != ['enabled']:
            raise RuntimeError('timer disabled override differs: ' + self.label(name))
        if result.returncode:
            if result.returncode != 113 or 'Could not find service' not in result.stderr:
                raise RuntimeError('timer loaded state could not be read: ' + self.label(name))
            return {'kind': 'none', 'running': False}
        text = result.stdout
        match = re.search(r'^\s*arguments = \{\n(.*?)^\s*\}', text, re.M | re.S)
        if match is None:
            raise RuntimeError('timer loaded arguments are absent: ' + self.label(name))
        args = [line.strip() for line in match[1].splitlines()]
        old = plistlib.loads(read(self.transition / 'originals' / (name + '.plist')))
        new = plistlib.loads(read(self.candidate(name)))
        kind = 'old' if args == old['ProgramArguments'] else 'new' if args == new['ProgramArguments'] else 'unknown'
        if kind != 'unknown':
            expected = old if kind == 'old' else new
            if expected['Label'] != self.label(name) or f'\tprogram = {args[0]}' not in text \
                    or f'\tpath = {self.plist_path(name)}' not in text:
                raise RuntimeError('timer loaded program or provenance differs: ' + self.label(name))
            for key, field in (('StandardOutPath', 'stdout path'), ('StandardErrorPath', 'stderr path')):
                if f'\t{field} = {expected[key]}' not in text:
                    raise RuntimeError('timer loaded log path differs: ' + self.label(name))
            if 'WorkingDirectory' in expected \
                    and f'\tworking directory = {expected["WorkingDirectory"]}' not in text:
                raise RuntimeError('timer loaded working directory differs: ' + self.label(name))
            env = re.search(r'^\s*environment = \{\n(.*?)^\s*\}', text, re.M | re.S)
            if env is None:
                raise RuntimeError('timer loaded environment is absent: ' + self.label(name))
            current = dict(re.findall(r'^\s*([A-Za-z0-9_]+) => (.*)$', env[1], re.M))
            if any(current.get(k) != v for k, v in expected.get('EnvironmentVariables', {}).items()):
                raise RuntimeError('timer loaded environment differs: ' + self.label(name))
            if kind == 'new':
                observed_path = (digest(current.get('PATH', '').encode())
                                 if 'PATH' in expected.get('EnvironmentVariables', {})
                                 else self.inherited_path_hash(expected))
                if observed_path != self.entry_data['jobs'][self.label(name)]['environment']['PATH']:
                    raise RuntimeError('timer loaded delegated PATH differs: ' + self.label(name))
            if 'StartInterval' in expected \
                    and f'\trun interval = {expected["StartInterval"]} seconds' not in text:
                raise RuntimeError('timer loaded interval differs: ' + self.label(name))
            if expected.get('RunAtLoad') and 'runatload' not in text:
                raise RuntimeError('timer loaded RunAtLoad differs: ' + self.label(name))
            if 'StartCalendarInterval' in expected:
                if 'stream = com.apple.launchd.calendarinterval' not in text \
                        or any(f'"{k}" => {v}' not in text
                               for k, v in expected['StartCalendarInterval'].items()):
                    raise RuntimeError('timer loaded calendar schedule differs: ' + self.label(name))
        pid = re.search(r'^\s*pid = (\d+)$', text, re.M)
        runs = re.search(r'^\s*runs = (\d+)$', text, re.M)
        exit_code = re.search(r'^\s*last exit code = (\d+)$', text, re.M)
        return {'kind': kind, 'running': pid is not None,
                'pid': int(pid[1]) if pid else None, 'runs': int(runs[1]) if runs else None,
                'last_exit_code': int(exit_code[1]) if exit_code else None,
                'text': text}

    def source(self, name):
        path = self.source_path(name)
        info = path.lstat()
        if info.st_uid != os.getuid():
            raise RuntimeError('timer source owner differs: ' + self.label(name))
        job = self.job(name)
        if path.is_symlink():
            kind = 'old' if os.readlink(path) == job['link_target'] \
                and digest(read(path)) == job['source_sha256'] else 'unknown'
        elif stat.S_ISREG(info.st_mode):
            if info.st_nlink != 1:
                raise RuntimeError('timer source acquired another hard link: ' + self.label(name))
            value = digest(read(path))
            kind = 'old' if job['link_target'] is None and value == job['source_sha256'] \
                else 'fence' if value == job['fence_sha256'] else 'unknown'
        else:
            kind = 'unknown'
        return {'kind': kind, 'flags': info.st_flags,
                'immutable': bool(info.st_flags & stat.UF_IMMUTABLE),
                'identity': [info.st_dev, info.st_ino, info.st_ctime_ns]}

    def state(self, name):
        job = self.job(name)
        plist = self.plist_path(name)
        info = plist.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() \
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o644:
            raise RuntimeError('timer installed plist is not a single owner file: ' + self.label(name))
        value = digest(read(plist))
        disk = 'old' if value == job['plist_sha256'] \
            else 'new' if value == self.evidence['jobs'][self.label(name)]['candidate_plist_sha256'] \
            else 'unknown'
        source = self.source(name)
        loaded = self.launch(name)
        if disk == 'unknown' or source['kind'] == 'unknown' or loaded['kind'] == 'unknown':
            raise RuntimeError('timer source, plist or loaded state is unknown: ' + self.label(name))
        return {'source': source, 'disk': disk, 'loaded': loaded}

    def publish_fence(self, name):
        job = self.job(name)
        source = self.source_path(name)
        current = self.source(name)
        if current['kind'] != 'old' or current['identity'] != job['identity'] or current['flags']:
            raise RuntimeError('original timer source identity drifted: ' + self.label(name))
        pending = source.with_name('.' + source.name + '.openclaw-fence')
        write_temp(pending, read(self.transition / 'fences' / (name + '.source')), job['mode'])
        if self.source(name)['identity'] != job['identity']:
            raise RuntimeError('original timer source changed before fence publication')
        os.replace(pending, source)
        sync_dir(source.parent)
        if self.source(name)['kind'] != 'fence':
            raise RuntimeError('timer fence publication differs')
        os.chflags(source, stat.UF_IMMUTABLE)
        if not self.source(name)['immutable']:
            raise RuntimeError('timer fence was not protected')

    def protect_fence(self, name):
        source = self.source_path(name)
        state = self.source(name)
        if state['kind'] != 'fence':
            raise RuntimeError('timer fence changed')
        if state['flags'] not in (0, stat.UF_IMMUTABLE):
            raise RuntimeError('timer fence has unexpected file flags')
        if not state['immutable']:
            os.chflags(source, stat.UF_IMMUTABLE)
        if self.source(name)['kind'] != 'fence' or not self.source(name)['immutable']:
            raise RuntimeError('timer fence protection failed')

    def install_plist(self, name):
        path = self.plist_path(name)
        mode = stat.S_IMODE(path.stat().st_mode)
        pending = path.with_name('.' + path.name + '.openclaw-candidate')
        write_temp(pending, read(self.candidate(name)), mode)
        os.replace(pending, path)
        sync_dir(path.parent)
        if self.state(name)['disk'] != 'new':
            raise RuntimeError('timer candidate plist publication differs')

    def unload_old(self, name, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            state = self.state(name)
            if state['source']['kind'] != 'fence' or not state['source']['immutable'] \
                    or state['disk'] != 'new' or state['loaded']['kind'] != 'old':
                raise RuntimeError('timer changed while waiting for old run')
            if not state['loaded']['running']:
                subprocess.run(['/bin/launchctl', 'bootout',
                                f'gui/{os.getuid()}/{self.label(name)}'], check=True)
                if self.launch(name)['kind'] != 'none':
                    raise RuntimeError('old timer is still loaded')
                return
            time.sleep(.1)
        raise RuntimeError('old timer did not finish naturally before deadline: ' + self.label(name))

    def restore_source(self, name):
        source = self.source_path(name)
        job = self.job(name)
        current = self.source(name)
        if self.launch(name)['kind'] != 'none' or current['kind'] != 'fence' \
                or current['flags'] != stat.UF_IMMUTABLE:
            raise RuntimeError('timer source restoration requires an unloaded fenced job')
        os.chflags(source, 0)
        pending = source.with_name('.' + source.name + '.openclaw-original')
        if job['link_target'] is None:
            write_temp(pending, read(self.transition / 'originals' / (name + '.source')), job['mode'])
        elif not os.path.lexists(pending):
            os.symlink(job['link_target'], pending)
            sync_dir(source.parent)
        elif not pending.is_symlink() or os.readlink(pending) != job['link_target']:
            raise RuntimeError('original observer link staging differs')
        os.replace(pending, source)
        sync_dir(source.parent)
        if self.source(name)['kind'] != 'old':
            raise RuntimeError('timer original source restoration differs')

    def bootstrap(self, name, seconds=900):
        if self.state(name)['loaded']['kind'] != 'none':
            raise RuntimeError('timer bootstrap requires an unloaded job')
        subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}',
                        str(self.plist_path(name))], check=True)
        self.wait_new_idle(name, seconds)

    def wait_new_idle(self, name, seconds):
        end = time.monotonic() + seconds
        run_at_load = plistlib.loads(read(self.candidate(name))).get('RunAtLoad') is True
        while time.monotonic() < end:
            loaded = self.launch(name)
            if loaded['kind'] != 'new':
                raise RuntimeError('reviewed timer entry did not load')
            if not loaded['running'] and (not run_at_load or loaded['runs'] is not None
                                          and loaded['runs'] >= 1):
                return
            time.sleep(.1)
        raise RuntimeError('new timer run did not finish naturally before deadline: ' + self.label(name))

    def apply(self, seconds=900):
        if sys.platform != 'darwin':
            raise RuntimeError('live timer commissioning requires macOS')
        root = self.home / '.openclaw'
        copy_lock = locked_file(root / 'timer-source-copy.lock')
        try:
            preservation = root / 'preservation'
            preservation.mkdir(mode=0o700, exist_ok=True)
            private(preservation, directory=True)
            node_lock = locked_file(preservation / 'node.lock')
            try:
                receipt = preservation / 'node.lock.state.json'
                if os.path.lexists(receipt):
                    private(receipt)
                    previous = json.loads(read(receipt))
                    if previous.get('status') != 'restored':
                        raise RuntimeError('another node preservation window is unresolved')
                    previous_root = pathlib.Path(previous['journal_root'])
                    if previous_root.parent.resolve() != (preservation / 'journals').resolve() \
                            or not previous_root.is_dir():
                        raise RuntimeError('previous node journal lineage is unavailable')
                elif (preservation / 'journals').exists() \
                        and any((preservation / 'journals').iterdir()):
                    raise RuntimeError('unindexed node journals require restoration before timer transition')
                active = root / 'timer-transition-active'
                installed = root / 'timer-entry-installed'
                if os.path.lexists(installed):
                    private(installed)
                    if os.path.lexists(active):
                        raise RuntimeError('timer transition has competing active and installed receipts')
                    state = json.loads(read(installed))
                    if state.get('entry_sha256') != ENTRY_HASH or state.get('transition_sha256') != TRANSITION_HASH:
                        raise RuntimeError('installed timer receipt differs')
                elif os.path.lexists(active):
                    private(active)
                    state = json.loads(read(active))
                    if state.get('entry_sha256') != ENTRY_HASH or state.get('transition_sha256') != TRANSITION_HASH \
                            or not re.fullmatch(r'timer-[0-9a-f]{32}', state.get('window', '')):
                        raise RuntimeError('active timer transition receipt differs')
                else:
                    if any((row['source']['kind'], row['disk'], row['loaded']['kind']) != ('old', 'old', 'old')
                           for row in (self.state(name) for name in NAMES)):
                        raise RuntimeError('partial timer transition lacks its durable receipt')
                    state = {'entry_sha256': ENTRY_HASH, 'transition_sha256': TRANSITION_HASH,
                             'window': 'timer-' + secrets.token_hex(16)}
                    write_temp(active, json.dumps(state, sort_keys=True).encode(), 0o600)
                for name in NAMES:
                    for _ in range(7):
                        row = self.state(name)
                        key = (row['source']['kind'], row['disk'], row['loaded']['kind'])
                        if key == ('old', 'old', 'old'):
                            self.publish_fence(name)
                        elif key == ('fence', 'old', 'old'):
                            self.protect_fence(name)
                            self.install_plist(name)
                        elif key == ('fence', 'new', 'old'):
                            self.protect_fence(name)
                            self.unload_old(name, seconds)
                        elif key == ('fence', 'new', 'none'):
                            self.protect_fence(name)
                            self.restore_source(name)
                        elif key == ('old', 'new', 'none'):
                            self.bootstrap(name, seconds)
                        elif key == ('old', 'new', 'new'):
                            self.wait_new_idle(name, seconds)
                            break
                        else:
                            raise RuntimeError('timer transition state refuses: ' + self.label(name) + ':' + str(key))
                    else:
                        raise RuntimeError('timer transition did not converge: ' + self.label(name))
                self.verify_artifacts()
                return {'installed': True, 'jobs': len(NAMES), 'window': state['window']}
            finally:
                os.close(node_lock)
        finally:
            os.close(copy_lock)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply-live', action='store_true')
    args = parser.parse_args()
    root = pathlib.Path.home() / '.openclaw/backups/node-readiness'
    installer = Installer(root / 'timer-transition-candidate-20260930-3',
                          root / 'timer-entry-candidate-20260930-5')
    if args.apply_live:
        raise RuntimeError('live publication is disabled until the scoped journal and recovery adapter pass review')
    print(json.dumps({name: {'source': installer.state(name)['source']['kind'],
                             'plist': installer.state(name)['disk'],
                             'loaded': installer.state(name)['loaded']['kind']}
                      for name in NAMES}, sort_keys=True))


if __name__ == '__main__':
    main()
