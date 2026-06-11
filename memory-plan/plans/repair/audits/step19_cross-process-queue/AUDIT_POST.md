# AUDIT_POST — Step 3.3: health-watch sees the daemon's real queue (R12)

(§0: Block 3, step 3/4, 19/48. AUDIT_PRE folded: spec from LLM_INFRA §7 — separate-process introspection read its own empty singleton; auto-restart structurally dead.)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/ollama-queue.mjs` | ✓ | Cross-process snapshot trio: `exportStateSnapshot` (atomic write, `QUEUE_STATE_PATH` = workspace/.tmp/ollama-queue-state.json), `readStateSnapshot` (staleness guard 2 min — a dead exporter reads as *unknown*, never *idle*), `snapshotLooksStuck` (same F-H17 extraction-only rule). |
| `workspace-bin/memory-daemon.mjs` | ✓ | Tick exports the snapshot (step 6.5, non-fatal). |
| `bin/health-watch.mjs` | ✓ | `getQueueHealth` reads the FILE; `maybeAutoRestartOllama` evaluates the daemon's snapshot, rate-limits locally (the restarter owns its own limit — the daemon's counters reset on its next success), and unloads via the **keep_alive:0 API** — the 3.1 audit measured `ollama stop` NOT evicting while the API does. |
| `test/ollama-queue.test.mjs` | ✓ | +3: round-trip carries live state; missing/stale/corrupt → null; stuck threshold incl. F-H17 analysis exclusion. |

## Verification (Phase 5 — the Proof)

- **Tests:** queue file 30/30; full suite **1526/1526**.
- **Cross-process, real data:** daemon restarted (PID 60113) → snapshot file appears within one tick carrying the daemon's pid; a live inject ran in the daemon → next tick's snapshot shows `runs: 1, analysis avg 1754ms` — the daemon's actual queue activity, read from outside its process.
- **`.daemon-health.md` queue section** (health-watch, separate PID 60116→kickstarted): renders the real numbers (`runs=1, analysis avg=1754ms (n=1)`). Note: the report file only rewrites on status change — its first render raced the snapshot's first export; re-kickstart rendered it (behavior documented, not changed — alert-on-change is by design).
- **Stuck/auto-restart path live:** synthetic stuck snapshot (extraction timeouts=3) → `maybeAutoRestartOllama` returned **true** and qwen3:8b was **genuinely evicted** (api/ps empty), reloading on next use (1.5s, per 3.1's measurement).

## Findings
- None new.

## Carry-forwards
- The snapshot file is a free observability surface — mission-control could render it (no step; noted).
- 3.4 definition next: candidates from LLM_INFRA §9.
