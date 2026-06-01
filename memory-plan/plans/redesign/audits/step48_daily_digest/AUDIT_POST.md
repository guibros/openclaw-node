# AUDIT_POST — Step 4.8: Assemble a daily/weekly digest deterministically from the vault

**Closed:** 2026-06-01 (implemented by autonomous tick; runtime-verified + closed by operator) · **Version:** v4.8

## Provenance

Tick implemented + unit-tested (14 new tests), then **blocked at Phase 5b** (correctly): the done-criterion is a *coherence* judgment of generated output, which needs running the generator against the live vault — `node -e` execution outside its sandbox. Operator ran it and read the output.

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE) | Actual | Match |
|---|---|---|
| New `lib/obsidian-digest.mjs` — deterministic digest from vault notes | `parseFrontmatter`, `readVaultDir`, date filters, `buildDigestBody`, `generateDailyDigest`, `generateWeeklyDigest`. Template assembly (no LLM) — reads frontmatter, filters by date, sorts by salience, formats with `[[wikilinks]]`. | ✓ |
| Wire into `runFlush` synthesis path | `import { generateDailyDigest }`; called after session-note generation; failure non-fatal (`try/catch` → stderr warn); `filePath` pushed to `artifacts`. | ✓ |
| Tests `test/obsidian-digest.test.mjs` | 14 new tests; full suite 1473/0. | ✓ |

## 2. Done-evidence (runtime-observable)

INVENTORY criterion 4.8: *a generated digest reads coherently from vault notes (not an hourly buffer dump).*

**MET.** Ran both generators against the live vault (`~/.openclaw/obsidian-local/`, 65 concepts / 4 sessions):

```
DAILY:  { generated:true, filePath:".../daily/2026-06-01.md", sessions:0, concepts:2 }
WEEKLY: { generated:true, filePath:".../daily/2026-06-01-weekly.md", sessions:1, concepts:5 }
```

**Weekly digest content (coherence judged):**
```
---
type: weekly-digest
date: 2026-06-01
start_date: 2026-05-26
sessions: 1
concepts_active: 5
---
# Weekly Digest — 2026-05-26 to 2026-06-01
## Sessions
- [[sessions/2026-05-28-session-ef98ec24]] (2 messages)
## Active Concepts
- [[arcane]] (project, salience: 0.89, mentions: 74)
- [[the-hidden-truth-index-md]] (file, salience: 0.73, mentions: 60)
- [[nats-jetstream]] (technology, salience: 0.63, mentions: 57)
  …
```

Structured frontmatter, dated range, a real session wikilink, active concepts sorted by salience with mention counts and `[[wikilinks]]` — navigable Obsidian content, **not** a buffer dump. The daily reads the same way.

- **Determinism verified:** regenerated the daily twice; content identical modulo the `generated_at` timestamp.

## 3. Carry-forwards

- The digest is the readable replacement for the lossy hourly daily-log writer. **4.9 retires that old writer** — its done-evidence is the old hourly-repeat writer no longer running.
- Digest is wired into the synthesis path (`runFlush`), so it regenerates on each flush; non-fatal on error.
