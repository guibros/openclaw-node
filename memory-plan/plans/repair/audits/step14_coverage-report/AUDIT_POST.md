# AUDIT_POST — Step 2.6: Referential coverage report (R9)

(§0: Block 2, step 6/11, 14/48; the measured-number gate for 2.7/2.8/2.9; still-right-next: yes.)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/obsidian-link-checker.mjs` | ✓ | `checkReferentialCoverage({db|dbPath, vaultPath, threshold=5})` — concept coverage (above-threshold entities ↔ concepts/ slugs, missing listed), link resolution % (reuses checkVaultLinks), session-note concept-linkage %. Readonly db, owns/borrows handle cleanly. |
| `bin/vault-check.mjs` | ✓ | `--coverage [--db] [--json]`; rewritten cleanly after a brace-patch misstep. |
| `test/obsidian-link-checker.test.mjs` | ✓ | +1 coverage test (in-memory db × fixture vault); one self-miscounted assertion fixed (2 links, not 3). 8/8 with parity tests. |

## Verification (Phase 5 — the Proof)

Live report vs manual spot-checks, each number reproduced:
- **Concept coverage 67/68 (98.5%)** — eligible 68 = `SELECT COUNT(*) … mention_count >= 5`; the single missing concept (`HEARTBEAT.md`) verified absent from concepts/ on disk.
- **Link resolution 503/1264 (39.8%)** — matches the 2.4/2.5 instrument (same engine).
- **Session linkage 6/7 (85.7%)** — 7 session notes = `ls sessions/*.md | wc -l`.

## Findings (2.9's definition input)

- `decisions/` and `themes/` vault dirs exist (VAULT_SUBDIRS) but contain **0 files** — those referential surfaces were never generated. That, plus the entity-duplication capture from 2.3, defines 2.9's scope (next step in sequence to write its Goal+Proof).
- Concept backfill (2.7) is a single note: HEARTBEAT.md.

## Carry-forwards
- 2.8's queue confirmed: 204 slug-resolvable + 557 dangling (442 of which are `[[sessions/uuid]]`-style — count refined in 2.8's AUDIT_PRE).
