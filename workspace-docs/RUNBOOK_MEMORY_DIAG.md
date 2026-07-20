# RUNBOOK — memory pipeline diagnosis (extraction / inject / indexing)

Distilled from the 2026-07-18 resurrection (audits/extraction_stall, inject_hang,
incremental_indexing). Work the tree top-down; each step's evidence decides the branch.

## 0. Ground truth first (30 seconds)
```bash
node bin/node-watch.mjs --deep --axis memory        # the honest grades
sqlite3 ~/.openclaw/state.db "SELECT COUNT(*), MAX(first_seen) FROM entities"   # facts frozen?
tail -5 ~/.openclaw/workspace/.tmp/memory-daemon.err                            # loud failures
grep -E "flush \[|synthesis \[" ~/.openclaw/workspace/.tmp/memory-daemon.log | tail -5
```
Key discriminator in the flush lines: `[llm]: 0 facts` repeatedly = SILENT semantic failure
(pipeline "works", output garbage). `[regex-diverted]` = LLM path erroring, regex carrying.
`[llm-dedup] skipped` = tail hash unchanged since last successful extraction — fine if the
session is idle, suspicious if it's active.

## 1. Extraction returns 0 facts / "fetch failed"
- `curl -m 5 http://127.0.0.1:11434/api/version` — server up?
- `curl -s http://127.0.0.1:11434/api/ps` — model loaded? **size_vram matters**: qwen3:8b healthy
  ≈ 5.3GB. ~0.6GB = degraded post-watchdog-kill residue → `ollama stop qwen3:8b`, re-generate
  once (19s reload), confirm ~2.5+ tok/s in the runner log.
- Ollama sched log `~/.ollama/logs/server.log`: repeated `Load failed … context canceled` =
  clients aborting mid-load; `runner watchdog` kills at ~5m01s surface client-side as
  **"fetch failed"**.
- format:"json" NEVER goes to thinking-family models (qwen3/deepseek-r1/magistral/gpt-oss) —
  `useJsonFormat()` in lib/llm-client.mjs gates it; `LLM_FORCE_FREE_FORM=1` is the global
  override. The grammar stall on those models is the historic 45h zero-fact cause.
- Repro one extraction end-to-end (read-only, ~2-6 min):
  the wrapped-client snippet in audits/extraction_stall/AUDIT_POST — prints RAW model output.
  Parroted `[role]:` transcript lines = prompt-side; junk 15-token JSON = model/format-side.

## 2. inject (:7893) hangs or times out
- It runs INSIDE the memory daemon. `pgrep -f workspace/bin/memory-daemon.mjs` then
  `sample <pid> 3` DURING a hang: main thread pinned in MicrotaskQueue/CheckImmediate = some job
  is back on the main thread (knowledge-index belongs in the CHILD PROCESS
  `workspace-bin/knowledge-index-job.mjs` — onnxruntime-node fatally crashes worker_threads AND
  pins the loop inline; check the daemon still spawns it via execFile).
- Honest latency: ~1-10s (8s analysis fallback + retrieval). `analysis.mode:
  "embedding-fallback"` is DESIGNED degradation on slow hardware, not a bug.
- Probe budgets: MEM-L2-INJECT HTTP 20s / probe 25s — locked to the design by
  test/gate-mutation.test.mjs. A BROKEN grade with sub-budget manual probes = re-check budgets
  vs current DEFAULT_ANALYSIS_TIMEOUT.

## 3. Box saturated / index churn
- `uptime` + `pgrep -f knowledge-index-job`: one child at a time is normal; load 15+ sustained
  is not. Incremental indexing (lib/mcp-knowledge/core.mjs) embeds only appended turns —
  `{"indexed":N,"chunks":small}` in seconds. A grown session re-embedding EVERYTHING again means
  the prefix-hash check is failing → look for history rewrites (session-store re-import) — full
  rebuild is then CORRECT, once. Every cycle = investigate.
- Manual run: `node workspace-bin/knowledge-index-job.mjs ~/.openclaw/state.db \
  ~/.openclaw/workspace/.knowledge.db 5` — exit 134 after the JSON line is NORMAL (onnx teardown
  abort; the trailing JSON is the completion certificate the daemon parses).

## Deploy notes
workspace/lib → symlink to repo lib (edits live at next worker/job spawn). memory-daemon.mjs and
flush-worker.mjs are REAL COPIES in workspace/bin — `cp` + `launchctl kickstart -k
gui/501/ai.openclaw.memory-daemon` required. Boot must show 0 `[federation]` lines unless
OPENCLAW_FEDERATION=1.
