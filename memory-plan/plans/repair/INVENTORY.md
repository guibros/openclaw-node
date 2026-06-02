# Repair Plan — Step Inventory

Every finding from `FINDINGS_2026-06-02.md` (the 2026-06-02 deep review) decomposed to atomic grain. **One step = one independently-verifiable runtime outcome = one 9-phase cycle = one commit** (`WORKFLOW.md`). Done-evidence must be *runtime-observable* (MASTER_PLAN §5), not just tests-green.

**Operator priorities (2026-06-02):** (1) the Obsidian vault + wikilink referential system fully implemented, transparent, and working — D7; (2) the local LLM infrastructure audited before further wiring — D8; (3) security fixes PARKED until a working prototype (Block P), with remarks documented.

**Sequencing rationale:** Block 1 precedes the vault work because the vault is *generated from* the entity/decision tables that Blocks-1 bugs corrupt every 30 minutes (R1/R2/R3/R4). Building the referential system on those tables first would render fiction. Block 1 is small; Block 2 is the headline.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed.
**Version:** `v<block>.<step>`, carrier starts at `v0.0`.
**Driver:** per-step recommendation — `tick` (autonomous-safe), `hybrid` (tick implements, operator verifies — the redesign Block 4-6 pattern), `operator` (interactive only).

---

## Block 1 — Stop the data corruption · R1-R5, R39

The knowledge graph's numbers must measure memory, not scheduler uptime, before anything is built on them.

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 1 | 1.1 | v1.1 | [ ] | hybrid | Tick re-entrancy guard: one in-flight tick at a time (R3) |
| 1 | 1.2 | v1.2 | [ ] | hybrid | Time-anchored decay: idempotent w.r.t. cycle frequency (R1) |
| 1 | 1.3 | v1.3 | [ ] | hybrid | Idempotent reinforcement: a pair reinforces once per new evidence, not per cycle (R2) |
| 1 | 1.4 | v1.4 | [ ] | hybrid | Extraction dedup at flush boundaries: unchanged tail → noop, not re-extract (R4) |
| 1 | 1.5 | v1.5 | [ ] | tick | turn_index stamp fix: last real turn, 0-based (R5) + atomic MEMORY.md writes (R39) |
| 1 | 1.6 | v1.6 | [ ] | operator | Data repair: backup, restore archived entities from `entities_archived`, rebaseline salience/mention_count |

> **1.1:** induce a >30s tick (real LLM extraction); daemon log shows the overlapping fire skipped (`tick skipped — in-flight`), zero concurrent Phase-2 runs; throttle state consistent after.
> **1.2:** 3 consecutive cycles within 1h on a copy of state.db → an idle entity's salience decreases once by the elapsed-time amount (≤~0.2%), not 3 compounding multiplications; `entities_archived` stops growing in idle steady-state.
> **1.3:** 2 consecutive cycles with no new sessions → zero `mention_count` change, zero salience boosts; a genuinely new shared session does reinforce once.
> **1.4:** flush twice over an unchanged session → second flush emits noop (watcher `status:noop`), zero new mention rows; a grown session still extracts the delta.
> **1.5:** new mention rows carry `turn_index == messageCount-1` matching a real `session_chunks.turn_index`; MEMORY.md write path goes through `lib/atomic-write.mjs` (grep + a flush observed).
> **1.6:** dated backup of state.db exists; restored-entity count reported; post-repair consolidation cycle archives ~0 entities and survivors' salience is stable across 2 cycles. Numbers documented in DECISIONS.md.

## Block 2 — The vault referential system · D7 · R6-R10 · **the headline**

The Obsidian vault + wikilink graph is THE referential surface. Fully transparent (D7), fully generated, links verified resolving. Maximum observability for dev/test.

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | hybrid | Unify ALL synthesis/consolidation paths on transparent (respectPrivacy:false everywhere local) per D7 (R6) |
| 2 | 2.2 | v2.2 | [ ] | tick | One shared slugify: writers + mission-control route agree (R7) |
| 2 | 2.3 | v2.3 | [ ] | tick | Promoter idempotency: write only new/changed notes (R8) |
| 2 | 2.4 | v2.4 | [ ] | hybrid | Vault link-integrity checker: every wikilink resolves, orphans reported, runs on the synthesis cadence (R9) |
| 2 | 2.5 | v2.5 | [ ] | hybrid | Referential completeness pass: every entity ≥ threshold has a concept note; session notes link concepts; decisions/themes represented; coverage measured (R9) |
| 2 | 2.6 | v2.6 | [ ] | tick | memory.synthesized carries session_id + correct trigger labels; watcher shows vault writes per session (R10) |

