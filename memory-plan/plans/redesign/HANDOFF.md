# SESSION HANDOFF — 2026-05-30 ~14:30 ET

Supersedes the old `BLOCKED.md` (step 3.3 is no longer blocked — see below).

## TL;DR

- **Silent transcript-corruption bug found, fixed, committed, and remediated on the live DB.** Was armed for 33 gateway sessions; now 0 armed. Daemon restarted on the fixed code. Not a threat anymore.
- **New hourly transcript-archive job is live** — preserves all conversation transcripts indefinitely (Claude Code auto-deletes them after 30 days).
- **Full retro-review of the autonomous run (v1.1→v3.2) was done** — verdict ledger below.
- **Step 3.3 (turn_index) runtime evidence is MET** but the step is NOT formally closed; its code sits uncommitted in the working tree.

## Done this session

### 1. Transcript-corruption fix — committed `6d7b623`
- **Bug:** `importSession` (`lib/session-store.mjs`) re-imported sessions with append-delta: `messages.slice(existingCount)` using the stored `message_count` as a slice offset, appended via plain `INSERT`. Correct only if the parser yields the same messages every import. The **v3.2** gateway adapter change re-counts already-stored sessions higher (stopped dropping tool-call entries), so the offset grafted two different parses of the same conversation together — silent corruption.
- **Blast radius:** 33 gateway sessions (on disk + stored + parse-count > stored-count). Had **not** fired yet (0 `tool`-role rows pre-fix); would have fired on the next daemon Phase 0 bootstrap re-import.
- **Fix:** skip when stored count == parse count (unchanged convo); else delete the session's rows and re-insert the whole parse. No offset to misalign; self-heals on parser changes. FTS stays in sync via existing triggers.
- **Verified:** 27/27 `test/session-store.test.mjs` pass incl. a new regression test reproducing the exact corruption; proven on a copy of the live DB (armed session healed 31→61 clean).
- **Remediated on production:** ran fixed `importDirectory(gateway)` → `imported:33, skipped:6`, tool-rows 0→382, **remaining armed: 0**. DB backed up first → `~/.openclaw/state.db.bak-pre-heal-20260530-142727` (delete once satisfied). Daemon restarted (PID at handoff time 75640) on fixed code.

### 2. Transcript archive — live (NEW infrastructure)
- **Why:** Claude Code deletes transcripts older than **30 days** (default `cleanupPeriodDays`, unset in all settings files); the gateway also prunes old sessions. ~188 of 233 stored conversations already have no source file on disk — permanently lost.
- **What:** `~/.openclaw/workspace/bin/archive-transcripts.sh` — rsync (no `--delete`) of every `.jsonl` from `~/.claude/projects/` + `~/.openclaw/agents/main/sessions/` into `~/.openclaw/transcript-archive/`. Append-only; never deletes.
- **Schedule:** launchd `ai.openclaw.transcript-archive`, hourly + RunAtLoad. First backup: 345 transcripts, 196 MB.
- **Manage:** log at `~/.openclaw/transcript-archive/archive.log`; pause via `launchctl unload ~/Library/LaunchAgents/ai.openclaw.transcript-archive.plist`.

### 3. Retro-review of the autonomous run (v1.1→v3.2)
Triggered because the tick chain auto-committed 13 commits unattended, and the operator asked to vet them. Reviewed commit-by-commit against each step's AUDIT_POST. Headline: the audits are thorough and code-on-disk matches runtime (no drift), but **half the steps were "proven" with synthetic evidence** (hand-published `nats pub` events) because the daemon couldn't run a real extraction headless — the same wall that correctly blocked 3.3.

**Verdict ledger:**

| Step | Verdict | Note |
|---|---|---|
| v1.1 schemas | SOLID | unit-tested, accept |
| v1.2 emit ingested | SYNTHETIC-ONLY | code correct, emit never observed live |
| v1.3 emit extracted | SYNTHETIC-ONLY | LLM path never ran — highest-risk synthetic |
| v1.4 emit retrieved/injected | SYNTHETIC-ONLY | cheapest to make real (headless curl) |
| v1.5 emit error | SYNTHETIC-ONLY | only a `TEST_INDUCED` hand-publish |
| v2.1 watcher core | SOLID | live (watcher.jsonl writing) |
| v2.2 classify | SYNTHETIC + **latent NaN bug** | `memory-watcher.mjs:93` — see follow-ups |
| v2.3 health probes | SOLID | live, DB-accurate |
| v2.4 MC api | SOLID | curled live :3000 |
| v2.5 MC panel | SOLID | data real; live-render unproven |
| v2.6 anomaly alerts | SOLID | one real fired alert end-to-end |
| v3.1 skipIfExists fix | (was SUSPECT) | **fixed this session** — combined with v3.2 caused the corruption |
| v3.2 tool entries | SOLID adapter | real-verified; was sequencing the v3.1 bug |

