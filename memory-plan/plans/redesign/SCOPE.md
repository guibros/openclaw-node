# SCOPE — redesign plan

**Status:** done
**Goal:** Step 4.2 — Generate Obsidian concept notes (frontmatter + LLM body + wikilinks). Wired `generateConceptNotes` into `runFlush` synthesis path. Concept notes produced alongside MEMORY.md. Runtime verified: concept notes generated from production state.db with YAML frontmatter, `[[wikilinks]]`, and LLM body (qwen3:8b).
**Set at:** 2026-05-30
**Expires:** 2026-05-31T06:00:00Z

```files
lib/pre-compression-flush.mjs
# audit artifacts
memory-plan/plans/redesign/audits/step42_obsidian_concept_notes/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step42_obsidian_concept_notes/AUDIT_POST.md
# plan state
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
