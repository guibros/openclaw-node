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

## 2026-08-04 — CORRECTION: smoke #4 NOT green; "pre-screen COMPLETE" above is RETRACTED

Operator hold with three findings, all verified against the KV:
1. **I collected a non-terminal session.** smoke4-grappe read `phase: complete` but
   `status: active` with a blocked reviewer vote and unset timestamps (the null
   grappe_wall_ms). Collect now REQUIRES `session.status ∈ {completed, converged}` — a phase
   is not a status.
2. **The selector fell back to a revision again.** The finalization worker emitted its
   workArtifact WITHOUT the required completionDiff (sr1_step0 pair incomplete); my
   completionDiff-preference sort then silently picked sr1_step2 (revision). Collector now
   requires the full finalization pair at step0 of the highest sub-round — either member
   absent/degenerate FAILS collection, no fallback ever. Agent-side, worker multi-artifact
   rounds (step 2 + finalization) now require both artifact types or parse_error → directed
   retry.
3. **The blocked reviewer was right**: the selected candidate was ~1,792 words / 12.7 KB for a
   ~250-word task — scope violation. The session is not force-finished: aborted with reason,
   superseded by smoke #5.

What SURVIVES from smoke #4: the usage evidence (operator-accepted) — solo $0.257 and grappe
$3.193/12 calls end-to-end. What does NOT: the collected smoke4 pair (incorrect key, non-terminal
session) — quarantined as failed history.

Slate normalized per operator: uniform 500-700 words on all five; Task 2 restricted to an
8-12-command patch-ready quickstart with fresh-machine-success claims prohibited unless observed.
Circling suites 88/88 post-guard-change. **Smoke #5 (sequential, post-fix agents) must produce a
terminal completed session with a compliant finalization pair before the lock question reopens.**

## 2026-08-04 — Smoke #5: every harness contract HELD; session honestly non-terminal on a 2-1 vote

Sequential pair, post-fix agents. Solo: completed, 1 attempt. Grappe, in order of what it proved:
- **The multi-artifact guard corrected the worker mid-run**: SR1/S2 submission failed validation
  (parse_error → daemon directed retry) and the retried submission landed the complete
  revision pair (arts 8→10).
- **The finalization pair contract was MET**: sr1_step0 workArtifact 6,249 chars +
  completionDiff 1,320 chars + both reviewer sign-offs (14 artifacts total).
- **Usage accumulated end-to-end**: $3.63 / 13 calls in circling.usage_total.
- **The session ended honestly NON-TERMINAL**: finalization vote 2 converged / 1 BLOCKED
  (reviewerB). The blocked sign-off verified all 18 line citations then objected precisely:
  (1) the artifact omits the heartbeat cadence VALUE (60s at :56) — a spec-required element;
  (2) ~1,100 words against the ~250-word ask (4.5x) — scope violation. A legitimate,
  high-quality block. The strict collector refuses the session by design (status active).

**Pattern across smokes #2/#4/#5**: on tightly-scoped small tasks the grappe worker chronically
overshoots scope (12.7KB → 6.2KB) and reviewers rightly block — while the solo arm delivers
on-scope in one attempt at ~1/12 the cost. Smokes are throwaway and are NOT premise evidence;
but the smoke's ~250-word ask is also unrepresentative of the normalized 500-700-word slate.
Decision put to the operator: lock-and-run with a pre-declared non-collectable-grappe = pair-loss
rule, or one slate-representative smoke (#6, 500-700-word ask) first, or treat scope-overshoot
as a substrate issue to address (recorded as measurement-affecting if tuned). Awaiting the
operator's ruling; no further smoke or slate run started.

## 2026-08-04 — OPERATOR RULING: LOCK AND RUN (option 1). THE SLATE IS LOCKED.

Ruling verbatim intent: no smoke #6, no prompt tuning — "further sampling risks testing until
it passes." The symmetric forfeit rule is predeclared in `RUN_RULES.md` (same commit as this
entry): 60-min per-arm forfeit; unresolved gate = immediate forfeit, never approved mid-run;
both-fail = tie counting against the grappe; costs preserved on forfeits; rerun only on
demonstrated external infrastructure failure; **one frozen SHA for all ten executions — the
commit carrying this entry** — with no task, prompt, or code change after pair 1 begins.

Smoke #5's session aborted + archived with reason. Field verified at run start: `pairs-d14/`
empty; 3 bench agents (MESH_NO_MERGE=1, repo workspace) + mesh-task-daemon live on the frozen
code. The five locked tasks run sequentially from `slate/1..5-*.md`; every transition, forfeit,
and collection is appended to `run.log` beside the pair dirs; pairs await operator blind
scoring; `tally` renders the D3 verdict.

## 2026-08-04 — RUN COMPLETE (frozen SHA 6bc11f3, 10:27Z→19:45Z). TALLY: grappe 0 · solo 4 · tie 1

Zero delivered blind pairs — every pair resolved by the predeclared forfeit rules:

