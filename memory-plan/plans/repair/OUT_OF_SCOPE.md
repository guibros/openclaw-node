# Out of Scope — Captured Observations

Things observed while doing repair-plan work that deserve attention later. Agnostic specifications only (MASTER_PLAN §4.3): WHAT + WHY, never HOW. Always-writeable (hook exempt).

---

## 2026-09-26 — Concurrent first opens of a never-migrated DB can fail

- **Observed while:** stress-testing D9's v7 migration: four processes (two extraction-store opens, two consolidation inits) racing on one DB that had never been migrated.
- **Area:** the pre-existing column migrations (`ensureReinforcementColumn`, the `last_decayed_at` ALTERs in `initConsolidationTables`) and the `decisions_fts` creation in `createExtractionStore` — none run under a write-locking transaction.
- **Problem:** every round produced `duplicate column name: reinforcement_count` or `vtable constructor failed: decisions_fts` in one of the processes. D9's own migration is IMMEDIATE and showed 0 errors in 12 rounds on a DB already carrying those columns (its DEFERRED variant: 2 of 12).
- **Why it matters:** on a fresh install the daemon and the first scheduler cycle can hit it; the loser fails once (cycle error / launchd restart) and the next attempt succeeds — noisy rather than lossy.
- **Severity guess:** LOW.
- **Who-touches-next:** whoever next touches the store or consolidation migrations.

## 2026-09-26 — `bin/consolidate.mjs --dry-run` writes to state.db

- **Observed while:** consolidation-archive batch (D9).
- **Area:** the consolidation CLI's `--dry-run` flag / `runConsolidationCycle` `dryRun` option.
- **Problem:** documented as "skip writes, just report what would happen", but only the vault surfaces honor it; decay, entity archival, the prune step (decision archival, idle-theme deletion and its backup), reinforcement and the promotion fingerprint all write.
- **Why it matters:** an operator previewing a cycle against the live DB mutates it — the natural way to check what the next cycle will remove is itself a removal.
- **Severity guess:** MEDIUM.
- **Who-touches-next:** whoever next works the consolidation CLI.

## 2026-09-26 — Mentions never raise salience; an entity discussed daily but never injected still decays out

- **Observed while:** D9's decay-anchor fix and its +14-day rehearsal on a snapshot of the live DB (10 of 14 live entities would archive without recall).
- **Area:** the decay model (`lib/consolidation.mjs`) and the store's mention path.
- **Problem:** salience rises only through recall (injection) and co-occurrence reinforcement. The idle clock now restarts at a sighting, but that forgives only the gap between the previous decay application and the sighting, so steady mentions without injection still decay to the archive on wall-clock time.
- **Why it matters:** with D9 the archive keeps and restores everything, so this is churn rather than loss — but "actively discussed" and "archived" can coincide, and the injector ranks by the salience that only it can raise.
- **Severity guess:** LOW–MEDIUM (a model question, not a bug).
- **Who-touches-next:** whoever next revisits the decay model or the injector's selection.

## 2026-09-26 — `~/.openclaw/state.db` is world-readable

- **Observed while:** sizing D9's backups: `state.db` is mode 0644; the three `pre-step-*` backup directories under `~/.openclaw/backups/` are 0755 (D9's own backups are 0700/0600).
- **Area:** memory DB creation (`openStore`) and operator backup directories.
- **Problem:** conversation-derived memory is readable by every local account; the 2026-09-06 secrets-permissions remediation did not cover the memory DB or its copies.
- **Severity guess:** MEDIUM on a shared machine, LOW on a single-user one.
- **Who-touches-next:** Block P / the protocol 4.8 security batch.

## 2026-09-26 — The runtime tree mixes symlinks into a feature-branch checkout with stale copies

- **Observed while:** preparing D9's deploy notes. `~/.openclaw/workspace/lib` is a directory symlink and `bin/consolidate.mjs` a file symlink into `/Users/moltymac/openclaw-nodedev`, whose checkout is on a feature branch (not `main`); `bin/consolidation-scheduler.mjs` is a plain copy dated 2026-08-02 that differs from that checkout's HEAD, and `packages/event-schemas` is a copy too.
- **Problem:** what runs is whatever branch that checkout has open (for symlinked paths) combined with whenever each copy was last made — a partial deploy is easy and invisible (the live scheduler predates every scheduler change since August).
- **Why it matters:** a fix spanning linked and copied files can land half-deployed; "deployed" is not a single fact.
- **Severity guess:** MEDIUM.
- **Who-touches-next:** protocol 4.7 (drift truth); related to the known "deploy-drift probe diffs a symlink against itself".

## 2026-06-11 — mission-control fails `tsc --noEmit` with ~25 pre-existing type errors

- **Observed while:** hydration-mismatch hotfix (skeleton widths). Typecheck of the workspace surfaced errors in `src/components/observability/event-timeline.tsx` (10), `src/app/watcher/page.tsx` (7, incl. `lib_symlinked` vs `lib_symlink` property-name drift against the typed API), `src/lib/__tests__/mesh-kv-sync.test.ts` (5), `src/components/mesh/network-topology.tsx` (3). Verified pre-existing: identical with the hotfix stashed.
- **Problem:** the UI builds/runs (Next dev tolerates), but the type layer has drifted from the data shapes it renders — property renames and `unknown` flowing into ReactNode/arithmetic.
- **Why it matters:** type drift in the watcher/observability pages is exactly where silent rendering bugs hide; `tsc --noEmit` can't be used as a CI gate until clean.
- **Severity guess:** MEDIUM.
- **Who-touches-next:** whoever next works mission-control UI — one typecheck-cleanup step.

