# Step3.1 post-audit — 2026-09-29 04:38 EDT

## 1. Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Durable close before foreground drain; independently pinned runners/controller | yes | approved source26e9278,40 real Mac controls, exact CI36541071531 |
| Owner-private descriptor-relative paths; pre-publication native observation | yes | original ancestor/mapping and descriptor-loss controls in PRIMITIVE_EVIDENCE.json |
| Full receipts and separate non-certifying restoration | yes | real crash/receipt controls; Claude62 source/type challenge |
| Private runtime source equals reviewed source | yes | gate SHA26e9278585537bc1b57820368b8cec2fea6fd804bd5f1a252dddbdfcec92e0ac; Claude64 independently hashes the committed blob |
| Real scheduled in-flight fire drains before return | yes | owned Node68265, registered kernel NOTE_EXIT/NOTE_EXITSTATUS data0; observed exit1725451625ns precedes drain return1733327958ns in one controller clock |
| Real closed scheduled fires remain inert and normal | yes | 159 individually observed fires/runs2–160, each exit0; app1; zero job logs during at least365s |
| Real reopen resumes the scheduled application | yes | saved receipt reopen, next actual fire app1→2/exit0; owned bootout0 and absence verified |

The deployed consumer is an actual private Mac launchd timer, not a production
unit. The contract explicitly requires this bounded owned consumer. The source
is unchanged from approved0f0dcc2; closing this step does not install a gate on
the live node or approve stopping a production dependency.

## 2. Greppable deltas

`rg -n 'expected_root|close_and_drain|class RestorationGate|watch_session_id' workspace-bin/service_gate.py`
reaches the pin/drain/type/session contracts. `rg -n 'applicationRunsAfter|closedFires|waitedForActualApplicationExit' memory-plan/plans/node-bus-lifecycle/audits/step31_service_gate/OWNED_TIMER_EVIDENCE.json`
reaches the actual timer evidence. Source and test hashes are in the primitive
record, with the exact three green CI jobs at0f0dcc2.

## 3. Cross-references

D15/D16 remain binding. The next work is re-oriented into3.2 local invocation
completion,3.3 disabled Discord,3.4 sole-journal interruption recovery and3.5
actual five-timer installation. Parent recovery1.2 remains[A]/v1.2-pre.
The timer primitive is consumed by these next steps; no production caller is
invented here. Both autonomous plan chains remain off.

## 4. Findings

[POSITIVE] Real timer drain, hold and release match the source-approved public
API. The six-minute hold has3202 native checks and19269 independent reads:
zero tolerated ATTRIB/refusal/path events, original session unchanged. This
closes the observed Mac hold-rate question for this duration/mount only.

[NEGATIVE] The first continuation harness used the wrong evidence key after
successfully observing drain. It failed, unloaded its owned unit and remains
unaccepted. Corrected v2 retained unchanged gate source and passed the whole
hold/release/cleanup sequence. Raw evidence SHA243f0fb552266ef4c334beebaa827ee42aff5e9fe5ece0fb5452a50e7da07d87;
harness SHA12fe191e17aa66349d839b12ecf8160f4c710dfa0e3beeb18df777bb101026df.

Independent Claude62 approval is source only; Claude64 checks the artifact hash
and evidence design, without access to this Mac. The runtime figures are
Codex's actual observation, not a second independent Mac run. A final evidence
update is sent in Claude65. No green test/merge is substituted for observation.

## 5. Phase8 patches

None to the approved primitive. Optional private-helper hardening is tracked
for the controller refactor, rather than folded into a different approved SHA.

## 6. Carry-forwards

No production gate, installer/unit edit, dependency stop or state-preservation
window exists. No arbitrary descendant, remote LLM completion, other-invoker,
code/mount substitution, Linux continuous-watch or VM/power-loss proof exists.
The same-user control boundary is explicit. Protect/pin the actual interpreter,
wrapper/import graph and code paths before installation. Preserve symlink-free
ancestors. A deploy touching pinned metadata must be excluded or coordinated
and recaptured before reuse.

3.2 must await cycle termination after cancellation, event publication and its
foreground notification; the scheduler cannot force-clear an active invocation.
Both scheduler stop callers must await completion before dependency teardown.
The Linux detached notification click waiter needs a foreground invocation
path. Delegated memory inference and other invokers still need their own proof.

3.4 must use the sole journal's durable intent/receipt, explicit no-receipt,
mismatch/broken-hold/straggler paths, original-session before/after brackets and
dependency-first restoration. Recovered holds never certify a lost interval.
The private `_drained_guard` optional review note belongs to that refactor.
Only after those prerequisites may3.5 install the actual five timers. Linux
native-observation acceptance remains a prerequisite of the agnostic installer
in parent node-readiness2.2. Recovery1.2 still needs its complete baseline and
three healthy cold masters. No global project readiness is claimed.
