# OpenClaw Memory Plan — Framework (project-resolved)

This is the project-resolved adaptation of the Automated Stepped Workplan Framework.
The canonical, generic doc lives at [FRAMEWORK_CANONICAL.md](FRAMEWORK_CANONICAL.md);
read it for theory and rationale. **For operational decisions during a tick, follow this file.**

The framework is a contract, not a guideline. Skipping a phase is forbidden. The
Deep Review Gate is non-negotiable. **Exactly one commit lands per step, at Phase 9 close.**

---

## 0. Placeholders → concrete artifacts (resolved)

| Placeholder | This project |
|---|---|
| `{ARTIFACT_KIND}` | source code in `/Users/moltymac/openclaw` (mjs/js/ts/sh) + plan-internal docs |
| `{VERSION_CARRIERS}` | `memory-plan/VERSION` (single line, no other carriers) |
| `{TEST_COMMAND}` | `npm test` from repo root (`node --test test/*.test.js test/*.test.mjs`) |
| `{INVENTORY_FILE}` | `memory-plan/INVENTORY.md` |
| `{VERSION_LOG_FILE}` | `memory-plan/VERSION_LOG.md` |
| `{RESUME_FILE}` | `memory-plan/RESUME.md` |
| `{AUDIT_DIR}` | `memory-plan/audits/` |
| `{BLOCK_FILE}` | `memory-plan/BLOCKED.md` |
| `{COMMIT_VERB}` | `git commit` (no signing, no push, no amend) |
| `{COMMIT_LOG}` | `git log` on the `main` branch (no work branches; one branch for plan execution) |
| `{WORK_TICK}` | one 30-minute launchd cron invocation of `workspace-bin/memory-plan-tick.sh` |

Workspace runtime files at `~/.openclaw/workspace/` are **not** version carriers and **not**
committed. When a step changes a workspace file at runtime, the audit doc records the change
and the corresponding source-code change that produced it is committed.

---

## 1. The three ledger files (this project's instances)

- **Inventory** — `memory-plan/INVENTORY.md`. 45 steps across 10 blocks. Status `[ ]/[A]/[x]`.
- **Version log** — `memory-plan/VERSION_LOG.md`. Append-only, three entries per step.
- **Resume** — `memory-plan/RESUME.md`. Cold-pickup state, §0 frozen decisions, per-step paragraphs.

---

## 2. Version strings used by this plan

Form: `v<block>.<step>` with optional sub-version suffix.

| Carrier string | Meaning | Tick action |
|---|---|---|
| `vX.Y` (no suffix) | Step X.Y closed | Start NEXT step at Phase 1 → run to Phase 9 close |
| `vX.Y-pre` | Phase 1 done for step X.Y | Run Phase 4 → 5 → 7 → 8 → 8.5 → 9 |
| `vX.Y-mid` | Phases 1+4+5 done for step X.Y | Run Phase 7 → 8 → 8.5 → 9 |

Initial state: `v0.0` (no steps closed). The first step closes at `v0.1`.

---

## 3. The 9 phases

### Phase 1 — Version(pre) + AUDIT_PRE

