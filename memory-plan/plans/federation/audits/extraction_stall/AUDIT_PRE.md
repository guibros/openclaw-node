# AUDIT_PRE — mem.extraction 45h zero-fact stall (queue item 1)

**Written:** 2026-07-18 ~13:45 EDT, after diagnosis, before any fix. Operator approved the queue
("go"); this is its first item.

## Symptom
Watcher: mem.extraction BROKEN, stalled since 2026-07-16T20:26Z. Confirmed ground truth:
`entities` MAX(created_at) = 2026-07-16T20:26:15Z — 45h with zero new facts while dev sessions ran
continuously.

## What it was NOT (each ruled out by observation)
- NOT an Ollama outage: /api/tags + /api/version answer; model loads in 16s (sched log
  13:08:18→13:08:34); the daemon err log carrying the old `fetch failed` lines has not grown
  since the 2026-07-17 20:50 boot.
- NOT the daemon wedged: health probes every 5min, main thread idle in uv_run, live-session
  import + session-trace active.
- NOT the parser/selector: `findCurrentJsonl` picks this session's growing file; the parser sees
  messages written 2 minutes prior; the tail hash changes between runs.
- NOT the Jul-16 22:11 Ollama update alone: first `[llm]: 0 facts` at 20:04 EDT, pre-update.

## Root cause (reproduced live, twice)
`qwen3:8b` (a thinking model) + `format: "json"` on /api/chat: the JSON grammar forbids the
model's `<think>` opening, the grammar-constrained decoder hunts low-probability tokens and either
1. **stalls** until Ollama's runner watchdog kills the runner at ~5m01s → connection reset →
   client sees `fetch failed` → degraded regex fallback (the Jul-16 15:09–17:55 `regex-diverted`
   era and the historical err-log lines), or
2. **emits degenerate junk** — observed live: a 15-completion-token
   `{"error": "Cannot find module '/usr/local/bin/node'"}` (string hallucinated from the
   transcript tail) → parses to 0 entities/themes/decisions → recorded as a SUCCESSFUL
   extraction (hash stored, dedup then skips follow-on flushes) → the silent 0-fact regime.

Repro A (real 40-msg tail): 27s, junk JSON, 0 facts. Repro B (2 trivial known-good messages):
~5min stall → `fetch failed`. Log census pins the flip: Jul 16 11:41 EDT `[llm]: 27 facts found,
27 added` (last good); every `[llm]` line since = 0 facts (3× on the 16th, 6× the 17th, 4× the
18th). Why the behavior flipped mid-day Jul 16 is not fully pinned (pre-update Ollama logs
rotated away); the mechanism is proven regardless.

The failure mode is documented IN THE CLIENT (lib/llm-client.mjs, comment at the format:json
site) together with its escape hatch: `LLM_FORCE_FREE_FORM=1` disables format:json; the model
emits free-form text (usually valid JSON — the prompt asks for it) which the tolerant
`extractJsonFromText` parser handles.

## Plan
1. A/B in flight: same trivial content with `LLM_FORCE_FREE_FORM=1` — expect real entities and a
   sane duration. Fix proceeds only on an observed PASS.
2. Runtime fix: add `LLM_FORCE_FREE_FORM=1` to ~/.openclaw/openclaw.env (runtime config, not in
   repo) + `launchctl kickstart -k` the daemon.
3. Verify end-to-end: trigger an extraction and observe `[llm]: N facts, N added` with N>0;
   `entities` MAX(created_at) advances; node-watch memory axis extraction grading recovers.
4. Repo follow-through in this batch if the A/B verdict supports it: default free-form for
   thinking-family models in lib/llm-client.mjs (mirror of the existing
   OLLAMA_THINKING_FAMILIES guard in llm-providers) so fresh installs don't ship the broken
   combo — plus a unit test locking the format decision, openclaw.env.example + NODE_SPEC note.
   If deferred instead: capture to OUT_OF_SCOPE with this evidence.

## Rules
No repo code edits before the A/B verdict. The env-file edit + daemon restart are ops actions of
the kind this arc already performs; evidence lands here and in AUDIT_POST.
