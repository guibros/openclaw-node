# AUDIT_POST — Step 3.4: audit remediations (R43, R42, R44-docs) — closes Block 3

(§0: Block 3, step 4/4, 20/48. Operator confirmed "fix the docs" — the only judgment item in the defined scope.)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/ollama-queue.mjs` | ✓ | R43: `ANALYSIS_TIMEOUT_MS` (default 1000 — the old structurally-broken ceiling, still loaded for any direct caller) removed; one knob, `LLM_ANALYSIS_TIMEOUT`, default 8000, at both layers. |
| `lib/extraction-prompt.mjs` | ✓ | R42: fast path JSON.parse-validates before returning; concatenated `{...}{...}` falls through to the largest-balanced-block scanner. |
| `memory-plan/canonical/MASTER_PLAN.md` (+4 silo copies) | ✓ | R44: §3.2 reads measured reality (static LLM_MODEL; install-time advisor; selector = unclaimed future scope), cross-refs LLM_INFRA.md. Landed per §11 in its own `master-plan:` commit (70f61c5), synced to all silos. |
| Tests | ✓ | R43: a 1.2s analysis with no explicit timeout completes `mode=llm` (fell back under the old default). R42: `{...}{...}` recovers parseable + pure-JSON fast path untouched. |

## Verification (Phase 5 — the Proof)

- **(a)** grep: zero `ANALYSIS_TIMEOUT_MS` references remain; queue test locks the 8s-grade default. **(b)** regression green. **(c)** the canonical doc + all silo copies corrected and committed.
- **Suite:** **1529/1529**. Daemon restarted onto v3.4 (sanity inject: `mode=llm`, 7/5/3). One transient embed-benchmark perf flake observed during a loaded run earlier; clean on re-runs (known, pre-existing).

## Macro Re-Orient (Block 3 close, WORKFLOW §7.2)

- **North star:** D8 served exactly as designed — measure first (3.1), then fix only what the measurements convicted (3.2 queue ownership, 3.3 cross-process introspection, 3.4 knob/parser/docs). The audit also *cleared* suspects: pre-warm unnecessary, 8s ceiling adequate warm and cold, extraction cost acceptable post-dedup.
- **Registry probes (live):** daemon healthy on current code; queue snapshot exporting per tick; health-watch reporting the daemon's real queue; `.daemon-health.md` healthy; suite 1529/0.
- **Block 4 re-survey (daemon lifecycle: 4.1 shutdown fencing, 4.2 probe decoupling, 4.3 NATS re-init, 4.4 session-switch JSONL, 4.5 idle-timer loop):** all still atomic, correctly ordered, and unchanged in priority — 4.1 remains the big one (every restart this plan has exits -9/-6; live evidence keeps accumulating). The 50KB-floor capture (OUT_OF_SCOPE) is adjacent to 4.4 — triage it into Block 4's scope-setting.
- **Drift check:** none — every change this block maps to a step commit (+ the §11 master-plan commit).
- **OUT_OF_SCOPE balance:** theme↔session linkage and 50KB floor remain captured (extraction-schema / Block 4 territory); tier-selector-as-feature is explicitly unclaimed scope awaiting operator demand.
