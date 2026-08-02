# AUDIT_POST — step 4.1 · Memory cadence and event spine

## §1 Promised vs landed

| Promised | Actual | Landed |
|---|---|---|
| Queue-authoritative idle gate | In-process scheduling reads the live queue; launchd reads a fresh daemon snapshot; missing/stale snapshots fail closed | yes |
| Authenticated standalone events | Scheduler and consolidation CLI use the shared NATS token resolver | yes |
| Valid local stream identity | Producer, consumers, and acceptance probe share one canonical node-id/stream-name helper | yes |
| Current cross-process queue state | Queue transitions trigger atomic daemon snapshot exports, not only coarse daemon ticks | yes |
| Live scheduled cycle | Launchd crossed the idle gate and started a real cycle | yes, start only |

## §2 Greppable and runtime deltas

- `rg '/api/ps|Ollama has active inference' bin/consolidation-scheduler.mjs test/consolidation-scheduler.test.mjs` returns no match.
- `workspace-bin/plan-lint.sh protocol`: 15 PASS, 1 grandfathered WARN, 0 FAIL; VERSION v4.1
  coheres with the closed inventory row and the preflight points to 4.2.
- Focused scheduler/event/queue/watcher/acceptance suite: 167 tests, 167 pass, 0 fail.
- Host full baseline: 1925 tests, 1923 pass, 1 fail, 1 skip. The sole failure is the pre-existing
  load-sensitive embedding benchmark: 530.4ms mean versus its fixed 500ms target; the batch does not
  touch embedding code.
- Repository/runtime SHA-256 hashes match for the scheduler, daemon, consolidation CLI, promoter,
  queue, local-event-log, and memory-watcher files.
- Restarted memory-daemon PID 91286 initialized `local-events-moltymacs-virtual-machine` and exported
  a fresh snapshot with `current_job=null`, `queue_depth=0`.
- Host-level `node-watch --axis network`: `net.nats`, `net.stream`, `net.pubsub`, and the legacy
  load-only `net.mesh` probe grade WORKING; `net.federation` remains UNKNOWN by design. Step 4.3 will
  replace the load-only mesh verdict.
- Launchd scheduler logged `NATS connected ... events will be emitted` followed by `system idle —
  starting consolidation cycle`. It then exited 1 with the separately bounded error `consolidation
  cycle exceeded hard cap (300000ms) (300029ms)`.

## §3 Cross-references

- Protocol D9 owns queue activity, local stream identity, and standalone NATS authentication.
- Inventory 4.1 closes only the scheduler/event path. The hard-cap completion finding is retained in
  OUT_OF_SCOPE and the component registry; no daily-cadence recovery claim is made.
- Step 4.2 consumes the stable watcher/event substrate before dependency-topology cleanup.

## §4 Findings

- [NEGATIVE->fixed] `OLLAMA_KEEP_ALIVE=24h` made model residency a nearly permanent false-busy signal.
- [NEGATIVE->fixed] Standalone NATS clients omitted the configured token and silently lost event evidence.
- [NEGATIVE->fixed] A dotted macOS hostname generated an illegal NATS stream name.
- [NEGATIVE->fixed] Coarse queue snapshots could miss short jobs; transition-driven snapshots close that race.
- [NEGATIVE->open] A real cycle still exceeds the five-minute hard cap. The scheduler is live and honest,
  but end-to-end consolidation completion remains degraded.
- [NEGATIVE->known] The full baseline's embedding benchmark remains environment-sensitive at 530.4ms mean.

## §5 Phase-8 patches

The audit caught one correctness gap after the first implementation pass: exporting queue state only
on daemon ticks could overlap a short inference job. A queue state observer now exports on current-job,
pending, fallback, and shutdown transitions; the focused suite was rerun after that patch.

## §6 Carry-forwards

1. Step 4.2 removes nested Sharp/libvips trees and proves a full deep watcher exits normally.
2. Step 4.3 makes gateway freshness and running PIDs load-bearing watcher evidence.
3. Step 4.4 authenticates the scheduler heartbeat without weakening Mission Control middleware.
4. A separately approved performance step must profile the real consolidation phases and prove a
   complete cycle; raising the hard cap alone is not evidence of optimization.

## Feeds landing (Phase 9)

The queue snapshot feeds standalone scheduler admission. The canonical stream helper feeds producer,
watcher, promoter, and acceptance probes. Authenticated event emission feeds node-watch and future
federation evidence. The explicit hard-cap finding feeds consolidation performance work rather than a
false recovery claim.
