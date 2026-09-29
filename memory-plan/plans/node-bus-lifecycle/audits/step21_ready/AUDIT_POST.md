# Step2.1 — Installed task startup barrier

## 1 — Promised versus landed
| Promise | Landed | Evidence |
|---|---|---|
| Await server registration before ready | yes | bin/mesh-task-daemon.js final await nc.flush; exact staged diff one line |
| Real owned immediate and held/failure controls | yes | 200 real starts, candidate100/100, baseline66/100503; focused3/3; unpatched barrier controls fail |
| Full isolated tests | yes | exact8ab8350 run36519414185 Node20/22 and Mission Control green |
| Independent source review | yes | Claude30/32, independent3-member100/100 candidate, clear local-server limitation |
| Install cumulative lifecycle layer | yes | entrySHA22c27840; same unit bytes/dependencies; currentPID82096/CID21565 |
| Normal managed stop and real RPC | yes | actual non-child72174 EXITSTATUS requested/echoed, wait0/completion; preconnected13ms list reply |
| State-preserving installed runtime | yes | complete same-source restart65s pre/post,31checks,419ms pause/zero worker requests; unchanged selected537 rows/KV/9owners |
| Independent runtime closure challenge | yes | Claude36 confirms complete run5 meets the conditions set in Message34 |

## 2 — Greppable deltas
`rg -n 'await nc.flush|Task daemon ready' bin/mesh-task-daemon.js` places the
barrier immediately before ready. STAGED_ENTRY.diff has one application line.
MANAGED_EVIDENCE.json binds source/runtime/process/connection and scoped state.

## 3 — Cross-references
Recovery1.2 consumes per-server ready/RPC; parent1.5 consumes installed entry
provenance. Both chains stay unloaded. No production preservation baseline exists.

## 4 — Findings
[POSITIVE] Real controls and independent cluster trials reject the old readiness race.
[POSITIVE] Installed replacement keeps one owner generation and prior selected state.
[NEGATIVE] Three pre-stop verification defects and one observer-cleanup failure
are retained. The failed state-changing attempt stays unaccepted; current runtime
acceptance is the fresh fully recorded same-source restart, run5. The separate
read-only continuation is run4 and remains supporting history. General orchestration is unproved.

## 5 — Phase8 patches
None to the reviewed production source. Verifier corrections are private;
PROBE_CLEANUP_CONTROL.json proves the normal-close correction on an owned server.

## 6 — Carry-forwards
This audit commit's full isolated CI must pass before merge. Merge149 before fresh144 integration CI. Recovery journal/healthy cold
masters/common application recovery remain open. Flush is local-server readiness,
not synchronous cross-server interest or active application-handler completion.

## 7 — Raw transition provenance
RAW_RECORDS.json pins every private transition checkpoint. Exit/gap/start/
connection/RPC snapshots were saved before observer cleanup. The complete run
uses requested/echoed0x84000000 and zero worker requests during its419ms pause.
Member4222 alone is scanned; observer exclusion includes serverID and CID.
Previous failure and continuation remain distinct records. The latest complete
run, not reconstructed past assertions, is the authoritative restart evidence.
