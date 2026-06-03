# AUDIT_PRE — Step 1.7: Data repair A — restore bug-archived entities

## §0 Re-orient
- Where am I: Block 1, step 7/8, 7/48 overall. Operator-driven (decisions taken 2026-06-03 via AskUserQuestion).
- Last step changed: 1.6 (v1.6); chain blocked here by design; precondition met (overnight post-fix cycles: Decayed 24–45 / 0 archived / Reinforced 0 — steady state).
- This step contributes: undoes the R1 bug's data loss — 961 entities archived in hours instead of weeks.
- Block serves the north star via: the vault referential system (Block 2) needs its referents back.
- Still the right next step? Yes.

## Operator decisions (locked)
1. **Scope: all 941** (961 minus 20 name-collisions — live rows win; collisions stay archived, unflagged).
2. **Salience 0.5 + last_decayed_at = restore time** (fresh idle clock; archived values are sub-floor and would re-archive in one cycle; 1.8 rebaselines uniformly).
3. **Flag, don't delete:** `entities_archived.restored_at` column stamps the audit trail.

## Facts verified pre-repair
- entities is `INTEGER PRIMARY KEY AUTOINCREMENT`; sqlite_sequence=2177 > max archived id 2113; **0 archived ids held by live rows** → original ids restore safely (traceability preserved).
- 0 F-P212 bad-data rows in the archive (no exclusion needed).
- Mentions of archived entities were deleted at archive time — **unrecoverable**; historical `mention_count` column preserved as-is (informs 1.8's recount scope).
- Live=132, archived=961 at start.

## Plan
1. Dated backup: `sqlite3 .backup` → `~/.openclaw/backups/pre-step-1-7-2026-06-03/state.db`.
2. One transaction: guarded `ALTER TABLE entities_archived ADD COLUMN restored_at`; `INSERT INTO entities (explicit columns, salience=0.5, last_decayed_at=now, embedding NULL)` from non-colliding unflagged archive rows; stamp `restored_at` on the restored set.
3. Verify per Proof: counts, preserved-field samples, flag counts; report.

## Risk register
- Scheduler may fire mid-repair: transaction is sub-second; WAL + busy_timeout cover it. Next cycle will decay the 941 by ~nothing (fresh anchors) — no re-archive risk at 0.5.
- MEMORY.md/vault ranking now includes 941 restored entities at default salience — by design (D7); mention_count ordering keeps organic entities on top.