## 2026-06-03 — Extraction records no theme↔session/entity linkage — theme hubs run on an approximation

- **Observed while:** step 2.9 (themes/ surface). The themes table carries only label/hierarchy/mention_count — no link table to sessions or entities (unlike entity mentions).
- **Problem:** theme hub pages can only approximate member concepts via the theme's first-extraction batch (`source_event_id` join) — partial and frozen at first sighting. True membership needs extraction to write a theme_mentions link (schema + extraction-store + prompt change).
- **Why it matters:** themes are the wiki's cluster hubs; structural membership would make them genuinely navigational instead of best-effort.
- **Severity guess:** MEDIUM (surface exists and is honest about the gap; data model is the limiter).
- **Who-touches-next:** an extraction-schema step (Block 3.4 candidate or its own step) — schema, store, prompt, and backfill all in one decision.

## 2026-06-03 — findCurrentJsonl's 50KB floor silently excludes small sessions from interval/NATS flushes

- **Observed while:** step 2.5 runtime verification (an hour of unexplained llm-dedup cycles).
- **Area:** `workspace-bin/memory-daemon.mjs` `findCurrentJsonl` / `findJsonlBySessionId` — `stat.size < 50 * 1024 → skip`.
- **Problem:** sessions under 50KB are never selected as "current," so the interval-synthesis and NATS-trigger flush paths can never process them; only the end-of-session path (which uses the same floor in findJsonlBySessionId — so possibly NOT EVEN THEN) extracts them. A short but meaningful conversation may never be extracted at all. The floor is undocumented and interacts confusingly with the 1.4 dedup (the daemon deduped a big unchanged session while the small target was invisible).
- **Why it matters:** silent ingestion gap for short sessions; also a verification footgun.
- **Severity guess:** MEDIUM.
- **Who-touches-next:** Block 4 (daemon lifecycle) or 3.4 — decide: lower/remove the floor, or document + add a small-session flush path.

## 2026-06-03 — Distinct entities slugify to one note file (entity-duplication × slug collision)

- **Observed while:** step 2.3 runtime verification — the promoter's second run kept rewriting `openclaw.md` because TWO entities own that slug: `OpenClaw` (24 mentions) and `openclaw` (11), extraction-normalization duplicates. `openclaw-tui`/`openclaw-node` are distinct and fine.
- **Area:** entity canonicalization at extraction time (`canonical_name` exists but doesn't dedupe case variants) + every slug consumer (local concept writer, promoter, wikilinks, memory-content route).
- **Problem:** colliding entities silently clobber each other's notes — last writer wins in the local vault, so one entity's note is permanently missing; wikilinks `[[OpenClaw]]` and `[[openclaw]]` resolve to the same file with mixed content lineage. 2.3 made the promoter deterministic (first-wins + collision reported) but the duplication itself is unfixed.
- **Why it matters:** it's a hole in exactly the referential system Block 2 exists to make trustworthy; 2.4's checker and 2.6's coverage report will measure it, but merging duplicate entities is a canonicalization decision (merge rows? alias table? slug disambiguation?) that deserves its own step.
- **Severity guess:** MEDIUM (data-shape defect, visible in the vault).
- **Who-touches-next:** Block 2 re-plan (candidate for the 2.9 defined-at slot alongside 2.6's findings).

## 2026-06-03 — Dormant shared-vault promoter is unfiltered after D7

- **Observed while:** step 2.3 (promoter idempotency).
- **Area:** `lib/obsidian-promoter.mjs` → `queryPromotableConcepts` inherits the D7 transparent default; its output dir (`projects/arcane-vault/concepts-shared/`, "cross-node visibility") is a federation-era surface.
- **Problem:** when federation un-parks, the promoter would publish private-flagged content cross-node unless it opts into filtering (`respectPrivacy: true`). No production caller today (dormant), so no live exposure.
- **Severity guess:** LOW now / HIGH at federation un-park.
- **Who-touches-next:** Block P.3 (federation un-park review) — decide the promoter's filtering posture there.

## 2026-06-02 — Phase 0 bootstrap's memory-maintenance exits 1 while Phase 2's succeeds

- **Observed while:** step 1.1 runtime verification (daemon log 15:37:01).
- **Area:** the daemon's Phase 0 bootstrap subprocess chain (`memory-maintenance failed: exit 1:` — empty error tail) vs the Phase 2 invocation of the same tool, which logged `done` 5 seconds later.
- **Problem:** the bootstrap-context invocation fails where the throttled-work invocation succeeds — likely an environment/argument difference between the two call sites. The failure is logged and swallowed; bootstrap continues.
- **Why it matters:** a silently-failing bootstrap step is the silent-failure class this whole effort targets; if it ever matters (missing daily file, stale recap), nobody will know why.
- **Severity guess:** LOW (Phase 2 covers the work minutes later).
- **Who-touches-next:** whoever works daemon lifecycle (Block 4) — cheap to diagnose while in that file.
