import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import plistlib
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from journal_hold import ANCHOR, describe
from legacy_fixture import legacy_journal
from managed_launchd import Launchd
from preservation_checks import Refused
from preservation_journal import Journal, UNITS, static_identity
from restore_only import OwnedLaunchdAdapter, recover_owned


HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE.parents[4] / 'workspace-bin/service_gate.py'
spec = importlib.util.spec_from_file_location('fixture_gate', SOURCE)
gate_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate_module)


def wait_for(check, seconds=6):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            if check():
                return
        except (OSError, ValueError):
            pass
        time.sleep(.03)
    raise AssertionError('owned fixture deadline exceeded')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@unittest.skipUnless(sys.platform == 'darwin', 'requires owned macOS launchd jobs')
class RestoreOnlyOwned(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.gettempdir()).resolve() / ('openclaw-owned-recovery-' + secrets.token_hex(8))
        self.root.mkdir(mode=0o700)
        self.overrides_before = self.disabled_overrides()
        self.plists = self.root / 'plists'
        self.plists.mkdir(mode=0o700)
        self.gate_root = self.root / 'gate'
        self.pin = gate_module.initialize(self.gate_root)
        self.gate = gate_module.Gate(self.gate_root, self.pin)
        self.preservation = self.root / 'preservation'
        self.journal_root = self.preservation / 'journals/owned'
        self.node_lock = self.preservation / 'node.lock'
        self.port = free_port()
        self.script = self.root / 'owned_recovery_service.cjs'
        self.script.write_bytes((HERE / 'owned_recovery_service.cjs').read_bytes())
        self.script.chmod(0o600)
        self.gate_script = self.root / 'service_gate.py'
        self.gate_script.write_bytes(SOURCE.read_bytes())
        self.gate_script.chmod(0o600)
        self.services = {}
        for unit in (ANCHOR, 'mesh-agent'):
            label = 'ai.openclaw.' + self.root.name + '.' + unit
            plist = self.plists / (unit + '.plist')
            argv = (['/usr/bin/python3', '-I', '-S', str(self.gate_script), 'run', str(self.gate_root),
                     '--lock', self.pin['lock'], '--root-pin', self.pin['root'], '--', '/bin/sh', '-c',
                     'printf "fired\\n" >> "$OWNED_FIRE_LOG"'] if unit == ANCHOR
                    else [str(pathlib.Path(shutil.which('node')).resolve(strict=True)), str(self.script)])
            settings = {'Label': label, 'ProgramArguments': argv, 'WorkingDirectory': str(self.root),
                        'StandardOutPath': str(self.root / (unit + '.out')),
                        'StandardErrorPath': str(self.root / (unit + '.err')),
                        'EnvironmentVariables': {'OWNED_ROLE': unit, 'OWNED_HEALTH_PORT': str(self.port),
                                                 'OWNED_UNREADY_FILE': str(self.root / 'unready'),
                                                 'OWNED_FIRE_LOG': str(self.root / 'fires.log')}}
            if unit == ANCHOR:
                settings['StartInterval'] = 3600
                settings['RunAtLoad'] = False
            elif unit == 'mesh-agent':
                settings['RunAtLoad'] = True
                settings['KeepAlive'] = False
            plist.write_bytes(plistlib.dumps(settings))
            plist.chmod(0o600)
            for name in (unit + '.out', unit + '.err'):
                (self.root / name).touch(mode=0o600)
            self.services[unit] = Launchd(label, plist)
        self.services['mesh-agent'].bootstrap()
        wait_for(lambda: self.services['mesh-agent'].status()['running'])
        self.services[ANCHOR].bootstrap()
        wait_for(lambda: self.services[ANCHOR].status()['loaded'] and not self.services[ANCHOR].status()['running'])
        self.prior = {unit: {'class': 'absent', 'loaded': False, 'running': False,
                             'disabled': False, 'identity': {'installed': False}} for unit in UNITS}
        for unit, kind in ((ANCHOR, 'timer'), ('mesh-agent', 'daemon')):
            self.prior[unit] = {'class': kind, 'loaded': True, 'running': kind == 'daemon',
                                'disabled': False,
                                'identity': static_identity(self.services[unit].plist)}
        self.prior[ANCHOR]['execution_hold'] = describe(self.gate, [ANCHOR])
        with legacy_journal(self.journal_root, self.prior, node_lock=self.node_lock):
            pass
        self.children = []

    def tearDown(self):
        for child in getattr(self, 'children', []):
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
            child.stdout.close()
            child.stderr.close()
        for service in getattr(self, 'services', {}).values():
            try:
                if service.status()['loaded']:
                    subprocess.run(['/bin/launchctl', 'bootout', service.target], capture_output=True, timeout=5)
            except Exception:
                pass
        if hasattr(self, 'gate'):
            self.gate.close()
        if hasattr(self, 'root'):
            import shutil
            shutil.rmtree(self.root)
            self.assertEqual(self.disabled_overrides(), self.overrides_before)

    def disabled_overrides(self):
        result = subprocess.check_output(['/bin/launchctl', 'print-disabled', 'gui/' + str(os.getuid())],
                                         text=True)
        return sorted(line for line in result.splitlines() if self.root.name in line)

    def interrupt(self, checkpoint='after-receipt'):
        ready = self.root / 'controller-ready'
        child_source = '''
import importlib.util
import pathlib
import sys
import time
from preservation_journal import Journal
from journal_hold import JournaledHold, ANCHOR

root, gate_root, lock, ready, source, checkpoint = map(pathlib.Path, sys.argv[1:7])
spec = importlib.util.spec_from_file_location('gate', source)
gate_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate_module)
with Journal(root, node_lock=lock) as journal:
    with gate_module.Gate(gate_root, journal.prior[ANCHOR]['execution_hold']['pins']) as gate:
        hold = JournaledHold(journal, gate, lambda: {'verified': False})
        fields = hold._fields(False)
        intent = journal.append('intent', unit=ANCHOR, action='owned-close', **fields)
        if str(checkpoint) == 'intent':
            ready.touch()
            time.sleep(60)
        def published(receipt):
            if str(checkpoint) == 'gap':
                ready.touch()
                time.sleep(60)
            hold._published(intent, receipt)
            if str(checkpoint) == 'during-drain':
                ready.touch()
        guard = gate.close_for_restoration(fields['hold']['window'], fields['hold']['reason'],
                                           2, on_publication=published)
        guard.close()
        ready.touch()
        time.sleep(60)
'''
        child = subprocess.Popen([sys.executable, '-c', child_source, str(self.journal_root),
                                  str(self.gate_root), str(self.node_lock), str(ready), str(SOURCE), checkpoint],
                                 cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        wait_for(lambda: ready.exists() or child.poll() is not None)
        if child.poll() is not None:
            self.fail(child.stderr.read().decode())
        child.kill()
        child.wait(timeout=5)
        ready.unlink()

    def command(self):
        completed = subprocess.run([sys.executable, '-I', '-S', str(HERE / 'restore_only.py'),
                                    '--owned-root', str(self.root), '--window', 'owned'],
                                   capture_output=True, text=True, timeout=20)
        return completed.returncode, json.loads(completed.stdout)

    def fire_timer(self):
        service = self.services[ANCHOR]
        before = service.status().get('runs', 0)
        service.kickstart()
        wait_for(lambda: service.status().get('runs', 0) > before and not service.status()['running'])
        return service.status()['last_exit_code']

    def test_real_interrupted_hold_restores_owned_daemon_and_resolves(self):
        self.interrupt()
        self.assertEqual(self.fire_timer(), 0)
        self.assertFalse((self.root / 'fires.log').exists())
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        wait_for(lambda: not self.services['mesh-agent'].status()['loaded'])
        code, output = self.command()
        self.assertEqual(code, 0, output)
        self.assertEqual(output['outcome'], 'resolved', output)
        self.assertEqual(output['gate'], 'open')
        self.assertFalse(output['history_certified'])
        self.assertEqual(output['gate_before'], 'closed')
        records = [json.loads(path.read_text()) for path in sorted(self.journal_root.glob('*.json'))]
        self.assertEqual(records[-1]['event'], 'resolved')
        self.assertNotIn('sealed', [row['event'] for row in records])
        self.assertTrue(any(row['event'] == 'hold-opened' and row['restored_only'] is True
                            for row in records))
        self.assertTrue(any(row['event'] == 'execution-hold-restored'
                            and row['evidence']['history_certified'] is False
                            and row['evidence']['restored_only'] is True for row in records))
        self.assertTrue(self.services['mesh-agent'].status()['running'])
        self.assertEqual(self.fire_timer(), 0)
        self.assertEqual((self.root / 'fires.log').read_text(), 'fired\n')
        repeat_code, repeat = self.command()
        self.assertEqual(repeat_code, 0, repeat)
        self.assertEqual(repeat['outcome'], 'already-finished')
        self.assertEqual(repeat['gate'], 'open')
        with self.assertRaises(Exception):
            Journal(self.journal_root, node_lock=self.node_lock)

    def test_intent_only_open_ready_resolves_without_certification(self):
        self.interrupt('intent')
        code, result = self.command()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['outcome'], 'resolved')
        self.assertEqual(result['gate_before'], 'open')
        self.assertEqual(result['gate'], 'open')
        self.assertIn('hold-ambiguous-open-ready', result['appended_events'])
        self.assertFalse(result['history_certified'])

    def test_receipt_gap_is_adopted_for_restoration_only(self):
        self.interrupt('gap')
        code, result = self.command()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['outcome'], 'resolved')
        records = [json.loads(path.read_text()) for path in sorted(self.journal_root.glob('*.json'))]
        self.assertTrue(any(row['event'] == 'hold-published'
                            and row['adopted_for_restoration'] is True for row in records))
        self.assertFalse(result['history_certified'])

    def test_vanished_marker_triggers_protective_restore_only_close(self):
        self.interrupt()
        (self.gate_root / 'closed.json').unlink()
        code, result = self.command()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['outcome'], 'resolved')
        self.assertEqual(result['gate_before'], 'open')
        self.assertIn('hold-restoration-drained', result['appended_events'])
        self.assertFalse(result['history_certified'])

    def test_foreign_marker_refuses_without_appending_records(self):
        self.interrupt()
        (self.gate_root / 'closed.json').write_text('{"window":"foreign","reason":"other"}')
        before = sorted(path.name for path in self.journal_root.iterdir())
        code, result = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(result['outcome'], 'refused', result)
        self.assertEqual(result['appended_events'], [])
        self.assertEqual(sorted(path.name for path in self.journal_root.iterdir()), before)

    def test_resolve_failure_reports_open_unresolved_and_retry_resolves(self):
        self.interrupt()
        with patch.object(Journal, 'resolve', side_effect=OSError('owned resolve failure')):
            result = recover_owned(self.root, 'owned')
        self.assertEqual(result['outcome'], 'partial', result)
        self.assertEqual(result['gate'], 'open')
        self.assertEqual(result['receipt_status'], 'restored')
        self.assertEqual(result['last_event'], 'recovery-finished')
        self.assertIn('recovery-finished', result['appended_events'])
        code, retry = self.command()
        self.assertEqual(code, 0, retry)
        self.assertEqual(retry['outcome'], 'resolved')

    def test_loaded_stopped_owned_daemon_is_kickstarted(self):
        self.interrupt()
        pid = self.services['mesh-agent'].status()['pid']
        os.kill(pid, signal.SIGTERM)
        wait_for(lambda: self.services['mesh-agent'].status()['loaded']
                 and not self.services['mesh-agent'].status()['running'])
        code, result = self.command()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['outcome'], 'resolved')
        self.assertTrue(self.services['mesh-agent'].status()['running'])

    def test_unloaded_owned_timer_is_bootstrapped_without_running_early(self):
        self.interrupt()
        subprocess.run(['/bin/launchctl', 'bootout', self.services[ANCHOR].target], check=True)
        self.assertFalse(self.services[ANCHOR].status()['loaded'])
        code, result = self.command()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['outcome'], 'resolved')
        status = self.services[ANCHOR].status()
        self.assertTrue(status['loaded'])
        self.assertFalse(status['running'])
        self.assertFalse((self.root / 'fires.log').exists())

    def test_loaded_timer_from_different_plist_is_not_treated_as_ready(self):
        self.interrupt()
        service = self.services[ANCHOR]
        original = service.plist.read_bytes()
        subprocess.run(['/bin/launchctl', 'bootout', service.target], check=True)
        changed = plistlib.loads(original)
        changed['ProgramArguments'] = ['/usr/bin/false']
        service.plist.write_bytes(plistlib.dumps(changed))
        service.bootstrap()
        service.plist.write_bytes(original)
        result = recover_owned(self.root, 'owned')
        self.assertEqual(result['outcome'], 'partial', result)
        self.assertEqual(result['gate'], 'closed')
        self.assertFalse((self.root / 'fires.log').exists())

    def test_loaded_timer_explicit_program_refuses_before_reopen(self):
        self.interrupt()
        service = self.services[ANCHOR]
        original = service.plist.read_bytes()
        subprocess.run(['/bin/launchctl', 'bootout', service.target], check=True)
        changed = plistlib.loads(original)
        changed['Program'] = '/bin/echo'
        service.plist.write_bytes(plistlib.dumps(changed))
        service.bootstrap()
        service.plist.write_bytes(original)
        loaded = subprocess.check_output(['/bin/launchctl', 'print', service.target], text=True)
        self.assertIn('program = /bin/echo', loaded)
        code, result = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual(result['gate'], 'closed')
        self.assertFalse((self.root / 'fires.log').exists())

    def test_loaded_daemon_explicit_program_refuses_without_kickstart(self):
        self.interrupt()
        service = self.services['mesh-agent']
        original = service.plist.read_bytes()
        subprocess.run(['/bin/launchctl', 'bootout', service.target], check=True)
        changed = plistlib.loads(original)
        changed['Program'] = '/bin/echo'
        service.plist.write_bytes(plistlib.dumps(changed))
        service.bootstrap()
        wait_for(lambda: service.status()['loaded'] and not service.status()['running'])
        service.plist.write_bytes(original)
        before = service.status()['runs']
        code, result = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual(result['gate'], 'closed')
        self.assertEqual(service.status()['runs'], before)

    def test_production_shape_and_extra_plist_key_refuse_before_journal(self):
        before = sorted(path.name for path in self.journal_root.iterdir())
        production = self.root.parent / 'openclaw-production'
        with self.assertRaises(Refused):
            recover_owned(production, 'owned')
        changed_prior = copy.deepcopy(self.prior)
        changed_prior['observer'] = copy.deepcopy(self.prior[ANCHOR])
        with self.assertRaises(Refused):
            OwnedLaunchdAdapter(self.root, changed_prior, 'unused')
        plist = self.services['mesh-agent'].plist
        original = plist.read_bytes()
        try:
            altered = plistlib.loads(original)
            altered['Program'] = '/bin/false'
            plist.write_bytes(plistlib.dumps(altered))
            malicious_prior = copy.deepcopy(self.prior)
            malicious_prior['mesh-agent']['identity'] = static_identity(plist)
            with self.assertRaises(Refused):
                OwnedLaunchdAdapter(self.root, malicious_prior, 'unused')
        finally:
            plist.write_bytes(original)
        self.assertEqual(sorted(path.name for path in self.journal_root.iterdir()), before)
        self.assertFalse(production.exists())

    def test_nonregular_saved_node_refuses_before_content_read(self):
        fifo = self.root / 'fake-node'
        os.mkfifo(fifo, 0o700)
        plist = self.services['mesh-agent'].plist
        original = plist.read_bytes()
        try:
            altered = plistlib.loads(original)
            altered['ProgramArguments'][0] = str(fifo)
            raw = plistlib.dumps(altered)
            plist.write_bytes(raw)
            prior = copy.deepcopy(self.prior)
            identity = prior['mesh-agent']['identity']
            old_node = identity['argv'][0]
            identity['argv'][0] = str(fifo)
            identity['files'][str(fifo)] = identity['files'].pop(old_node)
            identity['plist_sha256'] = hashlib.sha256(raw).hexdigest()
            def deadline(*_):
                raise TimeoutError('owned executable read blocked')
            previous = signal.signal(signal.SIGALRM, deadline)
            signal.setitimer(signal.ITIMER_REAL, 3)
            try:
                with self.assertRaisesRegex(Refused, 'not a regular file'):
                    OwnedLaunchdAdapter(self.root, prior, 'unused')
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, previous)
        finally:
            plist.write_bytes(original)

    def test_missing_receipt_refuses_without_rebuilding_or_restoring(self):
        self.interrupt()
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        receipt = self.preservation / 'node.lock.state.json'
        receipt.unlink()
        before = sorted(path.name for path in self.preservation.iterdir())
        code, output = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(output['outcome'], 'refused')
        self.assertFalse(self.services['mesh-agent'].status()['loaded'])
        self.assertEqual(sorted(path.name for path in self.preservation.iterdir()), before)

    def test_missing_preservation_refuses_when_gate_and_services_exist(self):
        import shutil
        shutil.rmtree(self.preservation)
        code, output = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(output['outcome'], 'refused')
        self.assertFalse(self.preservation.exists())

    def test_corrupt_receipt_refuses_without_repair_or_restoration(self):
        self.interrupt()
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        receipt = self.preservation / 'node.lock.state.json'
        receipt.write_bytes(b'{broken')
        code, output = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(output['outcome'], 'refused')
        self.assertEqual(receipt.read_bytes(), b'{broken')
        self.assertFalse(list(self.preservation.glob('.corrupt-receipt-*')))
        self.assertFalse(self.services['mesh-agent'].status()['loaded'])

    def test_missing_lock_refuses_without_recreating_it(self):
        self.interrupt()
        lock = self.journal_root / '.lock'
        lock.unlink()
        code, output = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(output['outcome'], 'refused')
        self.assertFalse(lock.exists())

    def test_sequence_gap_refuses_without_repair(self):
        self.interrupt()
        last = sorted(self.journal_root.glob('*.json'))[-1]
        last.rename(self.journal_root / '000099.json')
        before = sorted(path.name for path in self.journal_root.iterdir())
        code, output = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(output['outcome'], 'refused')
        self.assertEqual(sorted(path.name for path in self.journal_root.iterdir()), before)

    def test_finished_head_lag_is_reported_without_repair(self):
        self.interrupt()
        first_code, first = self.command()
        self.assertEqual(first_code, 0, first)
        receipt = self.preservation / 'node.lock.state.json'
        state = json.loads(receipt.read_text())
        state['head'] = json.loads(sorted(self.journal_root.glob('*.json'))[-1].read_text())['previous']
        receipt.write_text(json.dumps(state))
        before = receipt.read_bytes()
        code, output = self.command()
        self.assertEqual(code, 0, output)
        self.assertEqual(output['outcome'], 'already-finished')
        self.assertTrue(output['head_lagged'])
        self.assertEqual(receipt.read_bytes(), before)

    def test_unready_process_keeps_gate_closed_then_retry_resolves(self):
        self.interrupt()
        unready = self.root / 'unready'
        unready.touch(mode=0o600)
        first = recover_owned(self.root, 'owned')
        self.assertEqual(first['outcome'], 'partial', first)
        self.assertEqual(first['gate'], 'closed')
        unready.unlink()
        second = recover_owned(self.root, 'owned')
        self.assertEqual(second['outcome'], 'resolved', second)

    def test_extra_owned_job_blocks_bootstrap_and_keeps_gate_closed(self):
        self.interrupt()
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        extra_plist = self.plists / 'unexpected.plist'
        extra = Launchd('ai.openclaw.' + self.root.name + '.unexpected', extra_plist)
        extra_plist.write_bytes(plistlib.dumps({'Label': extra.label, 'ProgramArguments': ['/bin/sleep', '60'],
                                              'RunAtLoad': False}))
        extra_plist.chmod(0o600)
        self.services['unexpected'] = extra
        extra.bootstrap()
        before = sorted(path.name for path in self.journal_root.iterdir())
        code, result = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(result['outcome'], 'refused', result)
        self.assertIsNotNone(self.gate.marker())
        self.assertEqual(sorted(path.name for path in self.journal_root.iterdir()), before)
        self.assertFalse(self.services['mesh-agent'].status()['loaded'])

    def test_identity_drift_refuses_before_new_journal_records(self):
        self.interrupt()
        before = sorted(self.journal_root.glob('*.json'))
        self.script.write_text(self.script.read_text() + '\n')
        code, output = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(output['outcome'], 'refused')
        self.assertEqual(sorted(self.journal_root.glob('*.json')), before)

    def test_receipt_drift_refuses_before_new_journal_records(self):
        self.interrupt()
        before = sorted(self.journal_root.glob('*.json'))
        transient = self.gate_root / 'transient'
        transient.touch(mode=0o600)
        transient.unlink()
        code, output = self.command()
        self.assertEqual(code, 2)
        self.assertIn('receipt drifted', output['reason'])
        self.assertEqual(sorted(self.journal_root.glob('*.json')), before)

    def test_restoration_intent_write_failure_never_bootstraps_service(self):
        self.interrupt()
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        original = Journal.append
        def fault(journal, event, **data):
            if event == 'restoration-intent':
                raise OSError('owned write failure')
            return original(journal, event, **data)
        with patch.object(Journal, 'append', fault):
            output = recover_owned(self.root, 'owned')
        self.assertEqual(output['outcome'], 'partial', output)
        self.assertEqual(output['gate'], 'closed')
        self.assertIn('failed', output['appended_events'])
        self.assertFalse(self.services['mesh-agent'].status()['loaded'])

    def test_active_owner_refuses_without_restoring(self):
        self.interrupt('intent')
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        holder = subprocess.Popen([sys.executable, '-c', 'import sys,time;from preservation_journal import Journal;'
            'j=Journal(sys.argv[1],node_lock=sys.argv[2]);print("ready",flush=True);time.sleep(60)',
            str(self.journal_root), str(self.node_lock)], cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(holder)
        self.assertEqual(holder.stdout.readline().strip(), b'ready')
        os.kill(holder.pid, signal.SIGSTOP)
        before = sorted(path.name for path in self.journal_root.iterdir())
        try:
            output = recover_owned(self.root, 'owned')
            self.assertEqual(output['outcome'], 'refused', output)
            self.assertFalse(self.services['mesh-agent'].status()['loaded'])
            self.assertEqual(sorted(path.name for path in self.journal_root.iterdir()), before)
        finally:
            os.kill(holder.pid, signal.SIGCONT)

    def test_prepublication_run_outlasting_drain_refuses_then_retries(self):
        holder = subprocess.Popen([sys.executable, '-c',
            'import fcntl,sys,time;f=open(sys.argv[1],"r+");'
            'fcntl.flock(f,fcntl.LOCK_SH);print("ready",flush=True);time.sleep(60)',
            str(self.gate_root / 'gate.lock')], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(holder)
        self.assertEqual(holder.stdout.readline().strip(), b'ready')
        self.interrupt('during-drain')
        code, output = self.command()
        self.assertEqual(code, 2, output)
        self.assertEqual(output['outcome'], 'partial')
        self.assertIn('foreground run did not drain', output['reason'])
        self.assertEqual(output['gate'], 'closed')
        self.assertIn('failed', output['appended_events'])
        holder.kill()
        holder.wait(timeout=5)
        second_code, second = self.command()
        self.assertEqual(second_code, 0, second)
        self.assertEqual(second['outcome'], 'resolved')

    def test_ambiguous_open_straggler_reports_protective_close(self):
        self.interrupt('intent')
        (self.root / 'unready').touch(mode=0o600)
        holder = subprocess.Popen([sys.executable, '-c',
            'import fcntl,sys,time;f=open(sys.argv[1],"r+");'
            'fcntl.flock(f,fcntl.LOCK_SH);print("ready",flush=True);time.sleep(60)',
            str(self.gate_root / 'gate.lock')], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(holder)
        self.assertEqual(holder.stdout.readline().strip(), b'ready')
        code, result = self.command()
        self.assertEqual(code, 2)
        self.assertEqual(result['outcome'], 'partial', result)
        self.assertEqual(result['gate_before'], 'open')
        self.assertEqual(result['gate'], 'closed')
        self.assertIn('hold-published', result['appended_events'])
        self.assertIn('foreground run did not drain', result['reason'])
        holder.kill()
        holder.wait(timeout=5)
        (self.root / 'unready').unlink()
        second_code, second = self.command()
        self.assertEqual(second_code, 0, second)
        self.assertEqual(second['outcome'], 'resolved')

    def test_substituted_gate_pin_refuses_without_restoring(self):
        self.interrupt()
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        (self.gate_root / 'gate.lock').chmod(0o600)
        before = sorted(path.name for path in self.journal_root.iterdir())
        output = recover_owned(self.root, 'owned')
        self.assertEqual(output['outcome'], 'refused', output)
        self.assertFalse(self.services['mesh-agent'].status()['loaded'])
        self.assertEqual(sorted(path.name for path in self.journal_root.iterdir()), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
