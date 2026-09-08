# Automated Stepped Workplan Framework

**Purpose.** A portable, project-agnostic procedural framework for executing a long, multi-step workplan autonomously (e.g. by a scheduled agent task, a CI worker, or a disciplined human) while keeping every step audited, reversible, and bisect-friendly.

**Scope.** Use this whenever you have a workplan of more than ~10 steps that will be executed over hours or days, where each step is a discrete change that could silently break something downstream and where the same agent / worker may not own every step.

**Origin.** Distilled from a production workflow that has successfully closed 35+ steps with zero deep-review failures. Stripped of project-specific details (language, test runner, version-control system, deployment target) so it can be re-skinned for any domain — code migrations, content production pipelines, data backfills, model retraining sweeps, infrastructure migrations, etc.

**Binding note (this repo, 2026-07-04).** This is the portable THEORY doc. Where it and
`PROTOCOL.md` (the silo-resolved binding) disagree, **PROTOCOL.md governs**:
- The Deep Review Gate here is 5 checks; the binding runs **6** (⑥ runtime evidence captured
  and real — MASTER_PLAN §5).
- `{VERSION_LOG_FILE}` and `{RESUME_FILE}` are placeholder ledgers for non-git contexts. In
  this repo they are deliberately **not instantiated** (protocol DECISIONS D2): one commit
  per step makes `git log` the version ledger, and `VERSION` + `SCOPE.md` close notes +
  `AUDIT_POST §6` carry the resume state.
- The INVENTORY status vocabulary here is `[ ]/[A]/[x]`; the binding adds **`[D]` deferred**
  (deliberately postponed — never a next step, never blocks plan completion).

---

## 0. The model in one paragraph

Decompose the workplan into atomic **steps** grouped into **blocks** (milestones). Every step runs through nine phases in strict order. Each step starts at version `vX.(Y-1)` (the prior step, closed), passes through two in-flight markers (`vX.Y-pre` and `vX.Y-mid`), and ends at `vX.Y` (clean, shippable). Each step produces two audit documents (a planning doc at Phase 1, a review doc at Phase 7). A 5-check **Deep Review Gate** runs between Phase 8 and Phase 9 to make "ship a half-implemented step" structurally impossible. **Exactly one commit lands per step, at Phase 9 close** — never per-phase, never mid-step. Commits are step-atomic so that the version-control log doubles as the step ledger. State lives entirely in the ledgers and version carriers; no cross-worker memory is required.

---

## 1. What you customize (placeholders)

The framework uses generic terms below. Before applying it, replace these placeholders with your project's concrete artifacts.

| Placeholder | What it means | Example concretions |
|---|---|---|
| `{ARTIFACT_KIND}` | The unit your steps produce | source code, blog posts, model checkpoints, database migrations, design files, dataset rows |
| `{VERSION_CARRIERS}` | The file(s) holding the canonical version string | a `VERSION` file; `package.json` + a `__version__.py`; a `CHANGELOG.md` header; a constant in shipped code |
| `{TEST_COMMAND}` | The automated check that gates Phase 5 | `pytest`, `npm test`, `cargo test`, a linter pass, a schema validator, a manual review checklist with a green/red verdict |
| `{INVENTORY_FILE}` | The master list of steps with status column | `STEPS_INVENTORY.md`, a Notion table, a GitHub Project board, a Linear cycle |
| `{VERSION_LOG_FILE}` | The per-bump ledger | `VERSION_LOG.md`, a changelog, an append-only Airtable |
| `{RESUME_FILE}` | The current-state snapshot for cold pickup | `RESUME.md`, a `STATUS.md`, a pinned Slack thread |
| `{AUDIT_DIR}` | Where per-step audit docs live | `audits/`, `decisions/`, `adr/` |
| `{BLOCK_FILE}` | The stop-the-world signal | `CONTINUATION_BLOCKED.md`, a paused-pipeline flag, an open Jira ticket of a specific label |
| `{COMMIT_VERB}` | How a step "ships" | `git commit`; a CMS publish action; a database transaction commit; a model registry push |
| `{COMMIT_LOG}` | Where shipped steps land in chronological order | `git log`, a CMS publish history, a registry's version index |
| `{WORK_TICK}` | One autonomous execution window | a 45-minute scheduled cron tick; a CI job; a single human work session |

