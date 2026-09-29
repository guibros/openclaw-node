# Step3.4 pre-audit — 2026-09-29 06:22 EDT

## 0. Micro Re-Orient

Block3, immediately after merged3.3/f21c350 and actual disabled-inactivity proof.
The current report still says5/6 mesh services running/noPID Discord: BROKEN.
This step makes that intentional inactive state visible without hiding failures.
North star: observed, actionable monitoring rather than perpetual false alarms.
Still next: yes; Claude84/86 requires this before further preservation integration.
D20 explicitly maps old journal3.4→3.5 and old timer3.5→3.6; history remains.

## 1. Intent and pre-screen

Read-only06:21EDT precheck verifies actual monitor PID747's release entry,
the loaded Discord HOME=/Users/moltymac and the effective false/no-token config
from3.3. Actual report10:21:28UTC has net.mesh=BROKEN only for Discord's missing
PID; ops.roadmap=WORKING/authenticated9 plans. Current node-watch source has the
separate viewer-auth patch absent from current-main. Tree clean on merged
f21c350, branch codex/discord-inactive-monitor. Existing Node24/shared dependencies
and launchd are available. No BLOCKED or new chain. PRECHECK.json is private.

## 2. Design

Extend the existing launchd read with lastExitCode and observed HOME. Read only
the actual optional tool's effective config; strictfalse authorizes the exception.
The pure mesh grader reports confirmed optional inactivity explicitly as OFF
in its detail/evidence, while grading observed remaining mesh services normally.
Disabled-running, known failed exits and other loaded stopped peers remain
BROKEN. Unobservable service/lifecycle/policy evidence cannot become WORKING.
Missing-enabled retains ordinary legacy expectation; no generic optional list.

Deploy a separate new release copied from the actual viewer-b4bbac2-e57 tree,
apply only this reviewed diff and preserve its auth import/API probe. No full
current-main file replacement. Back up exact unit; change only entry path.
Wait for an observed completed light tick/child-free gap before the normal
managed stop, then run two real light reports after restart. Other service
owners/config and viewer discovery remain unchanged. No whole-node health claim.

## 3. Risks and boundaries

Reading the watcher's own overridden OPENCLAW_HOME could refer to a different
config than the Discord service; use loaded HOME evidence. Do not assume exit0
without seeing it, waive unrelated failures or treat disabled-running as healthy.
No raw config/token/report payloads are published. The existing shared dependency
link is used without install/rebuild. Viewer authentication must survive the
overlay; old release/source and unit remain intact. Heavy-probe scheduling and
general watcher cancellation/child draining are not repaired here.

## 4. Verify

Pure controls exercise false/true/legacy/string/null and failure/unknown states,
including other stopped/unobservable peers and an inactive-only node. Native
owned launchd controls exercise actual exit/PID/config-HOME observations through
the target, with no Discord request or production unit mutation. New qualifying
controls must fail the old grader. Full suite only in isolated CI; independent
Claude challenge. Private exact staged target must agree with the live states.

Actual managed watcher: normal requested stop/restart in a completed light-tick
gap, preserved argv/env/schedule/cwd, then two reports with mesh WORKING and
explicit Discord OFF detail while authenticated viewer discovery stays WORKING.
Other twelve previously running owners plus the inactive Discord unit/config
are unchanged. Remaining BROKEN/UNKNOWN results are retained, not suppressed.

## 5. Decision

D20 bounds this separate correction before journal/timer integration and the
next complete preservation baseline. This is not installer/systemd acceptance.

## 6. File deltas

| File | Delta |
|---|---|
| lib/node-watch.mjs | read observed lifecycle/HOME and effective Discord policy; qualify inactive aggregate honestly |
| test/node-watch.test.mjs | strict-policy and failure/unknown lifecycle regressions |
| docs/NODE_WATCH_SPEC.md | qualified optional inactive signal within the existing mesh target |
| audit PRE/POST/evidence and plan ledgers | actual source/runtime linkage and explicit numbering re-orientation |

## Mid-Implementation Findings

The initial policy-read draft returned UNKNOWN immediately on missing HOME or
unreadable policy, hiding another already-observed failed peer. The bounded
implementation now passes policy uncertainty into the existing grader so known
failures retain BROKEN; dedicated pure, target and native controls verify this.
No unrelated component or general probe cancellation was changed.
