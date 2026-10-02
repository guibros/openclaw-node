# Node state recovery — registry

## Family 1: persisted application state

### SQLite application stores
| | |
|---|---|
| **Status** | ACCEPTED: twelve per-store snapshots restore correctly; independent review accepted e750e3e; coordinated recovery remains 1.3 |
| **Verified** | 2026-09-28 08:31 EDT: 852,017,152 snapshot bytes, 116 physical tables, matching typed content/rowids/header/FK fingerprints, core integrity; six native FTS checks and eight vector probes pass. Owner-private files; running service PIDs/runs unchanged. Node 24 daemon/knowledge SQLite 3.49.2; Node 22 MC SQLite 3.53.2; gateway node:sqlite 3.50.4/vec 0.1.9. Agent stores have compatibility probes, not owner-engine claims. Header inventory refuses unknown stores/links; explicit browser/historical/source exclusions. |

### JetStream histories
| | |
|---|---|
| **Status** | SPLIT, preservation in flight: standalone 4222 and cluster 4223/4224 serve; failed member 1 persistently held; three healthy cold masters pending |
| **Verified** | 2026-09-28 21:33 EDT: member-1 protected master and its isolated R1 restoration accepted; eleven individual online archives restored with 80,156 non-expiring messages. After the VM crash, nine reachable non-expiring stream states/configs and durable positions match the older archive points; no immediate pre-crash acknowledgement guarantee. Worker explicitly restored under a 65-second idle guard. All three serving bus identities/routes remain unchanged through revised owned recovery tests; member 2 is metadata leader. Fifteen preservation checks, a real account-group election regression, fifty-three journal fault tests and complete owned recovery fixtures pass. Journal is a primitive; managed orchestration remains pending. New managed-window acceptance, three healthy cold copies and coordinated recovery remain open. |

2026-10-01 13:18 EDT — Fresh read-only monitor evidence confirms the split:
8222 has zero routes and no meta-cluster; 8223 and 8224 route to each other,
with metadata leader now reported as member 3. The earlier member-2 leader
observation is historical. `SITE_TOPOLOGY_EVIDENCE.json` records only port
relationships and counts. None of these observations proves replay or cold
 copy health, and no production bus operation occurred.

2026-10-01 13:20 EDT — `SITE_STATIC_EVIDENCE.json` records a read-only
protected-site check: APFS ownership and the root-controlled parent pass;
the dedicated service account and protected root do not exist. The handoff
marker is unpublished. No cutover stage has started.

2026-10-01 13:33 EDT — D30's strengthened read-only check confirms each
ancestor from `/private` through `/private/var/db` is root-controlled and on
one device. A mounted protected root on another device now refuses. The live
site still lacks the dedicated account and protected directory.

2026-10-01 13:47 EDT — D31's live read-only check binds monitor ports
8222/8223/8224 to client ports 4222/4223/4224. The two routed cluster
members still report meta-cluster size three, with one offline replica
reported by a routed peer. This reinforces the separately held member-1 store
as a preservation source, subject to identity and cold-copy verification.
The site audit now refuses ordinary/admin account identities and ACL grants;
the actual dedicated UID and protected root are still absent.

2026-10-01 14:29 EDT — A fresh read-only topology snapshot reports the same
split route graph and metadata leader `openclaw-nats-2`; all three NATS
process start times remain 00:29:20 UTC. The prior leader shift was an
election, not a process restart. This does not prove held-store identity,
stream replay, or protected-site readiness.

2026-10-01 15:05 EDT — PR #175's read-only preflight is merged at `3f60fb7`;
its staging audit still refuses the absent account/root. The active watcher
uses the already-merged PR #173 cohort code from release
`monitor-nats-cohort-529ee53`. Launchd reports PID 83069, runs 1, and the
2026-10-01 19:05:50 UTC snapshot reports `fabric.services` WORKING with the
actual `nats`, `nats-2`, `nats-3` GUI PIDs. This is watcher runtime evidence,
not NATS cold-copy or protected-writer acceptance. Claude's root migration
challenge found four blocking interleavings recorded in D39; the separate
cutover remains unimplemented.

