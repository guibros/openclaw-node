# OpenClaw Memory Plan — Version Log

Append-only per-bump ledger. Every step produces **three** entries (pre, mid, final).

Newest entries land **above** the `NEXT VERSIONS` divider. The final `vX.Y` entry is added
during Phase 9c.

Each entry must answer: when, who, what files, why.

---

## NEXT VERSIONS

Step 0.1 is queued. The first three entries to appear above this divider will be:

- `v0.1-pre`  — Phase 1 audit-pre + version carrier bump
- `v0.1-mid`  — Phase 4 V1 implementation + version carrier bump
- `v0.1`      — Phase 9 close, ledger updates, single commit

(Earlier entries scroll downward as the plan progresses.)
