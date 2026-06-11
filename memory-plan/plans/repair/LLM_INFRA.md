# LLM Infrastructure Audit — repair step 3.1 (D8)

**Date:** 2026-06-10 · read-only audit, zero code changes. All latencies MEASURED on the live system (daemon PID 40668, Ollama 0.30.5, qwen3:8b), not estimated. Historical numbers mined from a week of `watcher.jsonl` production events.

---

## 1. Call-site map (what actually talks to the LLM)

| # | Call site | Lane | Caller chain | Measured latency | On failure |
|---|---|---|---|---|---|
| 1 | `extractStructured` (extraction-prompt.mjs) | extraction | runFlush ← daemon flush boundaries (interval/idle/end/NATS) | **13.7–56.6s, p50 38.9s** (n=5 real productions) | regex-fallback extraction; no mentions stored; hash not recorded → retried next flush (1.4) |
| 2 | `generateConceptSummary` (obsidian-summarizer.mjs) | extraction | generateConceptNotes ← flush (missing-first, ≤10) + consolidation (≤25, 5-min cap, abortable) | 3–10s/concept (code-documented; synthesis chains measured 1.6–21.7s end-to-end, n=4) | null → deterministic data-only note body |
| 3 | Query analysis (query-analysis.mjs) | analysis | inject server `/memory/inject` ← companion-bridge | **warm 3.1s; end-to-end inject 1.2s; true-cold (model evicted) 1.56s** | embedding-fallback (channels still serve; loses intent/sentiment shaping) |
| 4 | `healthCheck` (llm-client) | none (direct) | health surfaces | trivial | reports unreachable |

**Dormant (no production caller):** `bin/openclaw-memory-daemon.mjs` (federation, R37), `broadcast-offerer`, promoter summaries (2.3: no caller), `bin/llm-benchmark.mjs` / `extract-existing-sessions.mjs` / `run-block3-validation.mjs` (operator CLIs).

## 2. The timeout chain (every layer, actual values)

```
generate() [extraction lane]
  └─ queue.requestExtraction — waits to completion, NO ceiling on wait
      └─ runWithRetry: ≤3 retries on transient (1s/2s/4s backoff; OLLAMA_QUEUE_RETRIES)
          └─ runFetch: wall timeout 600s (LLM_TIMEOUT) via AbortController
      queue cap: 50 pending extractions (OLLAMA_QUEUE_MAX_PENDING) → reject when full

generateAnalysis() [analysis lane]
  └─ queue.requestAnalysis
      ├─ extraction in flight? → IMMEDIATE fallback (never queues behind a 39s extraction)
      ├─ Promise.race( job , waitTimeoutMs ) — waitTimeoutMs = LLM_ANALYSIS_TIMEOUT (8000)
      │    timeout → abort queue signal → mark slot abandoned → fallback
      └─ runFetch: local wall timeout = same 8000, composed with the queue's abort signal (F-C6)
```

**Verdict: the 8s analysis ceiling is adequate in every measured state** — warm 3.1s, cold-after-eviction 1.56s. The June-1 scar (1s ceiling = structurally impossible) is fixed and verified live (`mode=llm`, `fallbackReason: null`, items 7/5/3 on the 5.3 reference query — note the inject response carries counts under `items` and content in `block`; a probe reading top-level arrays misreads it as empty, which briefly fooled this audit too).

## 3. Queue semantics (lib/ollama-queue.mjs)

Sound: single-flight, analysis-priority drain, structured-signal timeout detection (F-N105), extraction-only stuck counting (F-H17), restart rate-limiting (F-H16), terminal shutdown with pending rejection (F-C5), bounded memory (F-C7).