Current mechanism checkpoint 2026-09-28 23:49 EDT: tools-v30 passes53 fresh journal tests; unchanged15 admission/1 election tests inherit identical source hashes. Creation prepares the receipt before mkdir; interrupted setup is restoration-only. bbbc883 CI36516935187 is green, while this newer patch awaits exact CI/review. No new healthy production stop or cold-copy acceptance.

Current mechanism checkpoint 2026-09-29 00:58 EDT: tools-v31 passes55 fresh
journal tests, including initializing-root Finder recovery and fenced invalid
metadata. The unpatched ab7097c control fails as expected. Its exact CI
36518928261 is green and Claude accepted the previous creation fixes; this
new checkpoint requires fresh integration CI/review. PR149 merged55131b8;
installed task-daemon PID82096/runs1 still uses the accepted readiness release.
No production preservation window or healthy cold-copy acceptance exists.

Managed-stop checkpoint 2026-09-29 01:11 EDT: tools-v33 passes six actual owned
macOS launchd/authenticated-NATS controls; crash/surviving-child/timer-race/wrong
argv negatives refuse. Eleven current healthy owners pass read-only binding.
No healthy production stop or preservation window. N3 exact CI36523987643
green3/3 and Claude Message38 accepts it. Adapter exact CI/review pending;
detached orchestrator/static inventory/restoration/cold masters remain open.

Fixture-readiness checkpoint 2026-09-29 01:21 EDT: f3bb44f CI failed before Mac test
collection in old stream placement. Full owned readiness/missing-peer control
and existing recovery checks pass from tools-v36; two refused drafts retained
with normal cleanup. New exact CI/review pending. Production source and service
owners remain unchanged; healthy cold masters and the driver are still open.

Managed-controls checkpoint 2026-09-29 01:44 EDT: private tools-v40 passes13
actual Mac controls/1 explicit cross-domain skip, tools-v39 passes recovery
with actual peer/route negatives. Thirteen owners have read-only entry/code/
environment bindings; Discord has no current root PID and deploy listener
remains unready. Timer idle/log observations alone refuse complete unload
verification. New exact CI/review pending; no production quiet window or
healthy cold-copy acceptance. See D15 and MANAGED_CONTROL_REVIEW.json.

Loaded-provenance checkpoint 2026-09-29 02:09 EDT: tools-v44 passes17
actual Mac controls/1 skip, v42 passes full recovery/all8 placement negatives.
Thirteen live owners retain the same PIDs and pass actual loaded plist/log
provenance. New exact CI/review pending. Producer tick gaps, stop margins,
Discord/timer proof, detached orchestration and healthy cold masters remain
open at1.2-pre. See D16 and LOADED_PROVENANCE_EVIDENCE.json.

Kernel-evidence checkpoint2026-09-29 02:33 EDT: tools-v46 passes20 actual Mac
controls/1 skip; all21 owned jobs unloaded. Four owned NATS stops at restored
archive sizes and one idle memory stop with254MB copied databases exit normally
in34–65ms. No production timeout change or healthy cold master. Discord's
disabled/no-token integration is still restarted by its installed unit.
9deef65 CI36530037917 green3/3, Claude Message46 accepts that source; new
revision awaits exact CI/review. All driver gates remain open at1.2-pre.

2026-09-29 02:50 EDT — Owned/read-only recovery adapter only:21 actual
Mac controls/1 explicit domain skip and56 journal controls pass. Kernel
failure details now persist in post-intent failed journal records; foreign
filters refuse even for a bound PID. No healthy production service operation,
quiet window or cold-master acceptance. See DURABLE_KERNEL_EVIDENCE.json.