The mechanics below assume git as the version-control system because it's the most common case, but every git-specific verb translates to its equivalent in your stack.

---

## 2. The three ledger files (required minimum)

The framework requires exactly three persistent state files. Anything beyond this is optional decoration.

### 2.1 Inventory — `{INVENTORY_FILE}`

The master list of all steps in the workplan, with a status column. Each row is one step.

```markdown
| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| A | 1  | v1.1  | [x] | <short description> |
| A | 2  | v1.2  | [A] | <short description> |
| A | 3  | v1.3  | [ ] | <short description> |
```

Status legend: `[ ]` queued · `[A]` in-flight · `[x]` closed. (Use any 3-symbol scheme; the symbols just need to be unambiguous and greppable.)

The inventory is the single source of truth for "where in the plan are we?" Every `{WORK_TICK}` reads it first to find the next `[A]` or `[ ]` row.

### 2.2 Version log — `{VERSION_LOG_FILE}`

A chronological per-bump ledger. One row per version bump (every step produces 3 bumps: pre, mid, final). Records: version string, date, phase, step number, files touched (with action + why), cross-doc updates this bump touched.

This is the bookkeeping layer that catches the silent failure mode "a file was changed but no doc records why." Six months from now, "what was different about `v1.7`?" is one search away.

### 2.3 Resume doc — `{RESUME_FILE}`

A current-state snapshot designed for cold pickup. A fresh worker (human or agent) reading only this file should be able to resume the workplan with no prior conversational context. It contains:

- A `§0` frozen-decisions section (block-level constraints that apply to every step in the current block).
- A `§N` per-step close-paragraph section (one paragraph per closed step, with the carry-forwards to the next step).
- A `§N+1` progress tracker (running counts of closed steps, current streaks, pytest baseline).

This file is updated at every Phase 9 close. It is the entry point for any new worker.

---

## 3. The two sub-version markers + the clean version

Every step uses three version strings, written into the `{VERSION_CARRIERS}` as the step progresses:

| String | Meaning | When written |
|---|---|---|
| `vX.Y-pre` | Step planning done (audit-pre written), implementation not started | Phase 1 |
| `vX.Y-mid` | V1 implementation done, V2 audit not started | End of Phase 4 |
| `vX.Y` (clean, no suffix) | V2 audit passed, Deep Review Gate passed, shippable | Phase 9a |

The sub-versions serve **bisect granularity**: if a regression surfaces months later, the bisect narrows to "this bug was already present at `vX.Y-mid` so it's a Phase 4 design issue, not a Phase 8 patch issue." Without sub-versions, every regression bisects to a full step.

If you have multiple `{VERSION_CARRIERS}` (e.g. a Python `__version__` and a JavaScript `package.json`), they must be bumped in lockstep — Deep Review Gate check 1 enforces this.

---

## 4. The 9 phases — what each one does

The cycle is rigid: no phase may be skipped, no two phases may be merged. The discipline IS the value.

### Phase 1 — Version(pre) + AUDIT_PRE

Bump `{VERSION_CARRIERS}` from `vX.(Y-1)` (the prior clean version) to `vX.Y-pre`. Create the audit folder `{AUDIT_DIR}/stepNN_<slug>/` and write `AUDIT_PRE.md` with six canonical sections:

- **§1 — Step intent.** What this step accomplishes, in 2-3 sentences. Why it exists.
- **§2 — Inventory excerpt.** Copy of the step's row from `{INVENTORY_FILE}`. Cross-link.
- **§3 — Design decisions.** The frozen choices for this step. CONSUME the prior step's `AUDIT_POST §6` carry-forwards verbatim here. Do not re-litigate.
- **§4 — Risk register.** Each risk as: trigger code path / symptom / cost / detection mechanism / mitigation. Hand-waving "this might break" is not a risk — drop it or sharpen it.
- **§5 — Deferrals.** Things this step explicitly does NOT do, with the future-step pointer where they'll be done.
- **§6 — Phase 4 implementation outline.** The concrete file deltas this step will produce. Format as a bullet list of `Edit X — <file path> — <one-line description>`. Each bullet becomes a row in `AUDIT_POST §1`.