**Defective — R11, sharpened for 3.2 (two distinct parts):**
1. `requestAnalysis`'s wait-timeout path does `state.currentJob.abandoned = true; currentJob = null` **without checking the job is its own**. If analysis B times out while analysis A executes (B still pending), B abandons A's slot → `drainPending()` starts the next job while A's fetch is in flight → single-flight broken. B's abort signal is attached to nothing (B's run never fired), so A isn't even cancelled.
2. The timed-out caller's own **pending entry is never removed** — drainPending later fires it, running an analysis whose result nobody consumes (the race already resolved to fallback).

## 4. Model selection reality vs the documented claim

- **Reality:** one static env var (`LLM_MODEL`, default `qwen3:8b`) used by every lane. No runtime selection of any kind.
- **The "tiered model selector (qwen3:8b floor, 14b/32b above)" in MASTER_PLAN §3.2 / REGISTRY 1.2 is an install-time RAM advisor** (`bin/check-llm-baseline.mjs` prints a recommendation; nothing consumes it at runtime). qwen3:14b/32b are not even pulled (on-disk models: qwen3:8b, llama3.3:70b, deepseek-r1:32b, qwen2.5-coder:32b).
- **Verdict:** claim is aspirational; docs should say "static model via LLM_MODEL; install-time tier advisor" or a real selector should be built (operator decision at 3.4).

## 5. Pre-warm / eviction

Ollama keep_alive defaults ~5 min (observed `expires_at` 5 min out). After idle eviction, the next analysis reloads the model — **measured 1.56s including generation** (page-cache-warm reload; the old 9.6s number was first-load-from-disk after boot). **Verdict: pre-warm machinery is unnecessary on this hardware at this model size.** Operational note: `ollama stop qwen3:8b` did NOT evict in this test; the `keep_alive: 0` API call did — relevant to health-watch's auto-restart implementation (3.3).

## 6. Config knobs (the full inventory)

`LLM_MODEL` (qwen3:8b) · `LLM_BASE_URL` · `LLM_TIMEOUT` (600s) · `LLM_ANALYSIS_TIMEOUT` (8000) · `LLM_NATIVE_API` (native /api/chat for `think:false`) · `LLM_FORCE_FREE_FORM` (grammar-decoder stall escape) · `OLLAMA_QUEUE_RETRIES` · `OLLAMA_QUEUE_MAX_PENDING` (50) · `ANALYSIS_TIMEOUT_MS` (queue-side, **see R43**) · `SHUTDOWN_GRACE_MS` · `CONSOLIDATE_MAX_SUMMARIES_PER_CYCLE` (25).

## 7. Verdicts per component

| Component | Verdict |
|---|---|
| llm-client (both lanes) | **Sound.** Timer hygiene, signal composition, native-endpoint rationale all hold. |
| ollama-queue | **Sound except R11** (3.2 fixes ownership + stale-pending). |
| Analysis path end-to-end | **Sound.** 8s ceiling adequate warm AND cold; live inject verified healthy (7/5/3). |
| Extraction path | **Sound but expensive** (p50 39s). 1.4's dedup already removed the redundant runs; cost is now per-new-content only. |
| health-watch LLM introspection | **Dead** (R12) — separate process reads its own empty queue; 3.3 fixes. |
| Tiered model selection | **Doesn't exist at runtime** (R44) — docs claim vs reality. |
| Pre-warm | **Not needed** — measured, closed by this audit. |

## 8. New findings (appended to FINDINGS_2026-06-02.md)

- **R43 (M):** Two env knobs for one timeout: the queue's `ANALYSIS_TIMEOUT_MS` (default **1000**) is shadowed by llm-client always passing `LLM_ANALYSIS_TIMEOUT` (8000) — but any direct `requestAnalysis` caller silently gets the old broken 1s ceiling. Dead-but-loaded footgun; unify at 3.2/3.4.
- **R44 (L):** "Tiered model selector" documented as a runtime component is an install-time advisory CLI; registry/master-plan wording misleads (per §4.5 reality-before-aspiration).

## 9. 3.4 candidates (for block-open definition)

R43 unification · R44 docs-or-build decision · R42 `extractJsonFromText` fast-path · theme↔session schema linkage (2.9 capture) · 50KB session floor (2.5 capture) · extraction p50 39s cost review (acceptable? prompt-size cap?).
