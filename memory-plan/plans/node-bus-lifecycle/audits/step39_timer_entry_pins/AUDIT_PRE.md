# Step 3.9 — Protected timer entry and environment contract

## Micro Re-Orient

Block 3 is building scheduled application quiescence, not a preservation controller.
Step 3.8 now supplies a private graph under the loaded Node 24 timer executable.
This step pins the five actual launch boundaries and renders owner-private candidates.
The north star is a verified quiet window without code-on-disk/runtime drift.
3.9 is still the right next step; first-transition proof is 3.10, installation is 3.11.

## Intent and pre-screen

Steps 3.6–3.8 are merged and closed. Fresh `launchctl print` plus installed
plist inspection identified the exact JournaledHold.TIMERS cohort. All five
loaded arguments and configured environment values match their installed
plists. Scheduler-heartbeat and observer use `/usr/local/bin/node`; archive
uses `/bin/sh`; rotation uses `/bin/bash`; consolidation uses the same Node
but its live script predates accepted 3.2. The 3.8 private release and
`workspace-bin/service_gate.py` Python-`-I -S` runner exist. Observer's live
script is a symlink into the development checkout, so D25 also declares its
private script/module relocation. The candidate
root under `~/.openclaw/backups/node-readiness/` is outside the installer
workspace copy/chmod/prune paths. D25 explicitly resolves the otherwise
impossible unchanged-argv/private-dependency conflict before implementation.
No production unit, code path or gate is changed in this step.

## Design and acceptance

Stage the gate and entry verifier in an owner-private regular-file tree and
externally pin their content/path identities. Snapshot all five loaded plist
dictionaries, loaded program/argv/environment/schedule/cwd/log fields and
their source graphs without printing raw environment values. Render five
candidate plists with `/usr/bin/python3 -I -S` as a supervisor prefix and
external gate root/lock pins. Preserve each application interpreter, flags,
configured environment, cwd, schedule and logs. Consolidation points its
script element at the accepted private release and uses its own locked
dependencies; observer's script and local module move into the private tree.
Hash observer/heartbeat local modules and the two shell
scripts plus the external binaries they delegate to. Preserve the first
baseline; never silently re-pin a changed file.

At the launch boundary, reject unsupported loader/preload/delegation inputs,
manifest/gate/source substitution, missing pin, unexpected environment key
or mismatch before application work. Verify the actual process environment
through an owned neutral launchd label, keep the output owner-private, and
publish only key classification/hash evidence. Prove both an open-gate
positive and closed-gate application-inert run under owned labels. Candidate
plists are rendered and inspected but not installed under the five real labels.

## Risks and boundaries

- A plist-only environment comparison misses launchd's inherited/default
  and injected keys; classify actual received values without publishing them.
- Python `-I -S` protects import lookup, not Python's own loader or a swapped
  launcher before it begins. Use the private protected path and external
  install/reopen pins; claim no same-owner malicious-code resistance.
- Checking an entry script alone misses observer's local module,
  consolidation's 1,500+ installed files, and shell/observer subprocesses.
  Pin the reachable graph and exact executable resolution.
- Source preflight and exec are distinct operations. The protected path
  excludes ordinary deploy drift; 3.10/3.11 must coordinate any live source
  replacement and revalidate before reopen.
- D25's consolidation path relocation is an explicit source transition.
  Its safety against an in-flight old invocation belongs to 3.10.

## §6 file deltas

1. `workspace-bin/timer-entry.py`: isolated launch verifier and gate handoff.
2. `workspace-bin/stage-timer-entries.py`: read-only loaded baseline, private
   manifest/source pins, five candidate plist renderings and verification.
3. Focused Mac owned launch-boundary/env/substitution tests and fixture evidence
   in `audits/step39_timer_entry_pins/`.
4. This silo's `INVENTORY.md`, `VERSION`, `COMPONENT_REGISTRY.md`,
   append-only `DECISIONS.md`, runtime evidence and post-audit.

## Mid-Implementation Findings

- The actual observer script path is a symlink into the development checkout.
  A byte-matched private copy of the entry and local module is required;
  D25 and the 3.9 goal now declare that second source-path relocation.
- `/usr/bin/python3 -I -S` dispatches to a Command Line Tools executable on
  this Mac. The launcher records and checks `sys.executable` and hashes both
  paths instead of assuming `realpath(sys.executable)` equals `/usr/bin/python3`.
- A neutral launchd probe receives inherited keys absent from the plist,
  including `CPATH`, `LIBRARY_PATH`, `SDKROOT` and `XPC_FLAGS`. The saved
  contract records key/value hashes, and verify re-probes without recapture.
- Claude's adversarial source review found two staging/runtime parity gaps:
  staging did not check source UID, and it rewrote consolidation's second
  argv element without asserting the loaded argv shape. Both are now refused
  during staging. Its redundant XPC hash observation was resolved by checking
  the hash as well as the service identity.
- A later saved-candidate verification refused solely because inherited
  `SSH_AUTH_SOCK` rotated in the launchd user domain. D26 narrows that one
  key to optional domain-verified content; all configured and other inherited
  values stay pinned. Candidate `-5` supersedes `-3` and `-4`.