No production work yet. No commit yet.

### Phases 2-3 — Recon (subsumed into Phase 1)

In the V8 origin of this framework, these were separate phases for "read every file" and "produce the planning doc." In the V10 evolution they're collapsed: the act of writing `AUDIT_PRE.md` IS the recon. The audit's depth is the recon's evidence. If `§4` and `§6` look thin, the recon was thin.

### Phase 4 — V1 implementation

Translate every `AUDIT_PRE §6` bullet into actual production work. No scope creep — if a new requirement surfaces mid-implementation, append it to `AUDIT_PRE` under a `## Mid-Implementation Findings` heading rather than silently expanding the step. Track the discipline: zero mid-implementation findings is the streak metric.

After all production edits land, **bump `{VERSION_CARRIERS}` from `vX.Y-pre` to `vX.Y-mid`** to mark V1 code-complete.

No commit yet.

### Phase 5 — Verify (test + grep)

Two checks, in order, both required to pass:

1. **Test gate.** Run `{TEST_COMMAND}`. Expected pass count is the most recent value in `{VERSION_LOG_FILE}` plus any additions promised by the step's plan. Any failure → STOP and write `{BLOCK_FILE}`. Do not "fix forward." A test failure is treated as a Phase 4 design problem requiring human input, not a hiccup to patch over.

2. **Grep verification.** For each `AUDIT_PRE §6` bullet, run the grep/search command that would prove the change is present in the working tree. Save the exact commands and first hits — they'll be reused in `AUDIT_POST §2` and Deep Review Gate check 2.

No commit yet.

### Phase 6 — V2 recon (subsumed into Phase 7)

Implicit in Phase 7 — the V2 audit's act of reading the diff IS the V2 recon.

### Phase 7 — AUDIT_POST (the deep review IS this doc)

Create `{AUDIT_DIR}/stepNN_<slug>/AUDIT_POST.md` with six canonical sections:

- **§1 — Files-changed-vs-AUDIT_PRE-§6 ledger.** A table with one row per `AUDIT_PRE §6` bullet. Columns: `promised delta` | `actual file:line touched` | `landed? (yes/no/partial)` | `grep evidence`. Every row's `landed?` must be `yes` or the step is structurally incomplete and must be either finished or rolled back BEFORE Phase 7 closes.

- **§2 — Greppable-deltas-confirmed.** For each `AUDIT_PRE §6` bullet, the exact search command + first hit line. Proves the change is in the working tree, not just claimed in the doc.

- **§3 — Cross-references-still-valid.** For any renamed symbol, deleted file path, or moved doc, search the whole codebase and confirm zero stale references. Catches "I renamed it but forgot the 3 places that imported it."

- **§4 — Findings.** Bulleted list, each prefixed `[POSITIVE]` or `[NEGATIVE]`. Prefer all POSITIVE (continue the streak). Every NEGATIVE finding must appear in §5 as a concrete patch.

- **§5 — Phase 8 patches.** Bulleted list of corrections. Almost always "none." If non-empty, each item must have (a) the trigger finding from §4, (b) the exact patch as `file:line` + minimal diff, (c) a one-sentence justification.

- **§6 — Carry-forwards to Step (N+1).** Bulleted list of decisions / state / follow-ups that the next step's `AUDIT_PRE §3` will consume verbatim.

§1-§3 together ARE the deep review. They prove the work matches what was promised and that nothing outside the scope broke. §4-§5 are the verdict. §6 chains forward to the next step.

No commit yet.

### Phase 8 — V2 corrections

Apply patches identified in `AUDIT_POST §5`. In a healthy workflow this is almost always a NO-OP — the streak metric is "consecutive steps with zero Phase 8 patches." If §5 lists a patch that requires choosing between architectural options not pre-decided in carry-forwards or block-level frozen decisions, STOP + write `{BLOCK_FILE}`. An autonomous tick cannot make architectural choices.

No commit yet.

### Phase 8.5 — DEEP REVIEW GATE (5 checks, before any Phase 9 work)

