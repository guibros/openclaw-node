# RERUN_LOG — D14 five-task rerun (step 2.6, reopened 2026-08-02)

Append-only log of the rerun's pre-screen and pair executions. The July 15 qualified hand-run
remains recorded in AUDIT_POST.md; nothing here overwrites it.

## 2026-08-03 — Smoke #1: FAILED (worker-readiness pre-screen did its job)

Throwaway task (`smoke-throwaway-20260803`, never a slate task) through the OLD driver
(`grappe-benchmark.mjs`) with 3 fresh claude-provider agents (`bench-w1/2/3`). Operator review
caught four defects; the run is recorded FAILED and its artifacts are void:

1. **Isolation silently lost.** Agents launched with the plist's `MESH_WORKSPACE`
   (`~/.openclaw/workspace` — not a git repo); every `git worktree add` failed and all four task
   executions fell back to the shared stale runtime tree (mesh-agent.js worktree fallback).
   The grappe "completed" mechanically but its artifact discussed an unrelated old review pulled
   from the contaminated tree — and both reviewers approved it.
2. **Prose metric poisoned the solo arm.** `task.metric` is executed as a shell verification;
   the prose rubric string hit the security filter, was replaced with an unrunnable placeholder,
   and the solo task burned retries on an invariant failure. (fed-benchmark.mjs had already
   documented this exact bug from July — the old driver still had it.)
3. **Cost record incomplete.** Char counts only; no per-arm wall-clock or token accounting.
4. **Reuse hazard.** July's tracked `benchmark/pairs/` + `handrun/` were inside the driver's
   read/write surface — stale artifacts could silently substitute for fresh D14 runs.

## 2026-08-03 — Fixes applied (scope `26-rerun`)

- **Fail-closed isolation** (bin/mesh-agent.js): both worktree call sites now fail the task /
  withdraw the collab member via `mesh.tasks.fail` instead of running in the shared tree.
- **Old driver retired** (bin/grappe-benchmark.mjs): refuses to run, exit 2, points at
  fed-benchmark.
- **fed-benchmark.mjs**: fresh pairs isolated under `benchmark/pairs-d14/` (write-once, no
  overwrite; July dirs never read by collect/tally); `meta.json` gains a cost record — per-arm
  wall-clock from KV/session timestamps, attempts, artifact counts, and `tokens: null` with an
  honest note (claude CLI text-mode emits no usage; json-mode capture queued, not faked);
  `tally` prints per-arm wall-clock sums.
- **Poisoned task cancelled** in MESH_TASKS KV (was `released`, 1 attempt burned).
- **Workers relaunched** with `MESH_WORKSPACE=/Users/moltymac/openclaw-nodedev` (a real git
  repo — worktree isolation can actually engage).
- docs/PREMISE_BENCHMARK.md updated to the fed-benchmark protocol.

## 2026-08-03 — Smoke #2: GREEN (pre-screen passes)

`smoke2-d14-solo` + `smoke2-d14-grappe` via fed-benchmark (safe metric). Task: document the
mesh-agent startup contract grounded in bin/mesh-agent.js with line numbers.

**Observed:**
- **Isolation held on all 4 executions** (3 grappe members + solo, each in a fresh worktree off
  the repo; zero fallback warnings; worktrees auto-cleaned post-run). One operational finding:
  with exactly 3 agents the 3-member grappe starved the solo arm back to `queued` — a 4th agent
  (`bench-w4`) unblocked it. Slate runs keep 4 agents up.
