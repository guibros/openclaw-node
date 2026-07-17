# AUDIT_PRE — flush off the daemon main thread (queue item 5, operator-approved 2026-07-16 "ok")

**Written:** 2026-07-16T22:30Z, before the code.

## The problem (evidence: memory_ingest_remediation FINAL ADDENDUM)

Thread sample during a hung inject request: the daemon's MAIN THREAD saturated in V8 string ops
(`CopyChars` / `String::WriteToFlat`) while a flush ground the ~11MB transcript. The inject HTTP
server (:7893) shares that event loop → requests starve (observed: 60s, zero bytes) → `mem.inject`
honestly reads BROKEN during every flush/synthesis window and recovers between them. The flush's
parse + prompt-building is synchronous string work; `await`s inside it don't help the loop.

## Plan

1. **`workspace-bin/flush-worker.mjs`** (new): a `worker_threads` entry that constructs its own
   LLM client + extraction store (both env-derived; neither is structured-cloneable) and runs the
   REAL `runFlush` from `lib/pre-compression-flush.mjs`, posting the plain-data result back.
   The worker loads no embedder (flush uses HTTP LLM + sqlite only).
2. **`workspace-bin/memory-daemon.mjs`**: `runFlushInWorker(jsonl, memoryMd, {charBudget})` —
   spawns the worker, resolves on message, rejects on error/nonzero exit, 30-min terminate
   backstop. All **5** `serializeFlush(() => runFlush(...))` call sites keep `serializeFlush`
   (still exactly one flush at a time) but the inner call becomes the worker. Main thread stays
   free: inject answers during flushes.
3. Concurrency note: the worker opens its own better-sqlite3 connection to state.db (WAL,
   short transactions) alongside the daemon's — same multi-connection pattern the daemon + CLI
   tools already use.

## Verify contract (no inference)

- Restart daemon → fire an extraction trigger → **while the flush grinds** (llama-server busy),
  a manual inject POST answers in seconds (was: starved for the whole window).
- Flush completes with the same result shape (`facts/added/mode`, degrade path intact).
- Memory axis green through the window; suite untouched elsewhere stays green.

---

# AUDIT_POST (appended) — 2026-07-17T03:05Z

## Delivered + observed

- **v1** moved `runFlush` into `workspace-bin/flush-worker.mjs` — first flush in days completed in
  **[llm] mode** (not regex): "interval synthesis [llm]" then "nats-triggered flush [llm]". But
  inject STILL starved during grinds → measured again, found the remaining on-thread parses.
- **v2** moved ALL transcript parsing off the main thread: `shouldFlush` (full-file token check)
  now runs INSIDE the worker (`checkShouldFlush`), and the live session import
  (`importSession` — full parse + wholesale row replace) runs via `runImportInWorker`. One generic
  `runMemoryWorker({kind: 'flush'|'import'})` with a terminate backstop.
- **Loop-unblock PROVEN:** during a full grind (llama 80%), no-auth requests that previously got
  ZERO BYTES for 10–15s now receive real `HTTP 401` responses (4.5s/7.2s/9.3s — CPU-starved but
  turning); after the window, `sample` shows the main thread idle in `uv_run`. The flush completed
  through the worker and the daemon survived the whole cycle (no restart).

## Honest residuals (queued, measured)

- **Retrieval service time is ~13s/query on this VM under load** (watcher events:
  `memory.retrieved status:ok duration_ms=13069`, 15 results). Requests serialize, so probes with
  12–20s deadlines expire while their turn is queued — they look "hung" but the pipeline completes
  every job. This is embed/CPU/memory-pressure economics on a one-box node (llama 8B + BGE-M3 +
  daemons), not loop blockage: fix later via embed-queue priority / probe budgets matched to
  measured service time / model economics. The mem.inject probe's 12s budget < 13s service time ⇒
  honest red under load, green when idle.
- `memory.error` event schema mismatch still pending (queue item 7).