> **2.1:** a consolidation cycle AND a flush both write concept notes for previously-private entities; grep shows no privacy-filtered vault path remaining; D7 logged with the security remark (R36). The `private` column is retained (federation-era semantics), just not consulted by local vault writers.
> **2.2:** a >60-char concept name renders its prose in the content browser; one slugify function imported by both sides (grep: single definition).
> **2.3:** two promoter runs back-to-back → second writes 0 files (vault mtimes unchanged).
> **2.4:** checker runs against the live vault and reports counts; a deliberately seeded dangling `[[link]]` is detected and surfaced (watcher record or mission-control); fixing it clears the report.
> **2.5:** coverage report: % of above-threshold entities with notes, % of session notes with resolving concept links — both visible (CLI or panel) and ≥ agreed target; spot-check in Obsidian shows links navigate.
> **2.6:** watcher records for `memory.synthesized` show real `session` values (not null) and `trigger` ∈ {session_end, interval, manual} matching the actual cause.

## Block 3 — Local LLM infrastructure · D8 · R11-R14 · audit before wiring

Operator verdict: crucial part of the harness, wiring quality untrusted. Reality before aspiration (MASTER_PLAN §4.5): measure first, then fix.

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | operator | LLM infra audit (read-only) → `LLM_INFRA.md`: every call site, queue semantics, full timeout chain, measured cold/warm latencies per model+site, model-selection reality vs the "tiered selector" claim, pre-warm gap (R13) |
| 3 | 3.2 | v3.2 | [ ] | hybrid | Queue single-flight ownership: a wait-timeout abandons only its OWN job (R11) |
| 3 | 3.3 | v3.3 | [ ] | hybrid | Cross-process queue/health introspection: health-watch can actually see the daemon's queue; stuck-detection + Ollama auto-restart become live (R12) |
| 3 | 3.4 | v3.4 | [ ] | — | Remediation steps defined at block-open from 3.1 findings (timeouts, pre-warm, tiering, analysis-path) — same deferred-definition pattern as redesign Block 7 |

> **3.1:** `LLM_INFRA.md` exists in this plan dir with measured numbers (not estimates) for each call site: model, cold ms, warm ms, timeout budget, failure behavior; a verdict per component (sound / misw wired / dead); findings appended to FINDINGS as R43+. Fix nothing in this step.
> **3.2:** regression test: two overlapping analysis calls, the waiter times out → running job NOT abandoned, no second concurrent Ollama request (assert via queue state); existing 1488 suite green.
> **3.3:** induce a stuck/slow LLM job → health-watch (separate process) reports it within its interval; `.daemon-health.md` queue section shows the real queue, not idle.
> **3.4:** defined at block-open.

## Block 4 — Daemon lifecycle · R15-R17

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 4 | 4.1 | v4.1 | [ ] | hybrid | Shutdown fencing: stop interval, await in-flight tick (capped), close handles once, exit explicitly (R15) |
| 4 | 4.2 | v4.2 | [ ] | hybrid | NATS init resilience: retry/re-init after failed boot connect; health probes decoupled from the NATS block (R16) |
| 4 | 4.3 | v4.3 | [ ] | tick | IDLE→ENDED uses findJsonlBySessionId, not findCurrentJsonl (R17) |

> **4.1:** `launchctl kickstart -k` mid-extraction → clean "shutting down" log, exit within cap (<10s), launchctl shows exit status 0 (not -9), no mutex/ReferenceError in `.err`, WALs truncated.
> **4.2:** stop NATS, restart daemon → store-health probes still run (watcher.jsonl probe records); start NATS → event log + watcher come up WITHOUT a daemon restart (log line proves re-init).
> **4.3:** induce a session-switch end → flush/archive log names the ENDED session's JSONL (not the new one); regression test on the handler.

## Block 5 — Retrieval freshness + honest signals · R18-R22

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | hybrid | Knowledge re-index on growth: hash-compare instead of existence-skip (R18) |
| 5 | 5.2 | v5.2 | [ ] | tick | Retrieval channel errors surface: log + memory.error, never silent `[]` (R19) |
| 5 | 5.3 | v5.3 | [ ] | hybrid | Stall detector counts only pipeline ops; promotion no-op loop resolved (emit-on-change or real promotion bookkeeping) (R20) |
| 5 | 5.4 | v5.4 | [ ] | tick | Readonly opens get busy_timeout; integrity_check only where it belongs (open-time opt, not per-probe) (R21, R22) |

> **5.1:** index a session mid-flight, grow it, next Phase-2 pass re-indexes (chunk count grows, content_hash updated in `session_documents`); FTS query returns late-session content.
> **5.2:** induce a channel failure (e.g. rename a table on a scratch DB) → memory.error event in watcher naming the channel; no silent empty result.
> **5.3:** with the consolidation scheduler running but ingest/extract stopped → `stalled` alert fires within threshold; an unchanged promotion candidate set does not re-emit identical events every cycle.
> **5.4:** health-watch + watcher probes run during a heavy write burst with zero SQLITE_BUSY failures; integrity_check observed only at daemon boot (or explicit CLI), not per-minute — verified by timing the health poll (<50ms).

