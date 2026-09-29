# Step3.4 post-audit — 2026-09-29 06:51 EDT

## 1. Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Explicit false/observed normal inactivity is optional OFF | yes | reviewed sourcea4291c4;56 focused Mac passes,55 Linux passes/one explicit Darwin skip |
| Enabled/legacy down states, failures and disabled-running stay BROKEN | yes | pure/target/native controls; known failure outranks unreadable policy |
| Loaded Discord HOME selects the effective config | yes | ten actual owned launchd controls; unrelated watcher override never selects policy |
| Preserve actual installed auth behavior and unrelated files | yes |1916-file manifest: only lib/node-watch changes,0600 preserved; auth-only deployed/reviewed diff and three byte-identical classification regions |
| Managed normal stop and repeatable actual reports | yes | old747 normal kernel EXITSTATUS0; new19976/runs1; two LIGHT reports during81.816s/122 checks |
| Preserve other owners/config/primary/shared dependencies | yes | twelve other owners and inactive Discord unchanged throughout; config3ee9c292/primarye57/status unchanged; no dependency install/rebuild |
| Record real residual health and failed attempts | yes | six remaining BROKEN; first recorder refusal retained before any mutation |

## 2. Greppable changes and exact verification

`rg -n 'discordPolicyError|lastExitCode|loaded HOME missing' lib/node-watch.mjs`
starts at launchdService line86 and gradeMeshServices line91. Strict false,
not-running and observed exit0 authorize the exception. Known failure priority
is mechanical, not a special case that turns an unobservable peer healthy.

SourceCI36556656732 at a4291c4 passes3/3: Node20/22 each2561 total,
2555 pass/6 visible skips/0 failures or cancellations. Five prior skips remain;
the added Darwin target case is explicitly skipped on Linux. All pure controls
run there. Mission Control lint/unit/audit/build pass. Seven selected controls
fail old f21c350; no expanded local production-touching suite was run.

Ten native controls map six semantic labels to real owned launchd jobs;
actual filesystem HOME/config and PID/exit observations feed the real target.
They are separate from the actual Discord integration and all owned jobs are
bootout0/verified absent. Raw control hash13b55a33, exact private source pin
bc035b3. The actual integration was already accepted by3.3.

## 3. Source and deployed linkage

New distinct runtime:
`~/.openclaw/releases/monitor-a4291c4-viewer-b4bbac2-e57/`.
Original installed viewer-b4bbac2-e57f89b remains intact. The only source-file
change is the reviewed monitor diff; original0600 library mode is retained.
New lib8a372106 is reviewed main-libbc035b3 plus the unchanged preexisting
auth overlaydf0bfe52. Reconstruction is byte-identical. The committed deployed
versus reviewed diff contains only viewerAuthHeaders import and ops.roadmap's
existing authenticated API probe; launchdService, gradeMeshServices and net.mesh
are independently byte-identical. Full hashes are in RUNTIME_EVIDENCE.json.

Actual plist changes only the entry argument. New unit hashba411081,
dev16777233/ino58989175/ctime1790678850314936186, mode0600/uid501/gid20,
becomes part of the next complete baseline; it cannot recertify the prior one.
Actual argv/env/cwd/schedules remain. Old entry/library and exact private
original-live.plist are retained. Rollback requires a normal managed stop in
a completed light-tick/child-free gap, restoring the original owner-private
plist, bootstrap and original-entry/auth verification. It restores the old
false-BROKEN classification; it does not revert or enable Discord.

## 4. Observations and qualification

[POSITIVE] Actual completed LIGHT report plus two child-free observations
preceded bootout. Requested/echoed native NOTE_EXITSTATUS flags2214592512,
oldPID747/data0/normal exit0; one stopped line. No forced exit, vanished-PID
inference or general active-probe drain claim.

[POSITIVE] Replacement19976/runs1 produced actual LIGHT reports at
2026-09-29T10:47:41.710Z and10:48:51.464Z. Both net.mesh=WORKING5/5 with
explicit mesh-tool-discord OFF; both ops.roadmap=WORKING/authenticated9plans.
The81.816s/122 checks retain twelve other ownerPID/runs, Discord
loaded/not-running/run1/exit0, config/entry/unit and primary state. New stderr
bytes0. Full raw hash8516fba5 and complete sanitized sample summary are retained.
This is repeatable managed runtime evidence, not a standalone probe substitute.

[NEGATIVE, retained] First recorder attempt5e11342e failed because the installed
Python kqueue object lacks the context-manager API, before bootout/unit mutation.
Old747 and original unit were reverified unchanged. contextlib.closing fixes
only the recorder; the distinct accepted attempt is not a recertification.

[NEGATIVE, retained] Both reports21WORKING/6BROKEN/3OFF/6UNKNOWN retain
mem.ingest, obs.sync, obs.graph_cache, net.stream, fabric.services and
fed.grappe.members failures. This is not full-node health, application quiet,
healthy-store preservation, perpetual terminal state or every short restart
being detected by polling. Heavy scheduling/general watcher cancellation and
child draining remain outside this repair.

Claude90 independently reviews the source and reproduces Linux55/one skip;
Claude92 recomputes reviewed hashbc035b3 and verifies exact CI3/3. Mac controls,
hashes and managed measurement remain local attestation; the reviewer cannot
access this node. Claude94 finds no blocker on qualified reasoning but asks
for a single-cell comparison. Message95 corrects its aggregate-count reading:
Discord has no separate target cell; net.mesh BROKEN→WORKING has explicit
Discord OFF detail. Actual saved pre20W/7B/3OFF/6U becomes21W/6B/3OFF/6U;
OFF count remains3. Saved pre failureIDs and selected reports are retained;
a historical full36-verdict pre matrix was not captured and is not asserted.

Additional paired current full36-target probes, with actual unit environment,
one shared actual health capture and no heavy probes, observe exactly one
status delta: net.mesh BROKEN→WORKING; other35 statuses match. Counts are
20/7/3/6→21/6/3/6. Raw84ef03f3/PAIRED_VERDICT_EVIDENCE.json is distinct from
the accepted managed reports; no second restart or retrospective historical
full-matrix claim. The existing temporary workspace writable health probe
occurs once; no business state or shared dependency change. Claude96 confirms
the aggregate correction and resolves that final condition: no remaining
blocker on qualified reasoning/scope/source-checkable facts. Mac measurements
remain locally observed attestation. Source/test/docs bytes remain a4291c4;
the closure commit is evidence/ledgers only and requires its own exact CI.

## 5. Phase8 patches

None to production source. The initial policy-error precedence draft was
corrected before source commit; the verification-only recorder API correction
is retained above. No additional feature or supervisor guarantee was introduced.

## 6. Carry-forwards and Feeds

The actual node-watch JSON snapshot consumed by Mission Control now includes
the qualified inactive detail. Six other BROKEN and six UNKNOWN remain real
follow-ups in node-readiness. Journal3.5/timer3.6 are next prerequisites for
recovery1.2; D20 maps historical journal3.4/timer3.5 references without rewriting
those records. Full original-window certification, restoration-only recovery,
foreground timer invocation inventory and new complete static baseline remain
open. No production hold/new autonomous chain/full preservation was enabled.
