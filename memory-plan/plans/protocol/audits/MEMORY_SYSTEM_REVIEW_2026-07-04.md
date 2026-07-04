# Memory System Review — full audit with the live Obsidian vault as ground truth

**Date:** 2026-07-04, ~02:00 (Montreal)
**Trigger:** operator suspicion — *"I don't think Obsidian is really onboarding the actual memory with its hyperlinks and the current database mapping of past discussions."*
**Method:** four parallel audit agents over the live node — (1) vault ground truth (all 117 notes, full wikilink extraction), (2) DB↔vault promotion mapping (read-only SQL against live state.db), (3) pipeline code review (every obsidian-* writer + wiring), (4) end-to-end recall probes against the live inject server. Everything marked OBSERVED was executed, not inferred.

---

## 1. Executive verdict

**The suspicion is correct on every count — and the diagnosis is sharper than "the vault is thin":**

1. **The vault is not a knowledge graph.** As Obsidian actually parses it: 76% of notes are orphans, the graph is 57 disconnected components (one 61-node cluster + 56 islands), and there are **zero concept→concept edges**. The linking that was *supposed* to connect it lives in malformed YAML frontmatter (`related: [[[Arcane]], ...]` — triple-bracket nesting) that neither Obsidian nor the graph-cache parser can read.
2. **The mapping to past discussions is structurally severed.** Notes reference **107 distinct session UUIDs as plain text**; exactly **1** of them has a session note. Only 8 session notes exist for 245 sessions (193 with mentions), the newest describing 2026-06-02.
3. **The vault contributes exactly zero at recall time.** Channel 5 (spreading activation over the vault graph) returned 0 results on every live probe and **cannot** return anything: concept nodes have no outgoing resolvable edges, and the 63 valid edges point the wrong direction for the seed→propagate design.
4. **But the underlying memory is not dead — it's split.** The vector layer (knowledge.db, 16,826 chunks, 100% embedded, including yesterday's recovered day) is current and demonstrably recallable (OBSERVED: the July-3 ctx-borrow work retrieved with exact snippets). The *knowledge* layer (entities/decisions/themes → notes, MEMORY.md, channels 3/4/6) is **frozen at 2026-06-17 with an 86% May-25 skew** — nothing from the deep review, P1 round 2, or deploy day exists as an extracted decision.
5. **Integrity violation found: the test suite writes into the production vault.** Fixture notes (`promotable-one.md`, `promotable-two.md`, `promoted-entity.md`, fixture decisions with `session: dedup-session`) sit in the live vault, and `daily/2026-07-03.md` — the vault's newest daily — is a digest **of test fixtures**, having clobbered the real day's digest. Cause: `runConsolidationCycle` and `runFlush→generateDailyDigest` default to the real vault path when tests don't override it.

One sentence: **recall works because of SQLite vectors; the Obsidian layer is a stale, disconnected veneer that neither represents the memory nor feeds it back.**

---

## 2. The numbers

| Layer | In DB | In vault | Coverage | Freshness |
|---|---|---|---|---|
| Entities → concept notes | 1,087 | 69 (64 real + 2 orphaned + 3 test fixtures) | 6.3% — but **100% of the 67 that qualify** (mention_count ≥ 5) | head 25 rewritten Jul 3 18:45; tail 40 frozen Jun 3 |
| Decisions → decision notes | 337 | 27 (24 real + 3 fixture copies) | 8% — the "fresh at flush time" survivors, not the most important | 22 from Jun 3; format-correct but fossils |
| Themes → theme notes | 668 | 6 | 0.9% (policy-correct: only 6 clear threshold) | single write ever, Jun 3; **all 6 admit they're empty** |
| Sessions → session notes | 245 (193 w/ mentions) | 8 notes / 6 sessions | 3% | dead since Jun 16 (content = Jun 2) |
| Vector chunks | 16,826 (100% embedded) | n/a | — | **current** (yesterday's day recovered: 3,450 new chunks) |

Link graph (OBSERVED, full extraction): 929 raw wikilink instances / 81 targets; 277 instances (30%) dangling. Body-only (what Obsidian indexes): 131 instances, 105 unique edges, 89/117 orphans, 67/117 with zero outbound. Top hubs (`openclaw.md` 74 in, `daedalus.md` 43) get their inbound from frontmatter arrays that render as text, not links — and both hubs' bodies read `_Summary not yet generated._`

---

## 3. Root causes (consolidated across the four audits)

### A. Four of five vault writers ride a code path that hasn't succeeded in 17 days — CRITICAL
Session, decision, theme, and daily writers execute **only inside `runFlush`'s LLM path** ([pre-compression-flush.mjs:460-515](../../..//lib/pre-compression-flush.mjs)). That path is skipped by: (a) the regex fallback whenever the LLM call fails (log evidence: last `[llm]` synthesis **2026-06-16 22:17**; 2026-07-04's runs were `[regex]`), and (b) the `[llm-dedup]` tail-hash early-return, which exits **before every writer** even when the LLM is available. The 245 backfilled sessions never got notes (backfill generates concepts only). The one writer with its own schedule — concept regeneration via the consolidation cycle — is exactly why concepts (69) dwarf everything else. Additionally the consolidation scheduler skipped **13+ consecutive cycles** ("Ollama has active inference") since Jul 3 18:45, so nothing post-migration has been written at all.
**Fix:** move session/decision/theme/daily generation into the consolidation cycle (idle-gated, DB-driven, iterate sessions lacking notes) instead of coupling them to live-flush success.

