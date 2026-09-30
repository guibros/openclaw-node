#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
import pathlib
import plistlib
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[4]
OWNED_SERVICE = HERE / 'owned_recovery_service.cjs'
sys.path.insert(0, str(HERE))

from journal_hold import ANCHOR, JournaledHold
from managed_launchd import Launchd
from preservation_checks import Refused, require
from preservation_journal import Journal, UNITS, matches, read_private, static_identity, valid_prior, valid_record

spec = importlib.util.spec_from_file_location('owned_service_gate', REPO / 'workspace-bin/service_gate.py')
gate_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate_module)


def private_dir(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700 and path.resolve() == path,
            'owned recovery directory is not private and literal')


def owned_root(root):
    root = pathlib.Path(root)
    require(root.is_absolute() and root.parent == pathlib.Path(tempfile.gettempdir()).resolve()
            and re.fullmatch(r'openclaw-owned-recovery-[0-9a-f]{16}', root.name),
            'restore-only prototype requires a private owned fixture root')
    private_dir(root)
    private_dir(root / 'plists')
    return root


def private_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o600, 'owned recovery file is not owner-private')


def preflight(root, window):
    preservation = root / 'preservation'
    if not preservation.exists():
        require(not os.path.lexists(root / 'gate/closed.json'),
                'closed gate has no durable recovery receipt')
        return {'outcome': 'no-hold'}
    private_dir(preservation)
    private_dir(preservation / 'journals')
    private_file(preservation / 'node.lock')
    receipt_path = preservation / 'node.lock.state.json'
    receipt = read_private(receipt_path)
    require(receipt.get('status') in ('unresolved', 'restored')
            and receipt.get('phase') == 'initialized', 'owned node receipt is incomplete')
    valid_record(receipt['baseline'])
    valid_prior(receipt['baseline']['prior'])
    journal_root = preservation / 'journals' / window
    require(receipt['journal_root'] == str(journal_root), 'requested journal is not the node receipt owner')
    private_dir(journal_root)
    private_file(journal_root / '.lock')
    reader = object.__new__(Journal)
    reader.root = journal_root
    records = reader._read()
    require(records and records[0] == receipt['baseline'], 'owned baseline differs from node receipt')
    if records[-1]['event'] in ('resolved', 'sealed'):
        require(receipt['status'] == 'restored'
                and receipt.get('head') in (records[-1]['sha256'], records[-1]['previous']),
                'finished journal receipt differs')
        return {'outcome': 'already-finished', 'head_lagged': receipt.get('head') != records[-1]['sha256'],
                'records': records, 'terminal': records[-1]['event']}
    require('execution_hold' in records[0]['prior'][ANCHOR], 'owned journal lacks execution hold')
    return {'outcome': 'open', 'receipt': receipt, 'records': records, 'journal_root': journal_root,
            'node_lock': preservation / 'node.lock'}