- **Both artifacts RELEVANT and accurate** (the smoke #1 failure mode): both cover the five
  contracted topics; spot-checked citations (POLL_INTERVAL :54, HEARTBEAT :56, WORKTREE_BASE
  :483, branch :495, fail-closed block :1482-1491) all correct against the live file. Nuance
  recorded: artifacts describe the *current working tree* (including today's uncommitted
  fail-closed edits) — workers read the repo via `--add-dir` while writes stay worktree-contained.
  Read access is shared but symmetric across arms; acceptable for text-artifact tasks.
- **Solo completed in 1 attempt** — no metric retry loop (safe metric works).
- **Cost record captured** (meta.json): solo 65.9 s wall / 1 attempt / 881 chars vs grappe
  45.3 min wall / 11 artifacts / 2,249 chars — a ~41× wall-clock gap on this trivial task.
  Tokens honestly null (text-mode CLI), json-mode capture queued.
- **No-reuse verified**: pair written once under pairs-d14/, then quarantined to
  `benchmark/smoke-verified-20260803/` so the slate tally reads exactly the five slate pairs.

**Minor defects for the slate texts:** one candidate leaked metric output ("`node --version`
exits 0… Verification passed") into its artifact head — an arm-tell and noise. Every slate task
text gains the line: "The artifact must be the document alone — no verification preamble or
execution commentary." (Folded into the texts presented for operator lock.)

## 2026-08-03 — Operator HOLD on smoke #2; six findings; fixes applied

The operator reviewer HELD the gate over smoke #2: the green verdict had papered over real
defects. Findings → fixes (all landed this batch, suites 78/78, syntax-clean):

1. **Collector selected the largest INITIAL artifact, not the final integrated one.** True — and
   deeper: the actual final (`sr1_step2_worker_workArtifact`) was an **89-char preamble stub**
   ("Now I have everything I need. Let me produce…") — the worker narrated and wrote files
   agentically instead of answering with the document. Fixed both sides: fed-benchmark now
   selects highest-subround/step worker workArtifact and **fails collection** below 400 chars
   (VERIFIED live: re-collecting the recorded smoke2 session now throws the degenerate error);
   mesh-agent treats a sub-floor workArtifact as a parse failure, riding the daemon's existing
   directed-retry machinery (3 attempts).
2. **Token cost null.** The solo path already extracted real cost from the agent's session JSONL
   (`result.cost` — the "data already produced" the reviewer meant); collect now reads it. The
   grappe path gains the same mechanism: each reflection carries its round-attempt usage; the
   daemon accumulates `circling.usage_total` (counted before retry early-returns so retried
   spend is real); collect/tally read and sum it. Latent bug fixed on the way: agents shared one
   work dir, so concurrent members could misattribute each other's session files — per-agent
   work dirs now.
3. **Dirty-parent read.** runLLM no longer passes WORKSPACE as an extra `--add-dir` when a
   worktree exists — isolated tasks see only their worktree (HEAD state, reproducible).
4. **Worktree merges into main.** `MESH_NO_MERGE=1` short-circuits commitAndMergeWorktree;
   all bench agents run with it. (Smoke #2 verified non-polluting after the fact: zero mesh/*
   branches, zero merge commits — but the path existed.)
5. **Four-agent concurrency violated the sequential contract.** Adopted: THREE agents; arms run
   sequentially per pair (solo → grappe); the earlier "keep 4 up" note is retracted.
6. **Task 4/5 contract issues** — prior findings requested from the operator (not in this
   session's context); texts held un-locked.

Daemon restarted on the new code (kickstart); bench-w1/2/3 relaunched with new agent code +
MESH_NO_MERGE=1 + repo workspace. Smoke #2 remains recorded as a plumbing pass whose grappe
artifact was an unintegrated first draft — a THIRD smoke (sequential, post-fix) must produce a
non-degenerate final integrated artifact with real usage totals before any slate pair runs.

## 2026-08-03/04 — Smoke #3: integrated final PROVEN; guard fired and degraded honestly

Sequential run (solo → grappe, 3 agents). Results:
- **Solo**: completed, 1 attempt, 82.8 s, 2,496-char on-topic artifact. `result.cost` still null
  → root-caused DEEPER than the collector: `getSessionInfo` (lib/agent-activity.js) read legacy
  flat JSONL shapes (`line.usage`/`line.costUSD`); real sessions nest under `message.usage` —
  every task in the system's history reported cost:null. Fixed (nested reads + cache-aware
  pricing: reads 0.1×, creation 1.25× — cache-dominated agentic sessions were ~10× overstated),
  17/17 tests, and OBSERVED on the actual smoke3 solo session file: 347,910 in / 332 out /
  $0.214 where the old code returned null. Commit 7670bc6.
- **Grappe**: 18.6 min, 12 artifacts. **The degenerate guard fired 3× at SR1/S2** (worker kept
  narrating instead of producing the revision) — the daemon's directed retry re-prompted 3×,
  then degraded per protocol, storing NOTHING for that step (honest absence, not a stub).
  The finalization round then produced the real deliverable: a **3,003-char integrated
  workArtifact + 806-char completionDiff + both reviewer sign-offs**. Collect succeeded on
  exactly that artifact. Selector precision fix landed: finalization keys at step0 of the last
  sub-round with a completionDiff sibling — the selector now prefers that signature over a
  revision-step artifact.
- Both arms' usage null as expected (pre-extractor-fix agents); agents relaunched on the fixed
  extractor; **smoke #4** (solo, then grappe if needed) proves end-to-end usage totals in KV.

## Slate finalized (awaiting operator LOCK)

Canonical submit-ready texts in `slate/1..5-*.md` (this dir). Tasks 4/5 replaced with the
operator reviewer's corrected wording (2026-08-03): Task 4 audits node-watch against
NODE_WATCH_SPEC (acceptance probes only where delegated; gaps not presupposed); Task 5 requires
a registered, heartbeat-producing member kill with fed.* transition observation and NO assumed
session survival. Shared constraint on all five: read-only worktree-only analysis, document-alone
artifact, no execution commentary. July slate items collab-mode-gap / fed-probe-spec remain
OBSOLETE. No slate pair runs before the operator locks the five files and smoke #4 shows
end-to-end usage.

## 2026-08-04 — Smoke #4: BOTH lock conditions proven; pre-screen COMPLETE

Sequential full pair on fixed-extractor agents. The collected `meta.json` carries, for the
first time, the complete cost record end-to-end:
- **solo**: 63.8 s wall · 1 attempt · 2,318 chars · **463,492 in / 419 out / $0.257**
  (result.cost through agent→KV→collect).
- **grappe**: 13 artifacts · 12,678-char integrated final (`sr1_step2` — the worker complied
  this run; 5.5× solo's length) · **4,117,341 in / 3,286 out / $3.19 across 12 calls**
  (reflect→daemon accumulator→session KV→collect; observed accumulating live mid-session at
  round 1: $0.585/3 calls). One residual collector nit: grappe_wall_ms read null at collect
  time (session timestamp field timing) — wall-clock recoverable from the monitor timeline
  (~25 min); non-blocking, noted.
- **The D14 cost datum**: grappe = **12.4× solo cost** ($3.19 vs $0.257) on an identical
  trivial task. This is the asymmetry the premise verdict must justify with quality.
- Both smoke pairs quarantined to `benchmark/smoke-verified-20260803/`; `pairs-d14/` is EMPTY,
  reserved for exactly the five slate pairs.

**Pre-screen status: COMPLETE.** Worker readiness real (D11 claude workers, isolation
fail-closed, no-merge, sequential 3-agent contract); harness integrity real (safe metric,
finalization-aware fail-closed collector, write-once pairs, no July reuse); cost record real
(both arms, mechanically captured). The ONLY remaining gate is the operator's LOCK of
`slate/1..5-*.md` — then five sequential pairs run, blind-score, tally.