The single most important invariant in the framework. All five checks must pass before Phase 9a runs. Any FAIL → write `{BLOCK_FILE}` with the failed-check ID and STOP. The five together enforce: lockstep versions (1), code-matches-plan (2), patches-actually-applied (3), no-scope-creep (4), counts-reconcile (5).

```
CHECK 1 — Version carriers in lockstep
   Read all {VERSION_CARRIERS}. All must show identical vX.Y-mid string.
   Drift between carriers → BLOCK.

CHECK 2 — Every AUDIT_PRE §6 delta is greppable
   Re-run every search command listed in AUDIT_POST §2. All must
   return ≥1 hit. Any empty search → BLOCK (the spec promised
   a change that isn't there).

CHECK 3 — Every AUDIT_POST §5 "applied" patch is visible in the diff
   List the files staged for commit. For each §5 patch entry: confirm
   its file:line appears in the staged diff. If §5 said "none" → diff
   must contain only AUDIT_PRE §6 deltas + Phase 9 ledger files.
   Extras → BLOCK.

CHECK 4 — No phantom changes in the diff
   Cross-check the staged file list against the UNION of:
     - AUDIT_PRE §6 file list
     - AUDIT_POST §5 file list
     - The two audit docs themselves
     - Phase 9 ledger files: {VERSION_LOG_FILE}, {INVENTORY_FILE},
       {RESUME_FILE}, {VERSION_CARRIERS}, header block in shipped artifact
   Any file outside that union → BLOCK (root cause unknown).

CHECK 5 — Row count reconciles with file count
   Count AUDIT_POST §1 rows where landed = yes. That count must equal
   the number of non-audit non-ledger files in the staged diff.
   Mismatch → BLOCK.
```

Together these make it structurally impossible to ship a half-implemented step. The gate is the central quality enforcement mechanism — everything else is bookkeeping that feeds it.

### Phase 9 — Final close (the only phase that touches `{COMMIT_VERB}`)

Mechanical ledger-versioning in seven sub-steps, in order:

**9a — Bump `{VERSION_CARRIERS}` from `vX.Y-mid` to `vX.Y`** (clean, no suffix). Third and last version write of the step.

**9b — Insert a `vX.Y` header block** in the canonical "ledger inside the artifact" location (e.g. a comment block at the top of the main shipped file, a row in a CHANGELOG, an entry in a release-notes table). Mirror the format of the previous step's block.

**9c — Append a `vX.Y` final entry** to `{VERSION_LOG_FILE}`. Records date, phase, step number, files touched (with action + line range + why + how), and which other docs were updated this bump.

**9d — Flip the step row in `{INVENTORY_FILE}`** from `[A]` to `[x]` with a full close annotation. The close annotation should be a dense one-paragraph summary: what landed, V2 findings count, streak update, test deltas. This annotation is the "tweet-length" record of the step.

**9e — Update any cross-cutting tracker docs** (release checklists, migration trackers, dependency graphs) if applicable to this step. Many steps will skip this; that's fine.

**9f — Update `{RESUME_FILE}`** — change the heading from "Step NN in-flight" to "Step NN closed"; replace the in-flight paragraph with the closed-state paragraph; add the Step (N+1) carry-forward bullet list (mirror of `AUDIT_POST §6`); bump the progress tracker.

**9g — Commit.** This is where the entire step lands in `{COMMIT_LOG}`. Stage everything (`git add -A` or equivalent) and commit with the structured message format from §6 below.

After the commit, the step is closed. Pre-flight of the next `{WORK_TICK}` will see a clean working state at `vX.Y` and start Step (N+1) at Phase 1.

---

## 5. Per-step commit discipline — the six rules

This is the part most often misunderstood, so it gets its own section.

### Rule 1 — Exactly one commit per step

Every step produces exactly one entry in `{COMMIT_LOG}`. Not one per phase. Not one per sub-version. Not one per file. One per step, at Phase 9 close only. This makes the commit log a faithful step-by-step history — every line is one closed, audited, gated step.

### Rule 2 — The commit covers everything the step touched

The Phase 9 commit stages:

- The production artifact changes (the actual `{ARTIFACT_KIND}` updates)
- Any tests, fixtures, schemas added
- `AUDIT_PRE.md` and `AUDIT_POST.md`
- The `{VERSION_CARRIERS}` (now at the clean `vX.Y` string)
- The new header block in the shipped artifact
- `{VERSION_LOG_FILE}` (one new entry above the "NEXT VERSIONS" header)
- `{INVENTORY_FILE}` (one row flipped `[A]` → `[x]`)
- `{RESUME_FILE}` (status + carry-forwards updated)
- Any cross-cutting tracker docs touched in Phase 9e

Deep Review Gate check 4 enforces that nothing OUTSIDE this expected union appears in the staged diff. Phantom files → BLOCK.

### Rule 3 — Commit message format is structural, not free-form

```
vX.Y — <one-line step description from inventory>

Phase 4: <one-sentence summary of artifact deltas>.
V2 audit: <N> POSITIVE findings, <M> Phase 8 patches.
Streak: <S>-of-<S> zero-Phase-4-correction (block cumulative).

Authored-By: <agent / human identifier>
```

Subject line mirrors the inventory row's description verbatim so that searching the commit log by step lands the right entry instantly. Body records the three numbers that matter for trend tracking: what changed, how many V2 findings, whether the streak survived. The author trailer records who/what shipped the close.

### Rule 4 — No mid-step commits, no amends, no force-pushes

- **No mid-step commits.** If a `{WORK_TICK}` can't complete a step in its budget, it stops at whatever sub-version it reached (`-pre` or `-mid`) and leaves the working state dirty. The next tick reads the version carriers + audit docs to figure out where to pick up. State lives in the ledgers and version carriers, not in commit history.
- **No amends.** Rewriting a closed step's commit is forbidden. If a step's commit is wrong, the fix lands as a new commit on a new step (typically a "hygiene" step with its own audit pair).
- **No force-pushes.** Auto-tick workers never push to a remote — only the human operator decides when to publish.
- **No global config edits** that would change how commits or version control behave.

### Rule 5 — Mandatory workarounds happen BEFORE every write op

Sandbox / FUSE / CI environments often have transient issues that block writes silently (stale lock files, permission glitches, race conditions). Identify your environment's specific failure mode and codify the workaround as a one-liner that runs before every write op:

```
# Example — FUSE mount stale lock file
mv .git/index.lock .git/index.lock.stale.$(date +%s) 2>/dev/null || true
git add -A
```

Read-only ops don't need this. Don't try to be clever — always run the workaround, even when you don't think you need it. The cost is one millisecond; the benefit is "this tick never gets stuck on a known-benign edge case."

### Rule 6 — Commit only after the Deep Review Gate passes

Phase 9 sub-step 9g (`commit`) cannot run until the Deep Review Gate's five checks have all passed. If a tick lands at Phase 9a-9f and discovers a Gate failure (e.g. check 4 phantom file), it writes `{BLOCK_FILE}` and STOPS — even if all the ledger updates are already on disk. The commit is the LAST atomic act of the step, after every check has passed.

---

## 6. Carry-forwards — how Step N talks to Step N+1

Closing a step is not just shipping the work — it's also passing decisions and open questions to the next step. Carry-forwards live in two places:

1. **`AUDIT_POST §6`** of the closing step — the structured list of (a) decisions made during the step that the next step must consume, (b) deferred follow-ups, (c) numbered open questions to resolve at the next step's Phase 1.

2. **`{RESUME_FILE}` per-step close paragraph** — a narrative mirror of `AUDIT_POST §6`, formatted as a bullet list under the heading "Step (N+1) carry-forwards."

When Phase 1 of the next step runs, it reads `{RESUME_FILE}` first to pick up these carry-forwards, then merges them into the new `AUDIT_PRE §3 design-decisions` section. This makes the inter-step state transition explicit and auditable.

Block-level frozen decisions (the `§0` of `{RESUME_FILE}`) apply to ALL steps in the current block and never need to be re-listed in per-step carry-forwards. They are the immutable block-level constraints.

---

## 7. Block triggers — when to STOP and write `{BLOCK_FILE}`

A tick must stop and write `{BLOCK_FILE}` (and make NO commit) when any of these happen:

