# AUDIT_PRE — Step 4.2: Generate Obsidian concept notes (frontmatter + LLM body + wikilinks)

## §0 Re-orient

- Where am I: Block 4 (synthesis — the Karpathy wiki), step 2/9, 20/40 overall.
- Last step changed: 4.1 — `runFlush` returns a `synthesis` block; daemon emits `memory.synthesized` at all 3 flush sites.
- This step contributes: the first Obsidian vault artifact — concept notes with frontmatter, LLM-generated body, and `[[wikilinks]]` to related concepts. This IS the Karpathy layer-2.
- Block serves the north star via: DESIGN_INPUTS §1 — "the synthesis layer is the heart, not an afterthought." Concept notes are the wiki pages that synthesize raw entity data into readable, cross-linked documents.
- Still the right next step? Yes — 4.1 wired the event; 4.2 produces the first vault artifact.

## 1. Intent

INVENTORY done-criterion 4.2: *"relevant `concepts/*.md` notes appear with `[[wikilinks]]`."*

The code for generating concept notes already exists (`lib/obsidian-summarizer.mjs`: `generateConceptNotes`). It is comprehensive: queries entities above a mention threshold, builds YAML frontmatter with `[[wikilinks]]` to co-mentioned entities, calls the LLM for a 2-3 sentence body (graceful fallback to data-only), writes notes atomically to `~/.openclaw/obsidian-local/concepts/`. But it is NOT wired into the synthesis pipeline — it is only referenced as step 5 of the consolidation cycle (`lib/consolidation.mjs`), which is INERT (never deployed).

This step wires `generateConceptNotes` into `runFlush` so concept notes are produced alongside MEMORY.md during every LLM synthesis.

## 2. Design decisions

**Privacy.** All 1039 entities have `private=1` (default). No consolidation cycle has ever run to publish items. With `respectPrivacy: true` (default), zero entities qualify for concept notes. The vault at `~/.openclaw/obsidian-local/` is local-only (not synced). The `obsidian-summarizer.mjs` docs say: "Set to false only for a local-only vault that you know isn't synced." Using `respectPrivacy: false` for the local vault is consistent with the design.

**Inline vs. deferred LLM.** Each concept's LLM summary takes 3-10s. Generating all qualifying concepts inline would be too slow. Cap at 10 concepts per flush (`maxConcepts: 10`) — refreshes the top-10 most-mentioned concepts each time. Remaining concepts get notes via consolidation (step 4.6/4.7).

**Carry-forward from 4.1.** Synthesis is coupled to extraction in `runFlush` (extract→store→generate MEMORY.md→concept notes). The `artifacts_written` array in the synthesis return grows to include concept note paths.

## 3. File-delta outline

| File | Delta |
|---|---|
| `lib/pre-compression-flush.mjs` | Import `generateConceptNotes` from `./obsidian-summarizer.mjs`. After MEMORY.md write, call `generateConceptNotes({ db: extractionStore.db, client: llmClient, respectPrivacy: false, maxConcepts: 10 })`. Append concept note paths to `artifacts_written`. Time it and add to `synthesis.duration_ms`. |

## 4. Done-evidence (to produce in AUDIT_POST)

- Full test suite green.
- **Runtime:** drive a real synthesis through the deployed `runFlush`. Concept notes appear in `~/.openclaw/obsidian-local/concepts/` with YAML frontmatter containing `related: [[[wikilink]]]` entries and a body section (LLM-generated or data-only fallback).

## 5. Risk register

| Risk | Mitigation |
|---|---|
| LLM unavailable → no body | `generateConceptSummary` returns null → body shows `_Summary not yet generated._`. Notes still have frontmatter + wikilinks. Acceptable. |
| Too many entities above threshold → slow flush | `maxConcepts: 10` caps at 10 LLM calls. With 12s timeout, worst case ~2 min. Acceptable given flush already takes ~30s for extraction. |
| Vault directory doesn't exist | `ensureVaultStructure` in `generateConceptNotes` creates it idempotently. |
| `atomicWriteFile` failure | Errors propagate to the catch block in `runFlush` → falls back to regex path. Concept note generation is best-effort within the synthesis block. |