No step needs a revert — code is faithful to its audits. The v3.1/v3.2 hazard is now resolved.

### 4. Watcher "other bugs" triaged + fixed — committed `4e6815a`
The retro-review flagged several watcher bugs; re-verifying each (don't trust the subagent):
- **v2.2 classify NaN** — REAL → **fixed** (`(d.x||0)` per count; a real extraction no longer reads as `noop`).
- **v2.3 health status always `ok`** — REAL but minor → **fixed** (status now `degraded` when any store is missing/locked; `probeStore` degrades instead of throwing).
- **v2.6 `extraction_noop_rate`** mis-named (counts noop+error) → **renamed `extraction_failure_rate`** (lib + UI label).
- **v2.6 `?op=watcher.alert` dead filter** → **fixed** (API honors the filter; verified on real `watcher.jsonl`).
- **v2.1 restart-replay duplication** — **FALSE ALARM** (0 dupes across today's restarts; durable consumer resumes from ack).
- **`COMPONENT_REGISTRY` "symlinked" claim** — **FALSE ALARM** (runtime `lib/` is a directory symlink to repo; the claim is correct; subagent was wrong).
- v2.6 `extraction_failure` firing on every error (not just extraction boundary) — left as-is (defensible).

## Step 3.3 (turn_index) — evidence MET, NOT closed

- **Done:** `storeExtractionResult` accepts `opts.turnIndex`; `runFlush` passes `messageCount`. Tests pass. **Runtime evidence produced this session:** a real deployed `runFlush` against a 198-message session stamped 14 mentions with `turn_index=198` in production `state.db` (criterion: `SELECT COUNT(*) FROM mentions WHERE turn_index IS NOT NULL AND created_at > datetime('now','-1 hour')` > 0 — satisfied).
- **Uncommitted (working tree):** `lib/extraction-store.mjs`, `lib/pre-compression-flush.mjs`, `test/extraction-store.test.mjs`.
- **To close:** write `audits/step33_turn_index/AUDIT_POST.md` (AUDIT_PRE already exists), mark INVENTORY row `[x]`, bump `VERSION`→v3.3, commit. Then `BLOCKED.md` is fully obsolete (already removed in favor of this file).

## Open follow-ups (priority order, none urgent)

1. **Close step 3.3** — evidence met; just the write-up + commit above.
2. **Mission-control deploy gap (NEW)** — the running UI dev server serves `~/.openclaw/workspace/projects/mission-control/`, a **stale separate copy (dated Apr 12)**, NOT the repo `mission-control/`. So none of the v2.4–v2.6 watcher UI is running as built, and those steps' "live-verified" audit evidence actually exercised the stale copy. Decide: symlink it to the repo (like `lib/`, `bin/`) or add a real build/deploy step.
3. **Convert synthetic→real** — drive ONE real daemon extraction + an inject curl against a populated store + one fault-injection. Upgrades v1.2–v1.5 evidence from hand-published to observed in a single pass (not headless now).
4. **Tighten the done-contract (operator-approved)** — a runtime-observable done-criterion must BLOCK (like 3.3 did) when real runtime evidence is impossible; it must not be satisfiable by hand-published `nats pub` events. Update WORKFLOW.md / the tick done-contract.
5. **Record the retro-review + the two fix commits in DECISIONS.md** so the ledger is durable.

## Key facts discovered

- Claude Code transcript retention = **30 days** (default; `cleanupPeriodDays` unset). 30-day boundary (2026-04-30) matches the deletion age-gradient exactly.
- Gateway prunes old sessions too; **mechanism not found** (no cron/launchd/config) — last unexplored thread is the gateway binary itself.
- Pre-heal DB backup: `~/.openclaw/state.db.bak-pre-heal-20260530-142727`.

## How to resume

1. Read `MASTER_PLAN.md` + this file.
2. Plan-wise, the next INVENTORY action is still step 3.3 closure → then 3.4.
3. Set a fresh per-step scope in `SCOPE.md` before editing (the current scope is the now-completed corruption hotfix; it expires 2026-05-31).