1. Write `vX.Y-pre` to `memory-plan/VERSION`.
2. Create `memory-plan/audits/stepNN_<slug>/` (e.g. `step01_reload_memory_budget/`).
3. Write `AUDIT_PRE.md` with `§1` intent, `§2` inventory excerpt, `§3` design decisions (consume the prior step's `AUDIT_POST §6` verbatim), `§4` risk register, `§5` deferrals, `§6` Phase 4 implementation outline (a bullet per file delta — each becomes a row in `AUDIT_POST §1`).
4. Append a `vX.Y-pre` entry to `memory-plan/VERSION_LOG.md` above `## NEXT VERSIONS`.
5. Flip the step's row in `memory-plan/INVENTORY.md` from `[ ]` → `[A]`.

No production work yet. No commit yet.

### Phase 4 — V1 implementation

1. For each `AUDIT_PRE §6` bullet, do the actual edit.
2. If a new requirement surfaces mid-implementation, append it under `## Mid-Implementation Findings` in `AUDIT_PRE.md` rather than silently expanding the step. **Zero mid-implementation findings** is the streak metric.
3. After all production edits land, write `vX.Y-mid` to `memory-plan/VERSION`.
4. Append a `vX.Y-mid` entry to `VERSION_LOG.md`.

No commit yet.

### Phase 5 — Verify (test + grep)

1. Run `npm test`. Expected pass count = the most recent count in `VERSION_LOG.md` plus any additions promised by this step's plan. Any failure → write `BLOCKED.md` and STOP. Do not fix forward.
2. For each `AUDIT_PRE §6` bullet, run the grep/search command that proves the change is present. Save command + first hit for `AUDIT_POST §2`.

No commit yet.

### Phase 7 — AUDIT_POST (the deep review IS this doc)

Write `memory-plan/audits/stepNN_<slug>/AUDIT_POST.md` with:

- `§1` files-changed-vs-AUDIT_PRE-§6 ledger (table: promised | actual file:line | landed yes/no/partial | grep evidence). Every row must be `yes` or the step is incomplete and must be finished or rolled back before Phase 7 closes.
- `§2` greppable-deltas-confirmed (exact command + first hit line per §6 bullet)
- `§3` cross-references-still-valid (search whole codebase for renamed/deleted symbols; zero stale refs)
- `§4` findings, each `[POSITIVE]` or `[NEGATIVE]` prefix
- `§5` Phase 8 patches (almost always "none" — every patch needs trigger finding + file:line + minimal diff + justification)
- `§6` carry-forwards to Step (N+1)

No commit yet.

### Phase 8 — V2 corrections

Apply patches in `AUDIT_POST §5`. Almost always a NO-OP. If a patch requires architectural
choice not pre-decided in `RESUME.md §0` or prior carry-forwards → write `BLOCKED.md` + STOP.

### Phase 8.5 — DEEP REVIEW GATE (5 checks)

All five must pass. Any FAIL → write `BLOCKED.md` (with the failed check ID) and STOP.
No commit if any check fails.

```
CHECK 1 — Version carriers in lockstep
  Read memory-plan/VERSION. Must be exactly `vX.Y-mid`.
  Drift → BLOCK.

CHECK 2 — Every AUDIT_PRE §6 delta is greppable
  Re-run every search command listed in AUDIT_POST §2.
  All must return ≥1 hit. Any empty → BLOCK.

CHECK 3 — Every AUDIT_POST §5 "applied" patch is in the staged diff
  Run `git status --short` and `git diff --cached`.
  For each §5 entry: confirm file:line is staged.
  If §5 said "none" → diff must contain only:
    AUDIT_PRE §6 file deltas + Phase 9 ledger files.
  Extras → BLOCK.

CHECK 4 — No phantom changes in the staged diff
  Staged file list ⊆ union of:
    - AUDIT_PRE §6 file list
    - AUDIT_POST §5 file list
    - memory-plan/audits/stepNN_<slug>/AUDIT_PRE.md
    - memory-plan/audits/stepNN_<slug>/AUDIT_POST.md
    - memory-plan/VERSION
    - memory-plan/VERSION_LOG.md
    - memory-plan/INVENTORY.md
    - memory-plan/RESUME.md
  Any file outside the union → BLOCK.

CHECK 5 — Row count reconciles with file count
  Count §1 rows where landed=yes.
  That count = count of non-audit non-ledger files in staged diff.
  Mismatch → BLOCK.
```

### Phase 9 — Final close (the only phase that commits)

**9a** — Write `vX.Y` (clean, no suffix) to `memory-plan/VERSION`.
**9b** — N/A for source code (the shipped artifact has no canonical version header block). Skip.
**9c** — Append `vX.Y` final entry to `memory-plan/VERSION_LOG.md`.
**9d** — Flip `memory-plan/INVENTORY.md` row from `[A]` → `[x]` with one-paragraph close annotation.
**9e** — N/A unless this step is the last of a block (see §8 below).
**9f** — Update `memory-plan/RESUME.md`: change in-flight paragraph to closed-state, add Step (N+1) carry-forwards, bump progress tracker.
**9g** — Stage everything (`git add -A`) and commit. **Message format:**

```
vX.Y — <one-line step description from inventory>

Phase 4: <one-sentence summary of artifact deltas>.
V2 audit: <N> POSITIVE findings, <M> Phase 8 patches.
Streak: <S>-of-<S> zero-Phase-4-correction (block cumulative).

Authored-By: memory-plan-tick
```

After the commit, the step is closed. **STOP — do not start a new step in the same tick.**

---

## 4. Per-step commit discipline (rules)

1. Exactly one commit per step. Phase 9g only.
2. The commit stages: source-code changes + audit-pre + audit-post + VERSION + VERSION_LOG.md + INVENTORY.md + RESUME.md + any docs added by the step.
3. Message format is structural (above).
4. No mid-step commits. No amends. No force-push. No `git config` changes.
5. Pre-write workaround (lock file): before any `git add`, run
   `[ -f .git/index.lock ] && mv .git/index.lock .git/index.lock.stale.$(date +%s) 2>/dev/null || true`.
6. Commit only after Gate passes (Phase 8.5).

---

## 5. Carry-forwards

`AUDIT_POST §6` of the closing step seeds `AUDIT_PRE §3` of the next. Phase 9f mirrors
the same list into `RESUME.md` so the next tick can read it cold. Block-level frozen
decisions live in `RESUME.md §0` and apply to **every step in the current block**.

---

## 6. When to STOP and write BLOCKED.md

- `npm test` red / errors / timeouts
- `AUDIT_PRE` risk register flags a HIGH-severity risk not pre-resolved
- A decision is needed that isn't in `RESUME.md §0` or a prior carry-forward
- `VERSION` is unreadable, malformed, or out of sync with INVENTORY
- Working tree has uncommitted human changes at pre-flight (`git status --short` non-empty AND not a documented benign pattern)
- Edit tool fails persistently on the same file
- A Phase 9 ledger update fails
- `git commit` fails after the lock-file workaround
- Any Deep Review Gate check (1-5) fails

Use [BLOCK_TEMPLATE.md](BLOCK_TEMPLATE.md). The first action of the **next** tick is to
check whether `BLOCKED.md` exists; if so, exit immediately without touching state.

---

## 7. Block-close ceremony

When the last step of a block closes (e.g. Step 0.7 for Block 0):

1. Write `memory-plan/audits/BLOCK_<N>_COMPLETE.md` documenting exit-gate criteria, files touched cumulatively, and carry-forwards into the next block.
2. Update `RESUME.md` heading to "Block X closed; Block Y awaits"; pin Block Y's frozen decisions at §0.
3. The Phase 9 commit message for the closing step adds a final line: `Block X complete (N/N).`

After block close, STOP. The next block is a separate stretch of work.

---

## 8. Pre-flight checks (every tick, in order)

```
CHECK 1 — Is BLOCKED.md present?
  ls memory-plan/BLOCKED.md && EXIT (no write).

CHECK 2 — Is the working tree clean?
  git status --short must be empty
  OR contain only documented benign dirt (currently: none).
  Otherwise → write BLOCKED.md + EXIT.

CHECK 3 — Is the version carrier readable?
  cat memory-plan/VERSION must match /^v\d+\.\d+(-pre|-mid)?$/.
  Drift → BLOCK.

CHECK 4 — What's the next step?
  Read memory-plan/INVENTORY.md → first row with status [A] or [ ].
  Version cell tells you the target step.
  No [A]/[ ] row → write block-close ceremony for the final block + STOP.
```

---

## 9. State decoding — what to do this tick

| `memory-plan/VERSION` | Tick action |
|---|---|
| `vX.Y` (no suffix) | Start NEXT step (Y+1, or first of next block). Run Phases 1 → 4 → 5 → 7 → 8 → 8.5 → 9. |
| `vX.Y-pre` | Resume current step at Phase 4. Run 4 → 5 → 7 → 8 → 8.5 → 9. |
| `vX.Y-mid` | Resume current step at Phase 7. Run 7 → 8 → 8.5 → 9. |

After the Phase 9 commit lands, STOP. One step close per tick. No exceptions.

If the tick budget is exhausted before reaching Phase 9, leave the working tree dirty at
the highest sub-version reached. The next tick will pre-flight, see the dirt is from a known
sub-version, and resume from that phase. (This means: if pre-flight CHECK 2 finds dirt, it
must verify the dirt matches an audit-pre §6 file list before treating it as benign. A separate
"resume-tolerant" rule: dirt is OK only if `VERSION` reads `-pre` or `-mid`. If `VERSION` is
clean `vX.Y` and the tree is dirty, that's a hard block.)