| Pair | Outcome | Cause | Infra layer |
|---|---|---|---|
| 1 nodeid | solo (grappe gate-forfeit) | finalization not unanimous — clause 2 | none — clean |
| 2 deploydoc | solo (grappe budget) | hollow session (0 artifacts at finalization, $1.21/3 calls) + host suspension 11:35→15:07Z | documented; protocol failure preceded freeze |
| 3 natsresolve | tie, counts against grappe | post-wake zombie solo call (~2 h through the 60-min spawn timeout) starved recruiting; session swept | strong — all failures trace to suspension #1 |
| 4 watcher | solo (grappe gate-forfeit) | finalization not unanimous — clause 2 | none — clean |
| 5 killproto | solo (grappe budget) | session healthy mid-circling (arts=8) frozen by suspension #2 (18:06→19:45Z; caffeinate stops idle sleep, not lid-close) | strong — progressing when frozen |

**Costs preserved (forfeit.json per pair; tally's meta.json summing shows $0 for forfeits —
cosmetic, noted):** solo Σ 2,359,097 in / 979 out / **$1.59**; grappe Σ 8,266,894 in /
36,553 out / **$11.22** across 39 calls. Cost ratio ≈ **7×** for zero completed deliverables.

**The rerun question is MOOT for the verdict:** even granting clause-5 reruns of pairs 2, 3,
and 5 AND the grappe winning all three, the best reachable score is grappe 3 · solo 2 —
below the D3 bar (≥4 of 5, ties against). Pairs 1 and 4 are clean, suspension-free failures:
the grappe's own reviewers refused to sign off (the same unresolved-finalization pattern as
smokes #4/#5, twice on documented quality grounds). Across 5 pairs + 3 smokes, the circling
grappe never once produced a unanimously-approved, on-scope artifact within budget.

**Mechanical verdict (per the locked rules + D3): PREMISE NOT EVIDENCED — plan-BLOCK.**
Disposition is the operator's (2.6 verdict + D3 block are plan-level): (a) accept the verdict
— 2.6 closes FAILED, federation blocks before 3.5 per D3; (b) order clause-5 reruns of 2/3/5
for understanding (cannot change the verdict); (c) treat the finalization-gate design (unanimity
+ scope discipline) as the falsified component and open a plan-level decision on whether a
revised protocol warrants a new benchmark iteration — that is a new D-entry and a new run, not
a patch to this one. Fleet stopped; nothing further runs pending the ruling.

## 2026-08-04 — OPERATOR REVIEW: RUN 1 IS **INCONCLUSIVE** (measurement failure). Verdict above RETRACTED.

Operator-held with six findings, all verified at the source and accepted:
1. **P0 — pair 4's forfeit violated the locked rule**: RUN_RULES requires two gate observations
   ≥90 s apart; the driver incremented a counter on consecutive 45 s polls — pair 4's
   observations sit 45.1 s apart (17:47:19.437 → 17:48:04.549). Pair 4 is INVALID. With pairs
   2/3/5 suspension-contaminated, only pair 1 is an uncontested loss — the "reruns are moot"
   arithmetic was FALSE and is retracted.
2. **P0 — the execution apparatus was not frozen**: the driver lived untested in /private/tmp,
   outside SHA 6bc11f3. Not reproducible.
3. **P1 — evidence package incomplete on GitHub**: pairs-d14/ + smoke archive untracked,
   run-d14.log git-ignored; the conclusion was pushed without its evidence.
4. **P1 — suspension-affected pairs (2/3/5) cannot be scored as ordinary losses**; pair 2's
   "already unrecoverable" was inference, not demonstration.
5. **P1 — tally does not reproduce forfeit costs** (reads meta.json only → $0.00/$0.00);
   pair 3's usages are honestly null (failed solo never wrote result.cost; aborted-at-init
   session never accumulated).
6. **P2 — status wording**: the plan carrier/step/BLOCKED.md were never changed (correct — the
   verdict was pending disposition), and "nothing running" overstated: the production
   mesh-task-daemon (launchd) was and is up; only the bench agents were stopped.

**Run 1 stands preserved as evidence of a strongly negative signal (pair 1 clean loss; pair 4's
reviewer objections were real even if its forfeit was invalid; 7× cost) — NOT as a verdict.**

**Apparatus repair executed (operator: "that is apparatus repair, not tuning until it passes"):**
committed driver `bin/fed-run-driver.mjs` with exported, unit-tested gate/gap logic
(`test/fed-run-driver.test.mjs`): gate forfeit only on observations ≥90 s apart per the frozen
rule; inter-poll gaps > 5 min are detected as HOST SUSPENSION and mark the pair INFRA_INVALID
(rerun-eligible, never a forfeit, no score); tally reads forfeit.json costs and lists
INFRA_INVALID pairs outside the scoring denominator. Run-1 artifacts archived under
`benchmark/run1-inconclusive-20260804/` and committed with this entry; `pairs-d14/` reset empty.

**RUN 2: the unchanged five-task slate reruns from the single frozen SHA = the commit carrying
this entry.** Same RUN_RULES, same slate files, task ids prefixed d14r2. No task, prompt, or
code change after pair 1 of run 2 begins.