class OwnedLaunchdAdapter:
    def __init__(self, root, prior, baseline):
        self.root = owned_root(root)
        self.prior = prior
        self.label_prefix = 'ai.openclaw.' + self.root.name + '.'
        require(set(self.prior) == UNITS and 'execution_hold' in self.prior[ANCHOR],
                'owned recovery requires the complete baselined hold')
        require(all(unit in (ANCHOR, 'mesh-agent') or state['class'] == 'absent'
                    for unit, state in self.prior.items()),
                'prototype refuses non-cohort production services')
        require(self.prior[ANCHOR]['class'] == 'timer'
                and self.prior['mesh-agent']['class'] == 'daemon'
                and self.prior['nats-1']['class'] == 'absent',
                'owned fixture service classes differ')
        self.baseline = baseline
        for unit, prior in self.prior.items():
            self.identity(unit, prior)

    def label(self, unit):
        return self.label_prefix + unit

    def plist(self, unit):
        return self.root / 'plists' / (unit + '.plist')

    def service(self, unit):
        return Launchd(self.label(unit), self.plist(unit))

    def disabled(self, unit):
        result = subprocess.run(['/bin/launchctl', 'print-disabled', 'gui/' + str(os.getuid())],
                                capture_output=True, text=True, check=True, timeout=3).stdout
        values = re.findall(r'^\s*"' + re.escape(self.label(unit)) + r'" => (enabled|disabled)$', result, re.M)
        require(len(values) <= 1, 'owned disabled override is ambiguous')
        return values == ['disabled']

    def identity(self, unit, prior):
        path = self.plist(unit)
        if prior['class'] == 'absent':
            require(not os.path.lexists(path), 'an absent unit acquired an owned plist')
            return {'installed': False}
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600, 'owned plist changed ownership or mode')
        plist = plistlib.loads(path.read_bytes())
        require(plist['Label'] == self.label(unit), 'owned loaded label differs')
        saved = prior['identity']
        if unit == ANCHOR:
            gate = self.prior[ANCHOR]['execution_hold']
            expected_argv = ['/usr/bin/python3', '-I', '-S', str(self.root / 'service_gate.py'),
                             'run', gate['root'], '--lock', gate['pins']['lock'],
                             '--root-pin', gate['pins']['root'], '--', '/bin/sh', '-c',
                             'printf "fired\\n" >> "$OWNED_FIRE_LOG"']
            require((self.root / 'service_gate.py').read_bytes()
                    == (REPO / 'workspace-bin/service_gate.py').read_bytes(),
                    'owned gate runner differs from the fixed source')
        else:
            expected_argv = ['/usr/local/bin/node', str(self.root / OWNED_SERVICE.name)]
            require((self.root / OWNED_SERVICE.name).read_bytes() == OWNED_SERVICE.read_bytes(),
                    'owned entry code differs from the fixed adapter')
        require(saved['argv'] == expected_argv and saved['working_directory'] == str(self.root)
                and not saved['dependencies'], 'owned entry contract differs')
        allowed_files = {str(pathlib.Path(expected_argv[0]).resolve()),
                         str(pathlib.Path(expected_argv[1] if unit != ANCHOR else expected_argv[3]).resolve())}
        if unit == ANCHOR:
            allowed_files.add('/bin/sh')
        require(set(saved['files']) == allowed_files, 'owned file inventory differs')
        environment = plist['EnvironmentVariables']
        require(environment == {'OWNED_ROLE': unit, 'OWNED_HEALTH_PORT': environment.get('OWNED_HEALTH_PORT'),
                                'OWNED_UNREADY_FILE': str(self.root / 'unready'),
                                'OWNED_FIRE_LOG': str(self.root / 'fires.log')}
                and environment['OWNED_HEALTH_PORT'].isdigit(), 'owned received environment differs')
        actual = static_identity(path, tuple(saved['files']), saved['dependencies'])
        require(actual == saved, 'immutable owned service identity changed')
        return actual

    def health(self, unit, status):
        if unit != 'mesh-agent' or not status['running']:
            return True
        plist = plistlib.loads(self.plist(unit).read_bytes())
        port = int(plist['EnvironmentVariables']['OWNED_HEALTH_PORT'])
        require(1 <= port <= 65535, 'owned health port differs')
        with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/ready', timeout=.3) as response:
            value = json.load(response)
        require(value == {'pid': status['pid'], 'ready': True}, 'owned process health differs')
        binding = self.service(unit).bind(self.prior[unit]['identity']['argv'], '/usr/local/bin/node',
                                          self.prior[unit]['identity']['working_directory'],
                                          self.prior[unit]['identity']['files'])
        require(binding['status']['pid'] == status['pid'], 'owned process generation changed')
        return True

    def observe(self, unit, prior):
        identity = self.identity(unit, prior)
        service = self.service(unit)
        require(not service.status('user')['loaded'], 'owned label is loaded outside the GUI domain')
        status = service.status()
        disabled = self.disabled(unit)
        actual = {'loaded': status['loaded'], 'running': status['running'], 'disabled': disabled,
                  'identity': identity}
        if matches(actual, prior):
            self.health(unit, status)
        actual['verified'] = matches(actual, prior)
        return actual

    def restore(self, unit, prior):
        require(unit in ('mesh-agent', ANCHOR) and prior['class'] in ('daemon', 'timer')
                and prior['loaded'],
                'owned adapter cannot mutate this service')
        self.identity(unit, prior)
        service = self.service(unit)
        require(not service.status('user')['loaded'], 'owned label is loaded outside the GUI domain')
        status = service.status()
        require(not self.disabled(unit), 'owned unit was disabled; operator handoff required')
        require(not status['running'], 'running owner cannot be replaced')
        self.refuse_extra_jobs()
        if not status['loaded']:
            service.bootstrap()
        elif prior['class'] == 'daemon':
            service.kickstart()
        end = time.monotonic() + 5
        last_error = None
        while time.monotonic() < end:
            try:
                if self.observe(unit, prior)['verified']:
                    return
            except (OSError, ValueError, KeyError, Refused, subprocess.SubprocessError) as error:
                last_error = str(error)
            time.sleep(.05)
        raise Refused('owned service did not reach its saved ready state: ' + unit
                      + (': ' + last_error if last_error else ''))

    def loaded_labels(self):
        result = subprocess.run(['/bin/launchctl', 'list'], capture_output=True, text=True,
                                check=True, timeout=3).stdout
        return {line.split('\t')[-1] for line in result.splitlines()
                if line.split('\t')[-1].startswith(self.label_prefix)}

    def refuse_extra_jobs(self):
        expected = {self.label(unit) for unit, prior in self.prior.items() if prior['loaded']}
        require(self.loaded_labels() <= expected, 'unexpected owned launchd job is loaded')

    def final_check(self):
        loaded = self.loaded_labels()
        expected = {self.label(unit) for unit, prior in self.prior.items() if prior['loaded']}
        require(loaded == expected, 'unexpected owned launchd job or missing baseline job')
        states = {unit: self.observe(unit, prior) for unit, prior in self.prior.items()}
        require(all(row['verified'] for row in states.values()), 'owned physical readiness differs')
        return {'verified': True, 'checked_units': len(states)}

    def fast_check(self):
        for unit, prior in self.prior.items():
            if prior['class'] != 'absent':
                self.identity(unit, prior)
            status = self.service(unit).status()
            actual = {'loaded': status['loaded'], 'running': status['running'],
                      'disabled': self.disabled(unit)}
            require(matches(actual, prior), 'owned state changed immediately before reopen: ' + unit)
            if unit == 'mesh-agent':
                self.health(unit, status)
        return {'verified': True, 'baseline_sha256': self.baseline}