### B. The link topology is broken at three independent layers — CRITICAL
1. **YAML shape:** `related: [[[Name]], ...]` parses as *nested arrays*; `buildGraph`'s related-branch requires strings ([obsidian-graph.mjs:144-146](../../../lib/obsidian-graph.mjs)) — dead code for every real note. Frontmatter links render ~0% in Obsidian.
2. **Name vs slug:** targets are display names (`[[NATS JetStream]]`, `[[Claude Code]]`) that never resolve to hyphenated slugs on disk.
3. **Path-style session targets:** `[[sessions/x]]` edges never match the graph's basename node ids — 42/105 cached edges dangle; the 63 that resolve are session→concept, unreachable from channel 5's concept seeds (outgoing-only walk, [spreading-activation.mjs:88](../../../lib/spreading-activation.mjs)).
**Net: concept↔concept edges = 0, channel 5 = structurally dead** (0 results on all 5 live probes).
**Fix:** emit piped slug links `[[slug|Name]]` (the decision/theme writers already do this correctly); flatten non-string `related` entries + normalize targets in `buildGraph`; walk edges bidirectionally.

### C. Decision surface frozen by decay-vs-threshold collision — HIGH
`generateDecisionNotes` gates on `salience ≥ 0.4` at write time, while consolidation decay has driven decisions to avg salience **0.024** — only **5/337** are eligible today, and the top decision in the whole DB (id 57, salience 1.0 via recall boost) has no note because it decayed below the gate before the surface existed. The 27 on-disk notes are pre-decay fossils. Compounding: **decision extraction itself produced zero rows after 2026-06-17** (the LLM-extraction failure window), so yesterday's C2/deploy decisions don't exist anywhere.
**Fix:** select top-N by salience with no absolute floor (or gate on confidence); separately, verify extraction is producing decisions again post-recovery.

### D. Case-variant entity duplication throttles everything downstream — HIGH
`ON CONFLICT(name)` is case-sensitive and `canonical_name` is stored verbatim and never used: `OpenClaw`(25)+`openclaw`(11), `Arcane`(73)+`arcane`(5), `NATS`(33)+`nats`(0), `Claude`(10)+`CLAUDE.md`→`claude-md`(…), ~10 more groups. Split mention counts keep variants under the note threshold; slug collisions produce the live duplicate note pairs (`claude.md`/`claude-md.md`, `the-hidden-truth-index[-md].md`) that split inbound links.
**Fix:** normalize canonical_name (lower/trim, strip `.md`), unique-index it, merge-on-upsert + one-time merge migration.

### E. Theme hubs are permanently memberless — HIGH
The member query needs `mentions.source_event_id`, which local extraction **never stamps** (0/1,003 rows non-NULL — only federation events would set it). All 6 theme notes emit the "no structural membership" fallback. This is the known `theme_mentions` gap (repair OUT_OF_SCOPE) now confirmed as the only thing theme notes can ever render.
**Fix:** stamp local extraction batches, or add the real `theme_mentions` link table (schema + store + prompt in one step).

### F. Tests write the production vault — HIGH (integrity)
`test/consolidation.test.mjs` runs `runConsolidationCycle({db})` without `vaultPath` → defaults to the real vault; `runFlush` calls `generateDailyDigest()` with **no vaultPath argument at all**. Fixtures landed Jul 3 18:34 (and Jun 3, Jun 11); the real daily digest for Jul 3 was destroyed (atomic overwrite); the fixture notes shifted the graph cache 131→105 edges.
**Fix:** thread `vaultPath` through both entry points; set `OBSIDIAN_VAULT_PATH=tmpdir` globally in tests; purge `promotable-*`, `promoted-entity`, `dedup-session` decisions, and the three poisoned dailies from the live vault.

### G. Retrieval channels squander recall the vault was supposed to add — MEDIUM
OBSERVED across 5 live probes (46–114ms, all in embedding-fallback mode — the ambient condition): vector = every relevant hit; FTS fired 1/5 (raw prompt → FTS5 MATCH = implicit AND across all words — natural-language queries return 0); dfts returned 30 rows on *every* query including stopword noise ("the/we/about" OR-match everything); channels 3/4 fire only on stale May–June vocabulary (entity `last_seen` max = Jun 17). The known narrative-recall miss: "two parallel daemons May failure" is indexed (13 chunks findable by phrase) but not retrieved by natural phrasing.
**Fix:** FTS query builder (OR + porter, drop stopwords); dfts stopword filter; then re-baseline channel weights.

