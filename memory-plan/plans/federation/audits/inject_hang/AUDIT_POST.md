# AUDIT_POST — mem.inject hang RESOLVED (queue item 2)

**Closed:** 2026-07-18 ~17:10 EDT. Verified: 30/30 inject probes over 8 minutes WITH the embedder
grinding beside it — 0 failures, worst 19s, daemon PID stable — followed by the full index cycle
completing end-to-end (`17:06:20 Phase 2: knowledge-index: 1 sessions indexed (844 chunks)`).

## What the hang actually was (three theories died on evidence first)
1. ~~Probe-budget miscalibration~~ — bumped 12s→20s, still BROKEN; a manual probe then hung 60s+.
2. ~~Ollama slot contention~~ — the hang reproduced with Ollama fully idle.
3. **Main-thread starvation, caught red-handed**: thread sample during a hang window showed the
   daemon's main thread 100%-pinned in V8 microtask processing (2165/2165 samples in
   CheckImmediate→PerformCheckpoint). The Phase-2 knowledge-index step ran the
   @huggingface/transformers embedder — CPU-bound in-process inference — on the daemon's event
   loop, re-embedding this ever-growing 15.8MB session every cycle. Kernel accepts TCP, the loop
   never services the POST: exactly the ledgered symptom, worse as the session grew.

## Fix (two iterations, the first one confessed)
- **Iteration 1 (WRONG, crashed production)**: moved the index into the flush WORKER THREAD —
  onnxruntime-node (the embedder's native addon) fatally aborts the whole process when loaded in
  a worker_thread. Daemon crash-looped ~3 min (operator saw it live); reverted to HEAD deploys
  within a minute of diagnosis.
- **Iteration 2 (correct)**: `workspace-bin/knowledge-index-job.mjs` — a CHILD PROCESS. Native
  inference gets its own main thread; a crash kills only the job. Known wart handled explicitly:
  onnxruntime aborts in C++ static teardown at exit (134) even after `dispose()` — repro'd both
  ways — so the job prints a trailing JSON `{indexed, chunks}` line as its completion
  certificate and the daemon parses stdout from success OR the rejection's `e.stdout`, treating
  exit code as noise. 30-min budget (observed runtime 21–28 min on this session).
- MEM-L2-INJECT probe budgets 12s→20s (HTTP) / 15s→25s (probe): the server's designed worst case
  is ~9–11s and 19s was observed under full embed load; the old budget marked live-but-loaded as
  BROKEN.
- Wiring-manifest row locks `indexSessionTurns` into the job file.

## Evidence chain (all observed)
- Hang trap: first probe 25s-timeout → sample → microtask pin (hang_sample.txt).
- Crash: JS stack `onnxruntime-node/dist/backend.js:48` in the worker-thread deploy; PID churn
  13778→15402; probes hit connection-refused during restarts.
- Standalone job: `{"indexed":1,"chunks":842}` printed, then exit 134 — work completes before the
  teardown abort. Dispose repro: `disposed cleanly` then the same abort.
- Final: 30 probes / 8 min during live child indexing — fails=0, worst=19s, pid 25098 → 25098;
  child visible as its own PID (25547); completion line at 17:06:20 (844 chunks); daemon healthy
  after (recap + live import at 17:07).

## Ledgered
- Full re-embed per growth cycle (~850 chunks / ~20-28 min per pass on this session) — needs
  chunk-level incremental indexing; until then the index lags the live session by design.
- 16:52 flush degradation ("fetch failed" under full embed CPU load) — the designed loud regex
  fallback; watch frequency under sustained embedding.