## 2026-08-05 — RUN 2 COMPLETE (frozen SHA 2cc674f, 03:15Z→05:26Z): CLEAN RUN, VERDICT DETERMINED, 2 PAIRS AWAIT BLIND SCORING

Zero suspensions, zero infra-invalids, zero apparatus anomalies. Every outcome measured under
the repaired, tested driver:

| Pair | Outcome | Detail |
|---|---|---|
| 1 nodeid | solo (grappe gate-forfeit, RULE-COMPLIANT: 90.0 s across 3 observations) | finalization never converged |
| 2 deploydoc | solo (gate-forfeit, rule-compliant) | same |
| 3 natsresolve | solo (gate-forfeit, rule-compliant) | same — and its solo completed in 120 s, exonerating run-1's zombie as pure infra |
| 4 watcher | **DELIVERED** — session completed unanimously in 11.6 min; strict collect accepted | **first delivered blind pair of the whole benchmark** |
| 5 killproto | **DELIVERED** — session completed in 24.1 min; collected | second |

Costs (tally-reproduced): solo Σ 19.8 min / **$1.81** · grappe Σ 108.5 min / **$20.07** (~11×).
Delivered pairs: pair4 solo $0.26 vs grappe $2.95; pair5 solo $0.14 vs grappe $3.35.

**Verdict arithmetic (valid this time):** solo holds 3 rule-compliant wins; the grappe's maximum
is 2 of 5 — below the D3 bar (≥4) regardless of scoring. **PREMISE NOT EVIDENCED** is the
determined mechanical outcome. The blind scoring of pairs 4/5 remains REQUIRED by the
preregistered protocol and materially informs disposition: whether the grappe's work is better
*when it does deliver* decides if a protocol-redesign iteration (disposition c) has any case.
(Cosmetic: with 2 pairs unscored the tally prints "needs ≥ 4 of 3" — the bar is over the 5-pair
slate; the line normalizes once all pairs are scored. Left untouched pending scoring.)

**Operator scoring procedure (blind discipline):** for each of `pairs-d14/pair4-watcher/` and
`pairs-d14/pair5-killproto/`: read A.md and B.md ONLY, write `score.json`
`{"winner":"A"|"B"|"tie","notes":"..."}` — do NOT open key.json until BOTH pairs are scored.
Then `node bin/fed-benchmark.mjs tally` unblinds and renders the final record. Fleet stopped;
run log + sealed pairs committed with this entry.

## 2026-08-05 — SCORING-PACKAGE HOLD (operator, 5 findings) → repackage → blind rubric scoring → UNSEAL. **FINAL RECORD.**

The operator's audit found the scoring package unblind (in-dir meta leaked the arm mapping via
char counts) and the old sanitizer semantically destructive (it redacted worker/reviewer/
circling/finalization — the SUBJECT of Task 5); it also pre-identified a shared technical error
in both Task-5 candidates, mandated the five-dimension rubric, and required a PENDING-aware
tally. All executed without any model rerun:
- content-preserving blinding (identity markers only; domain vocabulary intact) + regression
  tests (7/7 with driver tests);
- both pairs REPACKAGED from immutable raw KV artifacts, fresh coin flips, scorer dirs = A/B
  only, key/meta/hashes sealed outside the scorer path, sha256 of raw + packaged;
- tally: sealed-key lookup, rubric validation (rejects winner-only scores), PENDING status with
  no verdict while delivered pairs are unscored;
- scoring by TWO fresh independent subagents with zero benchmark context, citation-verification
  mandated. The pair-5 scorer INDEPENDENTLY rediscovered the operator's finding #3 (both
  candidates attribute the MESH_NODE_HEALTH heartbeat to the killed agent; it is written by
  mesh-health-publisher — both proposed watcher-transition chains are false), unprimed:
  convergent validation of both the finding and the scorer's independence.

**Unsealed results:** pair4 A=grappe **wins 21-18** (flawless verified citations, paste-ready
corrections; penalized for scope overrun + execution commentary). pair5 B=grappe **wins 20-15**
(circling-side mechanics near line-for-line correct; both arms failed the health-heartbeat crux).

**FINAL OFFICIAL TALLY: solo 3 (all by rule-compliant gate-forfeit) · grappe 2 (both on blind
quality) · tie 0. VERDICT: below the ≥4-of-5 bar — PREMISE NOT EVIDENCED; D3 plan-BLOCK if the
operator rules it final.**

**The result's real shape:** the grappe failed RELIABILITY (3 of 5 pairs never delivered — its
own finalization gate; the chronic pattern across 8 sessions) but won QUALITY both times it
delivered, under blind five-dimension scoring, at ~11× cost ($20.07 vs $1.81). The premise as
contracted (deliver better artifacts, reliably, within budget) is not evidenced; the narrower
claim "circling produces higher-quality artifacts WHEN it converges" got its first two data
points in favor. That is precisely the evidence disposition (c) — a redesigned-finalization
iteration under a new preregistration — would build on. Disposition remains the operator's.