### H. MEMORY.md — the operator-facing surface — is stale and corrupted — MEDIUM
mtime is current (synthesizer runs) but content: entities dominated by May Arcane lore ("Arcane 71×"), newest decision Jun 17, nothing about the last three weeks — and the "Active Themes" section ends with **raw temp-file paths** (`[user] /private/tmp/claude-501/.../tasks/bf334ywk3.output`) leaked from session-turn text by the synthesizer (the themes table itself is clean).
**Fix:** synthesizer input sanitization + regenerate after extraction catches up.

### I. Dead/misleading components — LOW/MEDIUM
- "Phase 2: obsidian-sync done" **does not touch this vault** — it's a March-era workspace tool syncing MEMORY.md/lessons into `projects/arcane-vault`, hash-gated, logging "done" on zero writes. (This explains last night's mystery of sync-that-writes-nothing.)
- Orphaned: `lib/obsidian-promoter.mjs` (target dir doesn't exist), `generateWeeklyDigest` (no caller), `bin/memory-promoter.mjs` (NATS promoter, in no launchd unit; `published_items` = 0 rows — every consolidation cycle emits 26+107 promotion candidates that nothing consumes).
- Extraction junk visible in notes: 110 empty-name bullets (`-  (person)`), 5×-paraphrase decision dumps in session notes, hallucinated concept summaries (memory-daemon described as a RAM manager), 12/27 "decisions" that are game-lore brainstorm items.

---

## 4. What actually works (keep these)

- **The vector memory is healthy and current** — 100% embedded, the recovered day recallable same-night with exact snippets, 46–114ms end-to-end injection.
- **Concept promotion is policy-complete** — every entity that qualifies under its threshold has a note; the D5 migration did *not* freeze it (67 qualify now vs 69 before).
- **The Jun-17 decision-note format** (dated, rationale, confidence, `From [[session]]` backlink) is the right shape — the one note pattern that genuinely maps to a past discussion. Converge the rest of the pipeline on it.
- **The frontmatter data layer is consistent** (117/117 typed, salience/mention_count carried) — the raw material for a real graph is there; it's the emission shape that's broken.
- The daemon/scheduler wiring is live and the watcher now surfaces stalls (yesterday's Phase-2 catch proves the loop).

---

## 5. Remediation plan (proposed order)

**Batch V0 — integrity (small, immediate):**
1. Test-vault isolation (thread vaultPath; `OBSIDIAN_VAULT_PATH` in test env) + purge fixtures/poisoned dailies from the live vault.

**Batch V1 — make the vault a graph (the core of the operator's ask):**
2. Link emission: piped slug links in concept frontmatter→body, graph parser flatten+normalize, bidirectional walk. (Unblocks channel 5 with zero new data.)
3. Session-note backfill driven by the consolidation cycle: one note per DB session (start with the 107 UUIDs already referenced by concept notes), decoupled from live-flush success.
4. Decision threshold vs decay fix + verify post-recovery extraction produces decisions again.
5. Canonical-name normalization + merge migration (kills duplicate notes, lifts real entities over the threshold).

**Batch V2 — depth and feedback:**
6. Theme membership (`theme_mentions` or batch-id stamping).
7. Retrieval channel repairs (FTS AND→OR+porter, dfts stopwords), then re-run the 5-probe suite as the acceptance test.
8. MEMORY.md synthesizer sanitization + regeneration.
9. Orphan cleanup (obsidian-promoter, weekly digest, memory-promoter decision: wire or delete) + rename the "obsidian-sync" log line.

**Acceptance criteria** (so "done" is observable, per MASTER_PLAN §5): orphan rate < 20%; concept→concept edges > 0 and channel 5 returns non-empty on the probe suite; every concept-note session reference resolves to a session note; a decision made this week appears as a decision note within one consolidation cycle; zero `_Summary not yet generated._` in the top-10 hubs; zero fixture files in the live vault.

---

## 6. Direct answer to the operator's question

*"Is Obsidian onboarding the actual memory with its hyperlinks and the DB mapping of past discussions?"*

**No.** It holds ~6% of entities, 8% of decisions, <1% of themes, and 3% of sessions; its hyperlinks are broken at the YAML, naming, and path layers simultaneously (zero concept-to-concept edges; 76% orphans); its map to past discussions is 107 dangling UUID references with one resolvable target; and at recall time it feeds the retrieval pipeline nothing. What *is* onboarding your memory is the SQLite vector layer — silently doing ~85% of the work — while the knowledge layer above it froze on June 17. The vault's bones (frontmatter data, the decision-note format, the promotion machinery) are sound; the connective tissue was never wired. Batch V1 is where it becomes the graph you intended.
