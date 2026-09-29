# Step3.3 pre-audit — 2026-09-29 05:34 EDT

## 0. Micro Re-Orient

Block3 scheduled quiescence; production preservation remains open.
3.2 merged6ce3639 with qualified private local-completion proof.
This step makes explicitly disabled Discord a normal inactive service.
North star: optional capabilities must not destabilize the local node.
Still next: yes; actual disabled config drives a recurring exit1/restart loop.
No integration enablement, Discord request or unrelated lifecycle deployment.

## 1. Intent and pre-screen

Actual09:28UTC config:channels.discord.enabled=false, no token, zero accounts.
Loaded ai.openclaw.mesh-tool-discord:spawn scheduled/runs3015/exit1,
KeepAlive=true/RunAtLoad=true/Throttle10. The tool entry is byte-equivalent
to livee57 and current main. Owned actual old process with the disabled config
exits1 for missing token; zero observed bus attempts/created paths. Private
OLD_DISABLED_NEGATIVE.json retains this failure. Node24.13.0, Python and real
nats-server2.12.6 are available.3.2 is closed, tree clean at6ce3639, no BLOCKED.

## 2. Design

Parse the existing config once at the start of main. Strict enabled=false
returns normally before token lookup and registry/tracer imports. Preserve
absent-enabled legacy token semantics; malformed config or enabled/missing
token remains failure. Load runtime libraries only after token acceptance.
No new config path, provider, service or fallback.

Mac KeepAlive={SuccessfulExit:false} with RunAtLoad/Throttle/env/cwd unchanged;
Linux Restart=on-failure. Enabled permanent NATS closure must propagate its
resolved error as failure rather than becoming a successful inactive exit.
Real connected planned stop remains0. General active-handler drain is separate.

Stage only the tool diff on immutable livee57, preserve exact dependencies.
Back up the actual plist/config hash; change only entry argument and KeepAlive.
Integration stays explicitly disabled. Loaded/not-running with exit0 is the
accepted inactive baseline, not an outage or missing service.

## 3. Risks and boundaries

Conditional restart changes the meaning of exit0: do not newly suppress an
enabled permanent-loss error. Real owned NATS controls must cover that path.
Disabled must bypass runtime imports as well as connect/register; stdout's
single inactive diagnostic is allowed, application DB/state writes are not.
No Discord API requests, actual credentials, live bus mutation or shared
dependency install/rebuild. Linux policy is source-only until actual installer
acceptance; Mac supervisor behavior needs a real owned unit and live evidence.

## 4. Verify

Actual child processes with private HOME: disabled with/without a token exits0,
no bus attempts or new state paths; disabled runs without runtime libraries;
enabled missing token/malformed config remain1. Real owned authenticated NATS
registration plus planned stop0 and permanent-loss exit1. Old-source disabled
and loss controls fail. Full root/MC suite only in isolated CI; Claude challenge.

Actual private Mac unit rendered with the candidate policy: disabled runs once,
remains loaded/not-running across throttle periods; genuine enabled failure
restarts. Exact staged source and live unit preserve arguments/environment/cwd
except entry and KeepAlive. Real live disabled run exits0, then at least65s
stable loaded/not-running/no new run count, disabled config unchanged, no
Discord bus client/admission and unrelated service ownerPID/runs unchanged.

## 5. Decision

D19 records explicit inactive exit semantics and conditional restart. No
production timer gate or full preservation baseline is claimed.

## 6. File deltas

| File | Delta |
|---|---|
| bin/mesh-tool-discord.js | explicit disabled preflight before runtime imports/token; preserve permanent-loss failure |
| services/launchd/ai.openclaw.mesh-tool-discord.plist | restart on unsuccessful exit, preserve remaining policy |
| services/systemd/openclaw-mesh-tool-discord.service | Restart=on-failure |
| skills/discord-telegram-triage/references/discord-runbook.md | optional history-tool inactive/restart/baseline semantics |
| test/mesh-tool-discord-lifecycle.test.mjs | real disabled/failure/planned-stop/permanent-loss controls with owned resources |
| audit PRE/POST/evidence and plan ledger files | qualified source/runtime proof, inactive baseline and residual limits |

## Mid-Implementation Findings

None. Permanent-loss classification is part of the pre-decided supervisor
change; broader active-handler draining remains separate parent work.

Verification correction: the first owned run queried a fixture-only node ID
that the existing registry does not consume; its default is hostname. Retain
that failed run as unaccepted. The corrected fixture queries the actual ready
line's node ID, leaving registry behavior unchanged. Operator-neutral registry
identity configuration is a separate parent cluster/installation observation.

Live verification correction2026-09-29 06:08 EDT: the deployment produced
the expected normal inactive run. Its first stability harness over-constrained
all node bus admissions and refused on a health-watch connection after the
Discord exit. Retain that window as unaccepted. The written3.3 contract excludes
Discord admission, not all ongoing node work; a fresh same-unit65s continuation
captures unchanged inactive run count/13 other owners and the actual continuing
bus admission counts. No production source or unrelated writer was changed to
make the evidence pass. No certification across the observation gap.
