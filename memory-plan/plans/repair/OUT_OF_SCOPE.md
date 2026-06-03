# Out of Scope — Captured Observations

Things observed while doing repair-plan work that deserve attention later. Agnostic specifications only (MASTER_PLAN §4.3): WHAT + WHY, never HOW. Always-writeable (hook exempt).

---

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
