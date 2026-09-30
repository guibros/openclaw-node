#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

AUDIT = pathlib.Path(__file__).resolve().parent
REPO = AUDIT.parents[4]
FIXTURE = REPO / 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'
sys.path.insert(0, str(FIXTURE))
spec = importlib.util.spec_from_file_location('owned_restore_test', FIXTURE / 'test_restore_only.py')
tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
SOURCES = ['workspace-bin/service_gate.py',
           'memory-plan/plans/node-state-recovery/audits/step12_jetstream/owned_recovery_service.cjs',
           'memory-plan/plans/node-state-recovery/audits/step12_jetstream/restore_only.py',
           'memory-plan/plans/node-state-recovery/audits/step12_jetstream/test_restore_only.py',
           'test/restore-only.test.mjs',
           'memory-plan/plans/node-bus-lifecycle/audits/step37_restore_only/generate_runtime_evidence.py']


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(reuse_tests=False):
    assert sys.platform == 'darwin'
    transcript_path = AUDIT / 'MAC_TEST_TRANSCRIPT.txt'
    if reuse_tests:
        previous = json.loads((AUDIT / 'RUNTIME_EVIDENCE.json').read_text())
        assert all(previous['source_sha256'][path] == sha256(REPO / path)
                   for path in SOURCES[:-1])
        assert previous['mac_test_transcript_sha256'] == sha256(transcript_path)
        transcript = transcript_path.read_text()
    else:
        result = subprocess.run(['node', '--test', 'test/journal-hold.test.mjs',
                                 'test/restore-only.test.mjs'], cwd=REPO, capture_output=True,
                                text=True, timeout=180)
        transcript = result.stdout + result.stderr
        transcript_path.write_text(transcript)
        assert result.returncode == 0, transcript[-5000:]
    counts = [int(value) for value in re.findall(r'^Ran (\d+) tests in ', transcript, re.M)]
    assert len(counts) == 2 and re.search(r'^ℹ fail 0$', transcript, re.M)
    hold_count, owned_count = counts
    case = tests.RestoreOnlyOwned('test_real_interrupted_hold_restores_owned_daemon_and_resolves')
    case.setUp()
    root_name = case.root.name
    try:
        sample = subprocess.check_output(['/bin/launchctl', 'print',
                                          case.services[tests.ANCHOR].target], text=True)
        assert '\tprogram = /usr/bin/python3\n' in sample
        assert 'inferred program' in sample
        initial_open = case.gate.marker() is None
        runs_before = case.services[tests.ANCHOR].status()['runs']
        case.interrupt()
        marker_closed = case.gate.marker() is not None
        closed_exit = case.fire_timer()
        closed_runs = case.services[tests.ANCHOR].status()['runs']
        no_output_closed = not (case.root / 'fires.log').exists()
        subprocess.run(['/bin/launchctl', 'bootout', case.services['mesh-agent'].target], check=True)
        tests.wait_for(lambda: not case.services['mesh-agent'].status()['loaded'])
        daemon_stopped = not case.services['mesh-agent'].status()['loaded']
        code, command = case.command()
        assert code == 0 and command['outcome'] == 'resolved', command
        daemon_running = case.services['mesh-agent'].status()['running']
        marker_open = case.gate.marker() is None
        records = [json.loads(path.read_text()) for path in sorted(case.journal_root.glob('*.json'))]
        receipt = json.loads((case.preservation / 'node.lock.state.json').read_text())
        restored = [row for row in records if row['event'] == 'execution-hold-restored'][-1]
        opened = [row for row in records if row['event'] == 'hold-opened'][-1]
        open_exit = case.fire_timer()
        open_runs = case.services[tests.ANCHOR].status()['runs']
        application_output = (case.root / 'fires.log').read_text()
        assert initial_open and marker_closed and marker_open and daemon_stopped and daemon_running
        assert no_output_closed and closed_exit == 0 and open_exit == 0
        assert closed_runs == runs_before + 1 and open_runs == closed_runs + 1
        assert application_output == 'fired\n' and records[-1]['event'] == 'resolved'
        assert receipt['status'] == 'restored' and receipt['head'] == records[-1]['sha256']
        assert restored['evidence']['restored_only'] and not restored['evidence']['history_certified']
        assert opened['restored_only'] and not any(row['event'] == 'sealed' for row in records)
    finally:
        case.tearDown()
    loaded = subprocess.check_output(['/bin/launchctl', 'print',
                                      'gui/' + str(os.getuid())], text=True)
    assert root_name not in loaded and not case.root.exists()
    sample_path = AUDIT / 'TIMER_LAUNCHCTL_PRINT.txt'
    sample_path.write_text(re.sub(r'(?m)^(\s*SSH_AUTH_SOCK => ).*$',
                                  r'\1[redacted]', sample))
    evidence = {
        'observed_at': datetime.now(ZoneInfo('America/Montreal')).isoformat(),
        'macos_version': subprocess.check_output(['/usr/bin/sw_vers', '-productVersion'], text=True).strip(),
        'python_version': sys.version.split()[0],
        'node_version': subprocess.check_output(['node', '--version'], text=True).strip(),
        'source_sha256': {path: sha256(REPO / path) for path in SOURCES},
        'mac_test_transcript_sha256': sha256(AUDIT / 'MAC_TEST_TRANSCRIPT.txt'),
        'timer_launchctl_print_sha256': sha256(sample_path),
        'timer_launchctl_print_redactions': ['inherited SSH_AUTH_SOCK path'],
        'hold_tests_passed': hold_count,
        'mac_owned_tests_passed': owned_count,
        'fixture_name': root_name,
        'initial_gate_open': initial_open,
        'interrupted_marker_present': marker_closed,
        'launchd_timer_runs_before': runs_before,
        'launchd_timer_runs_while_closed': closed_runs,
        'timer_exit_while_closed': closed_exit,
        'timer_application_output_absent_while_closed': no_output_closed,
        'saved_daemon_stopped_before_command': daemon_stopped,
        'command_exit': code,
        'command_result': command,
        'daemon_running_after_command': daemon_running,
        'reopened_marker_absent': marker_open,
        'launchd_timer_runs_after_reopen': open_runs,
        'timer_exit_after_reopen': open_exit,
        'timer_application_output_after_reopen': application_output,
        'journal_terminal_event': records[-1]['event'],
        'receipt_status': receipt['status'],
        'receipt_head_matches_terminal': receipt['head'] == records[-1]['sha256'],
        'recovered_hold_evidence_uncertified': not restored['evidence']['history_certified'],
        'no_seal_record': not any(row['event'] == 'sealed' for row in records),
        'fixture_removed': not case.root.exists(),
        'owned_labels_unloaded': root_name not in loaded,
        'owned_override_lines_before': case.overrides_before,
        'owned_override_lines_after': case.disabled_overrides(),
    }
    (AUDIT / 'RUNTIME_EVIDENCE.json').write_text(json.dumps(evidence, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'owned_tests': owned_count, 'hold_tests': hold_count,
                      'outcome': command['outcome'], 'fixture_removed': evidence['fixture_removed']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--reuse-tests', action='store_true')
    run(parser.parse_args().reuse_tests)