- The test gate goes red, errors, or times out
- `AUDIT_PRE` risk register flags a HIGH-severity risk that wasn't pre-resolved
- A decision is needed that isn't covered by block-level frozen decisions, prior carry-forwards, or the workplan protocol
- `{VERSION_CARRIERS}` drift
- Working state has uncommitted human changes at pre-flight
- Environment errors that the documented workaround can't fix
- The edit/write tool fails persistently on a specific file
- A Phase 9 ledger update fails (file unexpectedly missing or wrong format)
- `{COMMIT_VERB}` fails after the documented workaround
- Any of the five Deep Review Gate checks fail (1 = version drift, 2 = ungreppable delta, 3 = missing patch, 4 = phantom file, 5 = row/file count mismatch)

The `{BLOCK_FILE}` template:

```markdown
# CONTINUATION_BLOCKED — <YYYY-MM-DD HH:MM>

**Step**: <NN> (`vX.Y-<phase>`)
**Phase you were in**: <name>
**Trigger**: <one-line cause>

## What failed
<2-5 lines of detail>

## What's needed from the user
- <bullet>

## How to resume
1. <action>
2. Delete `{BLOCK_FILE}`
3. The next scheduled tick will pick up where this stopped.

## State at block
- Version carrier 1: `<value>`
- Version carrier 2: `<value>`
- Working state: <clean / dirty>
- Last successful commit: `<hash>` `<title>`
```

Pre-flight check #1 of every tick reads `{BLOCK_FILE}`. If it exists, the tick exits immediately without writing a new block file. The operator clears the block by deleting the file after addressing the cause; the next tick (next scheduled run) picks up cleanly.

This is the critical safety valve: an autonomous worker that can't make a decision must STOP and ask, not guess. The block file is the asynchronous "ask."

---

## 8. Block-close ceremony (end of each milestone group)

When the last step of a block closes, the closing tick additionally:

1. Writes `BLOCK_<X>_COMPLETE.md` in `{AUDIT_DIR}/`, mirroring the previous block's completion doc structure. Documents the block's exit-gate criteria with evidence, files-touched summary, and carry-forwards into the next block.
2. Writes (or updates) a top-level milestone sentinel doc (e.g. `BLOCK_<X>_COMPLETE.md` at the repo root) that's discoverable without traversing `{AUDIT_DIR}/`.
3. Updates the `{RESUME_FILE}` top heading to "Block X closed; Block Y awaits" and pins the carry-forwards into Block Y at `§0`.
4. The Phase 9 commit message for the closing step additionally includes a celebration line: `Block X complete (N/N).`

After the block close, the tick STOPS. The next block is typically registered as a separate scheduled task (different cadence, different decisions, possibly different worker).

---

## 9. Pre-flight checks — the start of every `{WORK_TICK}`

Every tick begins with the same four checks, in order. Any FAIL → STOP without writing anything.

```
CHECK 1 — Is there an open block?
   Test if {BLOCK_FILE} exists. If yes → EXIT (do not write a new block).

CHECK 2 — Is the working state clean?
   Run the equivalent of `git status --short`. Must be empty, OR
   the only dirt is a documented benign pattern (e.g. orphan metadata
   files that an auto-hygiene step can resolve in a single sweep).
   Anything else → BLOCK.

CHECK 3 — Are the version carriers in sync?
   Read all {VERSION_CARRIERS}. All strings must match exactly.
   Drift → BLOCK.

CHECK 4 — What's the next step?
   Read {INVENTORY_FILE}. Find the first row whose status is [A] or [ ].
   The version cell tells you the target step.
   If no [A]/[ ] row exists → all steps closed → write the block-close
   ceremony doc + STOP.
```

These four checks are mechanical and cheap. They run in seconds. They are the gate that makes the tick safe to run on a cron schedule — if anything is off, the tick exits cleanly without touching state.

---

## 10. State decoding — what phase are you in?

The version string on the `{VERSION_CARRIERS}` has three sub-phase forms:

| Carrier string | Meaning | Action this tick |
|---|---|---|
| `vX.Y` (no suffix) | Step X.Y is closed | Start the NEXT step at Phase 1, run through to Phase 9 close |
| `vX.Y-pre` | Step X.Y has Phase 1 done (audit-pre created) | Do Phases 4 → 5 → 7 → 8 → 9 to close step X.Y |
| `vX.Y-mid` | Step X.Y has Phases 1+4+5 done (V1 + verified) | Do Phases 7 → 8 → 9 to close step X.Y |

