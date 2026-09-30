import importlib.util
import json
import os
import pathlib
import plistlib
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from journal_hold import ANCHOR, describe
from managed_launchd import Launchd
from preservation_journal import Journal, UNITS, static_identity
from restore_only import recover_owned


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
                    else ['/usr/local/bin/node', str(self.script)])
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
        with Journal(self.journal_root, self.prior, node_lock=self.node_lock):
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
                subprocess.run(['/bin/launchctl', 'enable', service.target], capture_output=True, timeout=5)
            except Exception:
                pass
        if hasattr(self, 'gate'):
            self.gate.close()
        if hasattr(self, 'root'):
            import shutil
            shutil.rmtree(self.root)

    def interrupt(self, checkpoint='after-receipt'):
        ready = self.root / 'controller-ready'
        child_source = '''import importlib.util,pathlib,sys,time\nfrom preservation_journal import Journal\nfrom journal_hold import JournaledHold,ANCHOR\nroot,gate_root,lock,ready,source,checkpoint=map(pathlib.Path,sys.argv[1:7])\nspec=importlib.util.spec_from_file_location('gate',source);g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)\nwith Journal(root,node_lock=lock) as j:\n with g.Gate(gate_root,j.prior[ANCHOR]['execution_hold']['pins']) as gate:\n  hold=JournaledHold(j,gate,lambda:{'verified':False})\n  fields=hold._fields(False);intent=j.append('intent',unit=ANCHOR,action='owned-close',**fields)\n  if str(checkpoint)=='intent':ready.touch();time.sleep(60)\n  guard=gate.close_for_restoration(fields['hold']['window'],fields['hold']['reason'],2,on_publication=lambda receipt:hold._published(intent,receipt))\n  guard.close();ready.touch();time.sleep(60)\n'''
        child_source = child_source.replace(
            "on_publication=lambda receipt:hold._published(intent,receipt)",
            "on_publication=lambda receipt:(hold._published(intent,receipt),"
            "ready.touch() if str(checkpoint)=='during-drain' else None)")
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
        plist = plistlib.loads(self.services[ANCHOR].plist.read_bytes())
        return subprocess.run(plist['ProgramArguments'], cwd=self.root,
                              env=plist['EnvironmentVariables'], capture_output=True, timeout=5)

    def test_real_interrupted_hold_restores_owned_daemon_and_resolves(self):
        self.interrupt()
        self.assertEqual(self.fire_timer().returncode, 0)
        self.assertFalse((self.root / 'fires.log').exists())
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        wait_for(lambda: not self.services['mesh-agent'].status()['loaded'])
        code, output = self.command()
        self.assertEqual(code, 0, output)
        self.assertEqual(output['outcome'], 'resolved', output)
        self.assertEqual(output['gate'], 'open')
        self.assertFalse(output['history_certified'])
        self.assertTrue(self.services['mesh-agent'].status()['running'])
        self.assertEqual(self.fire_timer().returncode, 0)
        self.assertEqual((self.root / 'fires.log').read_text(), 'fired\n')
        repeat_code, repeat = self.command()
        self.assertEqual(repeat_code, 0, repeat)
        self.assertEqual(repeat['outcome'], 'already-finished')
        self.assertEqual(repeat['gate'], 'open')
        with self.assertRaises(Exception):
            Journal(self.journal_root, node_lock=self.node_lock)

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
        result = recover_owned(self.root, 'owned')
        self.assertEqual(result['outcome'], 'partial', result)
        self.assertEqual(result['gate'], 'closed')
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
        self.assertEqual(output['outcome'], 'refused', output)
        self.assertEqual(output['gate'], 'closed')
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
        try:
            output = recover_owned(self.root, 'owned')
            self.assertEqual(output['outcome'], 'refused', output)
            self.assertFalse(self.services['mesh-agent'].status()['loaded'])
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
        self.assertEqual(output['outcome'], 'refused')
        self.assertIn('foreground run did not drain', output['reason'])
        self.assertEqual(output['gate'], 'closed')
        holder.kill()
        holder.wait(timeout=5)
        second_code, second = self.command()
        self.assertEqual(second_code, 0, second)
        self.assertEqual(second['outcome'], 'resolved')

    def test_substituted_gate_pin_refuses_without_restoring(self):
        self.interrupt()
        subprocess.run(['/bin/launchctl', 'bootout', self.services['mesh-agent'].target], check=True)
        (self.gate_root / 'gate.lock').chmod(0o600)
        output = recover_owned(self.root, 'owned')
        self.assertEqual(output['outcome'], 'refused', output)
        self.assertFalse(self.services['mesh-agent'].status()['loaded'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
