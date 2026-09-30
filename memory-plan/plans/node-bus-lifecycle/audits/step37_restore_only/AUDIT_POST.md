# Step 3.7 — Owned restore-only prototype verification

## Promised vs landed

| Contract | Evidence |
|---|---|
| One bounded command using the sole Journal/node_lock and saved immutable baseline | `restore_only.py` opens the saved Journal after read-only preflight, uses `JournaledHold.recover`, then resolves |
| Interrupted hold restores only | Killed-controller private Mac fixture, resolved terminal record, `execution-hold-restored` evidence has `restored_only: true` and `history_certified: false`; no seal record |
| Live owner, missing or substituted pins, corrupt durable state and stragglers refuse | 27 native owned controls and 33 hold controls in `MAC_TEST_TRANSCRIPT.txt` |
| Actual scheduled application suppressed and later resumed | `RUNTIME_EVIDENCE.json`: launchd timer runs 0→1 while closed with no application output, then 1→2 after reopen with `fired\n` |
| Loaded launchd execution identity fixed before trust | `TIMER_LAUNCHCTL_PRINT.txt` shows `program = /usr/bin/python3` and `properties = inferred program`; explicit-`Program` timer and daemon negative controls refuse before reopen/kickstart |
| No production action | Root name/location, label prefix, exact plist and owned code/logs restrict accepted shape; no production mode, source copy, deploy, enable/disable or bootout action in the command |

## Source and runtime evidence

`generate_runtime_evidence.py` reruns the integrated Mac suite and a separate
end-to-end scenario, records tool versions and hashes six source files. On
macOS 26.2 with Node 24.13.0 and Python 3.9.6, the suite passed 27 native
owned controls and 33 hold controls. The independent scenario stopped the
saved daemon, recovered it, reopened the physical gate and resolved the
journal. The timer's closed and reopened runs used `launchctl kickstart` in
the test; the command itself never kickstarts a timer. Fixture jobs and files
were removed, and that fixture added no launchd disabled override. The saved
launchd sample redacts only the inherited SSH-agent socket path.

## Findings and limits

[POSITIVE] The exact saved plist dictionary, on-disk code/logs, loaded launchd
path/program/arguments/environment/cwd/logs/interval, process binding, local
health and physical marker are checked before recovery can be called ready.
The loaded `program` and `inferred program` checks close the last adversarial
counterexample against a restored timer running an ungated binary.

[POSITIVE] `partial` reports changes and the observed physical gate, including
the post-unlink journal-write failure case where the gate is open but the
journal remains unresolved. `refused` means this command made no durable gate
or journal change. An intent-only/open straggler test proves a protective
close is reported as `partial`, not `refused`.

[LIMIT] This is a private owned cohort, not the five live timers or a parent
preservation controller. It proves neither VM/power-loss durability nor a
production install/rollback. The inherited/default launch environment and
protected deployment location belong to 3.9; old-entry transition proof to
3.10; five-timer commissioning to 3.11; full preservation to parent 1.2.

[LIMIT] The adapter expects this Mac's `OSLogRateLimit = 64` rendering and
refuses other formats. A saved receipt with root-time drift is refused under
the accepted 3.1 rule and needs operator handoff, not pin recapture. Earlier
fixture teardown left 333 `enabled` override entries for unique private test
labels in launchd's disabled-service database. They have no loaded jobs or
surviving fixture directories; current teardown does not add entries.

[LIMIT] `plan-lint.sh node-bus-lifecycle` reports 13 PASS and 2 FAIL for
`automation.json` and `tick-logs/`, both absent on `origin/main` before this
step. The step's inventory, audit, canonical sync and version checks pass.
Those silo automation surfaces remain a separate protocol maintenance item.

## Closure state

3.7[x]/v3.7 on 2026-09-30 11:46 EDT. Claude85 accepted exact source
`f72820c` after replaying its loaded-`Program` counterexample against the
new parser and checking all eight committed evidence hashes. The original
Mac sample was accepted; explicit `Program=/bin/echo` was refused. CI run
36738649717 passed all three jobs on the same source head: Node 20, Node 22
and Mission Control. The Mac native controls are local runtime evidence;
Linux CI marks the Mac-only wrapper skipped. The closure commit changes
ledger/evidence only; its exact head must pass CI before merge. No production
deployment occurred.
