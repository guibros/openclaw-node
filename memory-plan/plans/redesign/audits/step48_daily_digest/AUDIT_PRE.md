# AUDIT_PRE — Step 4.8: Assemble a daily/weekly digest deterministically from the vault

**Version:** v4.7 → v4.8
**Date:** 2026-06-01

## §0 Re-orient

- Where am I: Block 4 (L4 Synthesis/Wiki), step 8/9, 27/36 overall.
- Last step changed: 4.7 installed the consolidation scheduler on a 30-min launchd cadence.
- This step contributes: produces the daily/weekly digest — the coherent readable summary that replaces the lossy hourly buffer dump (OUT_OF_SCOPE 2026-05-27).
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy LLM-Wiki — synthesis) + §4 (readable output is the acceptance test).
- Still the right next step? Yes — vault notes (concepts + sessions) exist from prior steps; the digest is the reading surface.

## Intent

Build a deterministic digest assembler that reads Obsidian vault notes (sessions/ + concepts/) and produces a coherent daily/weekly summary in `vault/daily/`. No LLM — pure data assembly from existing frontmatter + wikilinks. Per MEMORY_REDESIGN §4: "deterministic assembly first, LLM polish later."

The output replaces the lossy daily logs: instead of an hourly buffer dump that repeats the same 150-char truncated snapshot ~18×/day, the digest shows what sessions happened, what concepts were active, and what decisions were made — cross-linked via wikilinks.

## Design

### Module: `lib/obsidian-digest.mjs`

**`generateDailyDigest(opts)`** — reads vault `sessions/` and `concepts/` for a given date, assembles a markdown digest, writes to `vault/daily/YYYY-MM-DD.md`.

Input: vault path (defaults via getVaultPath), target date (defaults to today).

Assembly logic:
1. Scan `sessions/*.md` — parse YAML frontmatter, filter by `date: YYYY-MM-DD`.
2. Scan `concepts/*.md` — parse YAML frontmatter, filter by `last_seen` within the target date.
3. Build markdown: frontmatter (`type: daily-digest`, `date`, session/concept counts, `generated_at`) + body (sessions list with wikilinks + active concepts + decisions).
4. Write atomically to `vault/daily/YYYY-MM-DD.md`.

**`generateWeeklyDigest(opts)`** — same pattern but covers 7 days. Writes to `vault/daily/YYYY-MM-DD-weekly.md` (anchored to the end date).

Both are idempotent (regenerating overwrites cleanly).

### Integration: wire into `lib/pre-compression-flush.mjs`

After session note generation in the LLM path, call `generateDailyDigest()`. Cheap (no LLM, pure file I/O), so it adds negligible time. The daily digest stays current with every synthesis cycle.

### Tests: `test/obsidian-digest.test.mjs`

- Parse vault notes from a fixture directory
- Verify frontmatter, wikilinks, date filtering, decision aggregation
- Verify output structure (headers, lists, cross-links)
- Edge cases: no sessions for the date, no concepts active

## Risk register

- **Low:** frontmatter parsing of third-party YAML could fail on edge cases. Mitigation: use the same parse approach as obsidian-graph.mjs (simple regex split at `---`).
- **Low:** vault has only 6 session notes — the digest may be sparse. That's fine; it reflects reality.

## File-delta outline

| File | Change |
|---|---|
| `lib/obsidian-digest.mjs` | NEW — daily/weekly digest assembler |
| `lib/pre-compression-flush.mjs` | Add `generateDailyDigest()` call after session note gen |
| `test/obsidian-digest.test.mjs` | NEW — unit tests |