In all three cases, the tick's goal is ONE step close per tick. After closing one step, STOP — do not start a new step in the same tick. Let the next scheduled tick handle the next step. This makes per-tick budgets predictable and bisect resolution sharper.

---

## 11. Why this is worth the overhead

The framework adds ~25-40% overhead per step over "just do the work." The trade is overwhelmingly favorable for any workplan above ~10 steps:

- **Bisect granularity.** Every entry in `{COMMIT_LOG}` is a closed, deep-review-gated step. A regression reported months later narrows to one commit — and that commit's body lists exactly what changed and which deep-review streaks held.
- **Continuation-first.** Any fresh worker (human or agent) can pick up the workplan cold by reading `{RESUME_FILE}` + the most recent `AUDIT_POST §6`. No conversational memory required.
- **Structural enforcement of zero-defect culture.** The Deep Review Gate's five checks make "ship a half-implemented step" not just discouraged but *structurally impossible*. Streak metrics (consecutive zero-Phase-8-patch, consecutive zero-Phase-4-correction) make the discipline visible.
- **Audit trail.** Every step has a planning doc, a review doc, an artifact diff, and a commit message — all four agree on what shipped. Six months from now, "why did `vX.Y` add this constant?" is one command away.
- **Safe autonomy.** The framework is the contract that makes autonomous workers (cron-scheduled agents, CI jobs) trustworthy. The block file is the asynchronous "ask," the deep review gate is the synchronous safety net.

The framework is not paperwork. It is a forcing function for explicit thinking — write the plan before the work, prove the work matches the plan after, and let the commit log be a faithful record of the closed steps.

---

## 12. Adaptation guide — scaling up or down

The framework is designed for a workplan of ~10-50 steps in a single block, with one autonomous worker (or a small handful of workers sharing the ledgers). To adapt:

### Smaller scale (3-10 steps, one worker, no autonomy)

- Keep all 9 phases but allow `AUDIT_PRE` and `AUDIT_POST` to be 1-2 paragraphs each instead of full sections (still §1-§6 headings; just terser bodies).
- Drop the `{VERSION_LOG_FILE}` if the commit log is enough.
- Keep the Deep Review Gate intact — it's the cheapest insurance you can buy.
- Skip the block-close ceremony for the only block.

### Larger scale (50+ steps, multiple workers, multi-month timeline)

- Split into multiple blocks of 10-15 steps each, with explicit block-level frozen decisions in `{RESUME_FILE} §0`.
- Add a worker-coordination doc: which worker owns which step, what claims are honored.
- Add a "step in flight by worker X since timestamp Y" guard to prevent two workers from picking the same `[A]` row.
- Expand `{VERSION_LOG_FILE}` rows with worker-id columns.
- Add a per-block exit-gate ceremony with N GREEN criteria, not just `[x]` row count.

### Different domains (non-code)

For content production (blog posts, marketing copy, documentation sweeps):
- `{ARTIFACT_KIND}` = piece of content. `{TEST_COMMAND}` = a linter / style-guide check / human reviewer's checklist.
- `AUDIT_PRE §6` = the outline of the piece. `AUDIT_POST §1` = "did each outline bullet land in the final piece, with quoted evidence?"
- Deep Review Gate check 2 = "every fact in the piece has a citation."
- `{VERSION_CARRIERS}` = a frontmatter field on the published artifact.

For data backfills:
- `{ARTIFACT_KIND}` = batch of database rows. `{TEST_COMMAND}` = an idempotency check + a row-count assertion + a sample-row schema validation.
- `AUDIT_PRE §6` = "this batch updates table T columns C1, C2 for rows matching predicate P."
- `AUDIT_POST §1` = "row count actually updated = expected count; column C1 distribution matches sanity check."
- Deep Review Gate check 4 = "no unexpected tables touched (zero phantom writes)."

For model retraining:
- `{ARTIFACT_KIND}` = model checkpoint. `{TEST_COMMAND}` = eval suite + metric threshold check.
- `AUDIT_PRE §6` = "this checkpoint changes hyperparameters H1, H2 and adds dataset D."
- `AUDIT_POST §1` = "metric M moved from X to Y; metric M' moved from X' to Y'; both within expected envelope."
- Deep Review Gate check 1 = "checkpoint version, eval-suite version, dataset version all in lockstep."

