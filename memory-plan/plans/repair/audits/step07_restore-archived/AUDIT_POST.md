# AUDIT_POST — Step 1.7: Data repair A — restore bug-archived entities

## Plan-vs-actual

Executed exactly per AUDIT_PRE + the three operator decisions. No code files touched (runtime data operation + plan bookkeeping). One transaction, sub-second, on the live state.db while daemon + scheduler ran.

## Verification (Phase 5 — the Proof)

- **Dated backup:** `~/.openclaw/backups/pre-step-1-7-2026-06-03/state.db` (25.6 MB, `sqlite3 .backup` — WAL-consistent).
- **Restoration count:** **941 restored + flagged** (`restored_at = 2026-06-03T05:11Z`); **20 name-collisions left archived, unflagged** (live rows win); live entities 132 → **1073** (= 132+941).
- **Preserved fields:** join-check across all 941 — **0 preservation failures** (name/type/first_seen/last_seen/mention_count byte-identical to archive); salience uniformly 0.5; `last_decayed_at` anchored at restore time; original ids preserved (verified safe: AUTOINCREMENT, sequence 2177 > max archived id 2113, 0 id collisions).
- **Sub-floor check:** 0 live entities below the 0.05 archive floor — nothing re-archives next cycle.

## Findings

- None. The 822 one-off entities are back per the operator's restore-all decision; the fixed decay re-archives genuinely idle ones legitimately (~46 days at 0.5).

## Carry-forwards

- 1.8 recount scope: the 941 restored have NO mention rows (deleted at archive; unrecoverable) — their preserved `mention_count` is the historical baseline. The recount applies to entities WITH rows (the organic 132, whose counts carry R2/R4 inflation).
- entities_archived now means: 20 unflagged rows = superseded-by-re-extraction; flagged rows = bug-era archive, restored.
