# AUDIT_PRE — mem.inject POST hang (queue item 2)

**Written:** 2026-07-18 ~16:05 EDT, after diagnosis, before the (small) code change.

## Ledgered symptom
"Accepts TCP, hangs >30s on POST" — ledgered 07-10, re-observed 07-16/17; watcher grade BROKEN.

## Diagnosis (all observed today, post item-1 fix)
1. Direct authorized POSTs to :7893/memory/inject — four probes with real prompts:
   HTTP 200 in 0.59s / 3.5s / 1.0s / 0.63s (noop-path) and 9.1s / 8.7s / 10.0s (full pipeline,
   real prompts, 220–309-token blocks). **The >30s hang no longer reproduces.**
2. Explanation for the historical hang: inject's LLM analysis call shares Ollama's single slot
   (-np 1) with extraction. Pre-fix, extraction requests stalled the slot for 5 minutes at a time
   (format:json grammar stall, audits/extraction_stall) — inject's queued analysis had nowhere to
   go, so POSTs hung far past 30s. Item 1's fix removed the slot-hogging; the hang went with it.
   (Not provable retroactively — the stalled runs are gone — but the mechanism is observed on the
   extraction side and the timing of the recovery matches.)
3. Current honest mode: `analysis.mode: embedding-fallback` on every full probe — the 8s
   LLM-analysis budget (DEFAULT_ANALYSIS_TIMEOUT) is unattainable at this VM's ~2.5 tok/s, so the
   server degrades to embedding-only retrieval BY DESIGN and reports it. Raising that budget would
   make every inject slower than the fallback; leaving it is correct on this hardware.
4. Residual defect: the watcher still grades mem.inject BROKEN — "inject HTTP This operation was
   aborted". MEM-L2-INJECT probes with httpPost timeoutMs=12000 (probe timeoutMs 15000), but the
   server's DESIGNED worst case is ~9–11s (8s analysis wait + retrieval), and the deep run fires
   its own LLM probes on the same box immediately before — observed full-pipeline latencies up to
   10.04s cross 12s under that contention. Budget-vs-design miscalibration, same class as the
   fixed 30s-clamp-on-120s-LLM-probes watcher defect.

## Plan
- lib/node-acceptance-probes.mjs MEM-L2-INJECT: httpPost timeoutMs 12000 → 20000, probe timeoutMs
  15000 → 25000 (designed worst case + contention margin).
- Rerun `node bin/node-watch.mjs --deep --axis memory` — expect 6/6 WORKING; that flips the
  official grade and closes item 2.
- No server-side change: the hang is gone and embedding-fallback is honest designed degradation.