The mechanics translate. What stays constant: the 9-phase shape, the Deep Review Gate, the one-commit-per-step rule, the carry-forward chaining, the block-file safety valve.

---

## 13. Checklist — one-page reference

```
PRE-FLIGHT (every tick):
  [ ] {BLOCK_FILE} does not exist
  [ ] Working state clean
  [ ] All {VERSION_CARRIERS} match
  [ ] Read {INVENTORY_FILE} → find first [A]/[ ] row
  [ ] If no [A]/[ ] → block-close ceremony + STOP

PHASE 1 — Version(pre) + AUDIT_PRE:
  [ ] Bump {VERSION_CARRIERS}: vX.(Y-1) → vX.Y-pre
  [ ] Create {AUDIT_DIR}/stepNN_<slug>/
  [ ] Write AUDIT_PRE.md with §1-§6
  [ ] Consume prior step's AUDIT_POST §6 verbatim into §3

PHASE 4 — V1 implementation:
  [ ] Execute every AUDIT_PRE §6 bullet
  [ ] Bump {VERSION_CARRIERS}: vX.Y-pre → vX.Y-mid

PHASE 5 — Verify:
  [ ] {TEST_COMMAND} passes at expected baseline
  [ ] Every §6 delta is greppable in working state
  [ ] Any failure → write {BLOCK_FILE} + STOP

PHASE 7 — AUDIT_POST:
  [ ] Write AUDIT_POST.md with §1-§6
  [ ] §1 ledger row count = staged file count
  [ ] §2 has greps for every §6 delta
  [ ] §3 cross-references checked
  [ ] §4 prefer all POSITIVE
  [ ] §5 list patches if §4 had NEGATIVE
  [ ] §6 carry-forwards to next step

PHASE 8 — V2 corrections:
  [ ] Apply §5 patches (usually NO-OP)
  [ ] Architectural choice needed → write {BLOCK_FILE} + STOP

DEEP REVIEW GATE (5 checks):
  [ ] Check 1 — version carriers in lockstep at vX.Y-mid
  [ ] Check 2 — every §6 delta greppable
  [ ] Check 3 — every §5 applied patch in staged diff
  [ ] Check 4 — no phantom files in staged diff
  [ ] Check 5 — §1 yes-rows count = staged non-audit non-ledger file count
  [ ] Any FAIL → write {BLOCK_FILE} + STOP (no commit)

PHASE 9 — Final close:
  [ ] 9a — Bump {VERSION_CARRIERS}: vX.Y-mid → vX.Y (clean)
  [ ] 9b — Insert vX.Y header block in shipped artifact
  [ ] 9c — Append vX.Y entry to {VERSION_LOG_FILE}
  [ ] 9d — Flip {INVENTORY_FILE} row: [A] → [x] with close annotation
  [ ] 9e — Update cross-cutting tracker docs if applicable
  [ ] 9f — Update {RESUME_FILE}: status + carry-forwards + progress
  [ ] 9g — Stage everything + commit with structured message

POST-COMMIT:
  [ ] Verify commit landed (search log for vX.Y)
  [ ] STOP — do not start a new step in the same tick
```

---

## 14. Final notes

This framework was forged in a real-world workplan that closed 35+ steps with zero Deep Review Gate failures and zero Phase 8 patches needed. The discipline is real and the streak metric is the proof — but the framework only works if you treat it as a contract, not as guidelines. Skip a phase once and you've taught yourself that skipping is allowed. Land a half-step commit once and you've taught the bisect tool that half-step commits exist.

The smallest workable scale is ~5 steps. Below that, the overhead exceeds the value. Above ~50 steps, split into blocks and add inter-worker coordination. The sweet spot is 10-30 steps per block with one or two workers sharing the ledgers.

Use this as a starting template. Replace the placeholders, prune the phases that don't fit your domain (almost none — they all earn their keep), and add the project-specific safety checks that matter for your stack. The Deep Review Gate is non-negotiable; everything else is tunable.