def recover_owned(root, window):
    require(sys.platform == 'darwin', 'owned recovery prototype requires macOS launchd')
    root = owned_root(root)
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', window), 'invalid journal window')
    prepared = preflight(root, window)
    if prepared['outcome'] == 'no-hold':
        return {'outcome': 'no-hold', 'gate': 'unverified', 'history_certified_by_command': False}
    if prepared['outcome'] == 'already-finished':
        prior = prepared['records'][0]['prior']
        saved = prior[ANCHOR]['execution_hold']
        require(saved['root'] == str(root / 'gate'), 'saved gate is outside the owned fixture')
        OwnedLaunchdAdapter(root, prior, prepared['records'][0]['sha256'])
        with gate_module.Gate(saved['root'], saved['pins']) as finished_gate:
            marker = finished_gate.marker()
        require(marker is None, 'finished journal has a closed execution gate')
        return {'outcome': 'already-finished', 'gate': 'closed' if marker else 'open',
                'gate_marker': marker, 'terminal': prepared['terminal'],
                'head_lagged': prepared['head_lagged'], 'history_certified_by_command': False}
    prior = prepared['records'][0]['prior']
    saved = prior[ANCHOR]['execution_hold']
    require(saved['root'] == str(root / 'gate'), 'saved gate is outside the owned fixture')
    adapter = OwnedLaunchdAdapter(root, prior, prepared['records'][0]['sha256'])
    journal = None
    gate = None
    hold = None
    try:
        journal = Journal(prepared['journal_root'], node_lock=prepared['node_lock'])
        require(journal.prior == prior and journal.records == prepared['records']
                and journal.active == prepared['receipt'], 'owned journal changed after preflight')
        gate = gate_module.Gate(saved['root'], saved['pins'])
        hold = JournaledHold(journal, gate, adapter.fast_check)
        _, live = hold.intents()
        marker = gate.marker()
        if marker is not None:
            require(len(live) == 1 and marker == {k: live[0]['hold'][k] for k in ('window', 'reason')},
                    'closed marker has no unique matching durable intent')
            receipt = hold.receipt(live[0])
            require(receipt is None or receipt == gate._hold_receipt(),
                    'saved closed receipt drifted; operator handoff required')
        result = hold.recover(adapter.restore, adapter.observe, adapter.final_check)
        if result['restored']:
            journal.resolve()
        outcome = 'resolved' if result['restored'] else 'partial'
        marker = gate.marker()
        return {'outcome': outcome, 'gate': 'closed' if marker is not None else 'open',
                'gate_marker': marker, 'receipt_status': journal.active['status'],
                'receipt_head': journal.active.get('head'),
                'last_event': journal.records[-1]['event'], 'write_failed': journal.write_failed,
                'errors': result['errors'], 'history_certified': False}
    except Exception as error:
        try:
            state = ('closed' if gate.marker() is not None else 'open') if gate is not None else 'unverified'
        except Exception:
            state = 'unverified'
        return {'outcome': 'refused', 'reason': str(error),
                'gate': state,
                'last_event': journal.records[-1]['event'] if journal is not None else None,
                'write_failed': journal.write_failed if journal is not None else None,
                'receipt_status': journal.active['status'] if journal is not None and journal.active else None,
                'history_certified': False}
    finally:
        if hold is not None:
            hold.close()
        if gate is not None:
            gate.close()
        if journal is not None:
            journal.close()


def main():
    parser = argparse.ArgumentParser(description='Owned restore-only prototype; no production service access')
    parser.add_argument('--owned-root', required=True)
    parser.add_argument('--window', required=True)
    args = parser.parse_args()
    result = recover_owned(args.owned_root, args.window)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['outcome'] in ('resolved', 'no-hold', 'already-finished') else 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'outcome': 'refused', 'reason': str(error), 'gate': 'unverified',
                          'history_certified': False}, sort_keys=True))
        sys.exit(2)
