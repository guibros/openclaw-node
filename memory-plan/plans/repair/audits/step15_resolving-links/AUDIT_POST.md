# AUDIT_POST — Step 2.8: Generators emit only resolving wikilinks (R9)

(§0: Block 2, step 8/11, 16/48; the headline fix — the referential system's links now resolve; still-right-next: yes.)

## Sub-decision (logged per the Proof): link-only-existing, no stubs
A referential system links what exists. Sessions without notes render as plain text (`- session <id>`); related-entity links are emitted only for targets on disk or generated in the same run. Stub notes (442 would have been needed) rejected as noise.

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/obsidian-summarizer.mjs` | ✓ | `aliases: ["<name>"]` in concept frontmatter (what makes name-style `[[links]]` resolve against slug filenames); `related:` filtered to resolvable targets (disk ∪ current run); session links resolve to the real note basename via new `buildSessionNoteResolver` or render as text. |
| `lib/obsidian-link-checker.mjs` | ✓ | Path-style targets (`[[sessions/note]]`) resolve by basename — exactly Obsidian's behavior; the digest's correct links were being misclassified. |
| One-time vault migration | ✓ | Script preserved at `audits/step15_resolving-links-migration.mjs`: 66 notes aliased, 72 files repaired — 10 session links pointed at their real notes, 300 phantom session refs unlinked to text, 239 ghost related-links dropped. Atomic writes throughout. |
| `test/obsidian-summarizer.test.mjs` | ✓ | 2 old tests locked the dangling behaviors — converted; +2 new (related filtering, resolver behavior). 44/44 across the four affected files. |

## Verification (Phase 5 — the Proof)

- **Vault-wide:** 739/739 wikilinks resolved (**100%**, was 503/1264 = 39.8% this morning), **0 slug-resolvable, 0 dangling** (was 204 + 557).
- **Fresh post-change generation** (deployed writer, real LLM, `openclaw-tui`): note carries `aliases`, filtered related, resolving/text session lines — **0 dangling links** in the new note; vault stays 739/739.

## Findings
- Orphans 28 → 25 (side effect of link repairs); orphan triage belongs to 2.9/later — orphans are reachability, not validity.

## Carry-forwards
- The promoter's shared-vault frontmatter (separate builder) still emits unfiltered name-links — federation-era surface, rides with the P.3 OUT_OF_SCOPE entry.
- vault_integrity on the next live flushes should read dangling=0 — a regression in that metric now means a generator broke.
