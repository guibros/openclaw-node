# Step 3.9 — Post-implementation audit

## 1. Promised vs landed

| AUDIT_PRE §6 delta | Landed | Evidence |
|---|---|---|
| Isolated entry verifier and gate handoff | yes | `workspace-bin/timer-entry.py`; owner-private manifest and 1,885 source hashes checked before `Gate.run` |
| Loaded baseline, private pins, five candidate renderings and re-verification | yes | `workspace-bin/stage-timer-entries.py`; saved candidate `timer-entry-candidate-20260930-5` verifies without recapture |
| Owned Mac launch and mismatch controls | yes | `test/timer_entry_test.py` 6/6; open/closed gate and source, manifest, env, pin and delegated-resolution negatives |
| Silo status, decision and runtime evidence | yes | D25, this audit and `RUNTIME_EVIDENCE.md`; `INVENTORY.md`, `VERSION`, registry updated at close |

## 2. Greppable deltas

- `rg -n 'def verify|def main|gate.run' workspace-bin/timer-entry.py`: first hit `44:def verify`; the entry checks content, arguments, received environment and source before gate handoff.
- `rg -n 'def loaded|def probe|def _stage|def verify' workspace-bin/stage-timer-entries.py`: first hit `52:def loaded`; loaded plist checks, neutral launchd environment observation, candidate rendering and saved-baseline verification.
- `rg -n 'def test_' test/timer_entry_test.py`: first hit `102:    def test_open_closed_and_source_substitution`; six actual Mac owned launchd controls.
- `rg -n 'D25|3.9' memory-plan/plans/node-bus-lifecycle/{DECISIONS.md,INVENTORY.md}`: declared two source-path relocations and the bounded step contract.

## 3. Cross-references

The 3.9 Goal/Needs/Feeds/Verify, AUDIT_PRE §6 and D25–D26 match the implementation. The five candidate plists and manifest live in the owner-private candidate root stated in `RUNTIME_EVIDENCE.md`. The installer does not load them. The exact Node24 consolidation release is the accepted 3.8 output, and only the script-path element for consolidation and observer is intentionally relocated. The other application arguments, configured environment, schedule and log fields are copied from the installed plists and validated against loaded services. The one optional/dynamic inherited SSH-agent socket is tied to the current launchd domain; every other value remains pinned. The candidate directory is outside ordinary workspace installer copy/chmod/prune paths; the verifier still reports drift instead of re-pinning it.

## 4. Findings

- [POSITIVE] The five installed and loaded entries matched the staged baseline; a fresh owner-private launchd observation recorded received environment value hashes without publishing values. Saved verification re-probed the environment, source tree, executable resolution, gate pins and candidate plist dictionaries.
- [POSITIVE] Six owned Mac tests passed: open gate launches the fixture application; closed gate admits no application work; source, launcher, manifest, environment, gate-pin, delegated-resolution and wrong SSH-socket changes refuse before work.
- [POSITIVE] Claude's adversarial source review found staging/runtime UID parity and consolidation-argv shape mismatches. Both were corrected before the accepted candidate was staged; XPC identity and its value hash are both checked.
- [POSITIVE] Exact-source CI 36797763658 at `cae7186` passed both root Node 20 and Node 22 jobs. The earlier source's Node 22 attempt 1 had one unrelated mesh lifecycle timeout and passed on rerun without source changes.
- [POSITIVE] Re-verification caught the inherited SSH-agent socket rotation; candidate `-5` accepts its current launchd-domain value without recapturing stable values. Claude's adversarial review accepted that narrow policy and safe-refusal race.
- [NEGATIVE] Mission Control's dependency audit is red on a Next.js advisory in the existing lockfile; the same audit gate was red on unmodified main before this step. The local Mac root suite also remains red/unstable in unrelated test files, detailed in `RUNTIME_EVIDENCE.md`. Neither is represented as a full green suite.
- [NEGATIVE] Plan lint reports the pre-existing absence of this silo's `automation.json` and `tick-logs/`; canonical sync and inventory/audit coverage pass.
- [LIMIT] The candidates are staged only. No loaded timer was replaced, no original in-flight write was drained, and no production hold was certified. Python `-I -S` does not protect the interpreter's dynamic loader before startup; owner-private path and external pins are the declared boundary.

## 5. Phase-8 patches

None after the accepted candidate. The two first-review findings and later dynamic-environment correction were fixed during Phase 4 before staging candidate `-5` and before corrected exact-source CI.

## 6. Carry-forwards and Feeds

Step 3.10 consumes the saved five-entry manifest/plists as its source and setting baseline and must establish a genuinely safe first transition from the currently ungated jobs. An owned timer fired after `launchctl disable` returned, and `bootout` killed an active parent and detached child before their fsynced writes. Neither disable plus idle polling nor reboot alone proves a drain; no live mutation follows from this audit. Step 3.11 may consume the candidates only after 3.10 closes, with source/manifest hashes and actual loaded settings reverified. Parent recovery 1.2 and broader delegated writers remain separate.