2026-09-29 03:09:24 EDT — Recovery journal/tools only: fixed mixed-width PID key
round-trip poisoning before production use.58 journal tests and21 real Mac
controls/1 explicit domain skip pass. No production window, stores or service
state changed. Exact new CI/review required; PID_KEY_EVIDENCE.json.

### Recovery source foundation — 2026-09-29 07:12:37 EDT

Main51a817f integrates without changing the reviewed5fabf6e Journal/stop/checks
tools. A new private copied Journal consumer passes58 controls; prior actual
managed controls are inherited by unchanged hashes, not called new runs.
PR144 is recast as this bounded tools checkpoint pending exact-head CI/review.
No production importer or controller/hold exists. Existing evidence JSONs and
RUNTIME_EVIDENCE.md remain scoped development history. Recovery1.2[A]/v1.2-pre,
its controller/static baseline, three healthy cold masters and full restoration
acceptance remain unfinished. Bus3.5/3.6 are the next explicit dependencies.

2026-10-01 00:01 EDT — Bus3.5–3.11 are merged; five actual Mac timers are
gated and reopened from a resolved timer-only journal. A separate read-only
full-node baseline captured 20 live launchd states and 54 direct file pins
after D21 admitted the legitimate idle on-demand mesh-agent. This is
structural schema evidence only. Standalone still serves five clients,
cluster members 2/3 serve, and member1 remains disabled/unloaded. No complete
source/provenance closure, full-node controller, healthy cold master or
restoration acceptance exists; 1.2 remains active.

2026-10-01 01:29 EDT — D22's source draft expands the full-node Journal
cohort to 23, adding the live gateway and viewer and the installed disabled
federation tick. The prior 20-state/54-file capture is historical and cannot
authorize a new window. A multi-domain read-only preflight refuses two
additional loaded system jobs: a crash-looping legacy agent and an idle
Tailscale one-shot. The protected timer controller `-4` safely refuses the new
full-node scope; it remains usable only for the current timer-only receipt.
Neither system job was altered. Full-node capture, cold masters and truthful
restoration remain open at 1.2[A].

2026-10-01 01:55 EDT — D23's PR #169 correction requires explicit scope for
new journals and binds the full-node baseline to a source-owned, multi-domain
entrypoint scan. Neutral loaded labels and HOME-derived plist paths are now
included; the deploy listener stops first and resumes last. The tightened live
scan still refuses the two unmanaged system jobs. Owned source tests pass, but
exact CI/review and a production driver remain pending. No live full-node hold
or healthy NATS cold copy exists.

2026-10-02 06:20 EDT — The operator-approved host-Ollama change is reflected
in a new read-only 23-unit diagnostic. Mesh-agent remains idle on demand with
plist SHA-256 `d0d01ead…`; memory-daemon runs as PID 37477 with plist SHA-256
`a3fb84ea…` and its live LLM setting matches the plist. The 0600 env file
matches the same target. Structural classes and 59 direct pins over 29 distinct
files were observed. The two unmanaged loaded system jobs still fail the
multi-domain preflight. The recapture is provisional and cannot authorize a
preservation window; 1.2 remains [A] at v1.2-pre.
The source memory-daemon plist template and separate `workspace-bin/install-daemon`
renderer still omit `LLM_BASE_URL`; a future reinstall would drop the live override.

2026-10-02 06:50 EDT — A source-only candidate adds `LLM_BASE_URL` to the
memory-daemon launchd and systemd templates and the direct
macOS/systemd/pm2 installer.
Isolated rendering passes; the live daemon and installed plist are unchanged.
The full-node baseline is still refused by the two loaded system jobs, and
1.2 remains [A] at v1.2-pre.

2026-10-02 07:10 EDT — PR #196 merged at 0d3237f with exact-head 4/4 CI and
Claude's no-blocker review. Memory-daemon source install paths now retain the
configured host-Ollama URL; no installed service changed. Node-init's
mesh-agent renderer still needs to read the saved value on a plain-shell rerun.
The full-node diagnostic remains provisional and 1.2 remains [A].