## Block 6 — Watcher/UI truth + usability · R23-R27

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 6 | 6.1 | v6.1 | [ ] | tick | event_id preserved through toWatcherRecord; stable row keys — detail panel survives polls (R23) |
| 6 | 6.2 | v6.2 | [ ] | tick | HealthCard reads the fields the probe emits — drift light tells the truth (R24) |
| 6 | 6.3 | v6.3 | [ ] | tick | fmtVal basenames only known path fields; content strings render whole (R25) + session-less panels skip the dead fetch (R26) |
| 6 | 6.4 | v6.4 | [ ] | hybrid | watcher.jsonl rotation + efficient tail read (R27) |

> **6.1:** expand a panel on a live stream; new events arrive across ≥3 polls; panel stays open.
> **6.2:** with symlinks intact, drift shows green/OK; wal_size + session_docs render real values.
> **6.3:** a decision text containing "/" renders in full in the detail tree; an `artifacts_written` path still renders as basename; no `/api/memory-content?` requests fired for session-less events.
> **6.4:** rotation triggers at the size cap (induce with a low cap), old segment archived, API serves seamlessly; API latency flat vs file size (tail read, not full parse).

## Block 7 — Repo↔runtime + test defense · R28-R33

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| 7 | 7.1 | v7.1 | [ ] | tick | Repo plist templates carry the live env (OPENCLAW_NATS, OPENCLAW_NODE_ID); redesign-tick plist paths fixed (R28) |
| 7 | 7.2 | v7.2 | [ ] | tick | Wiring-manifest rows for workspace-bin/memory-daemon.mjs (emit* producers, watcher init, inject-server deps) (R29) |
| 7 | 7.3 | v7.3 | [ ] | tick | Mesh/collab tests skip visibly (t.skip), never exit(0)-as-pass (R32) + fix the channels_hit fixture (R33) |
| 7 | 7.4 | v7.4 | [ ] | hybrid | Schema hardening: zod dep aligned to what's installed; byte caps (.max) on content-sample fields + producer-side per-item truncation (R30, R31) |

> **7.1:** rendering the repo template (install.sh path) reproduces the installed plist's semantics — diff shows no missing env; tick plist log paths point at `plans/redesign/tick-logs/`.
> **7.2:** comment out one `emitIngestEvent` call in a scratch copy → manifest test fails naming it; restored → green.
> **7.3:** suite output on this machine shows skipped > 0 with reasons; zero test files that `process.exit(0)` in before().
> **7.4:** `npm ls zod` consistent with package.json; a synthetic 10KB decision string → event truncated at the cap, publish succeeds against live NATS (no silent drop), watcher renders it.

## Block P — PARKED: security (operator directive 2026-06-02) · R34-R38

Deliberately deferred until a working prototype. Remarks documented in FINDINGS Cluster 8 and D7. Nothing here starts without an operator un-park decision logged in DECISIONS.md.

| Block | Step | Version | Status | Driver | Description |
|-------|------|---------|--------|--------|-------------|
| P | P.1 | — | [ ] | operator | (PARKED) Narrow memory-file API jail to vault/MEMORY.md/logs (R34 — note: ~1-line; recommended early) |
| P | P.2 | — | [ ] | operator | (PARKED) Revisit prompt-plaintext + vault-sync exposure before federation (R35, R36) |
| P | P.3 | — | [ ] | operator | (PARKED) Federation daemon: merge-or-delete per §4.6 + extraction-store db-option contract (R37) |
| P | P.4 | — | [ ] | operator | (PARKED) scope-check.sh tightening: glob depth, non-UTC expiry, heredoc note (R38) |

---

## Totals

| Block | Theme | Steps | Cumulative |
|-------|-------|-------|------------|
| 1 | stop data corruption | 6 | 6 |
| 2 | vault referential system (headline) | 6 | 12 |
| 3 | LLM infrastructure | 3 + deferred | 15+ |
| 4 | daemon lifecycle | 3 | 18+ |
| 5 | retrieval freshness | 4 | 22+ |
| 6 | watcher/UI | 4 | 26+ |
| 7 | repo↔runtime defense | 4 | 30+ |
| P | security (parked) | 4 | — |

**30 active steps (+3.4's deferred remediations, +4 parked).** Next step to execute: **1.1**.

Misc low findings ride along: R40 (idle-timer loop) attaches to 4.2; R41 (dead schemas wire-or-delete) decided at Block 7 open; R42 (extractJsonFromText fast path) attaches to 3.4.

## Work infrastructure

- This plan is a standard silo: per-plan SCOPE.md gates edits (one scope active at a time, repo-wide); canonical docs synced by `sync-canonical.sh`; viewer discovers it automatically under `memory-plan/plans/`.
- **Tick automation:** not built yet. When the operator wants the chain, clone the redesign pattern (`workspace-bin/redesign-tick.sh` + `TICK_PROMPT.md` + `com.openclaw.repair-tick.plist`, RunAtLoad=false, BLOCK-not-fake rules) — that's a `tick`/`hybrid`-driver enabler, one small scoped step. Blocks 1.6 and 3.1 stay operator-driven regardless.
- Per-step lifecycle: `WORKFLOW.md` (9 phases incl. micro/macro Re-Orient), copied from redesign at plan creation.
