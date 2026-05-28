# Decisions Ledger

Append-only. Newest at top. Each entry: date, decision, why, consequences. Referenced by MASTER_PLAN §4.8 and §11.

---

## 2026-05-27 — Master-plan discipline is intentionally repo-scoped to openclaw-nodedev

**Decision:** The master plan, the scope-check hook, and the SCOPE.md contract govern work done **inside the `openclaw-nodedev` repo only.** They are deliberately NOT propagated to other repos (companion-bridge, mission-control) or to the global `~/.claude/CLAUDE.md`. Other Claude Code sessions working in other repos are unbound by this discipline.

**Why:** Operator's explicit choice. The discipline exists to fix the development pattern in *this* repo (the memory infrastructure dev work). Extending the hook to every session everywhere would impose friction on unrelated work the operator doesn't want gated.

**Consequences:**
- A session working in `~/Documents/openclaw infrastructure/companion-bridge/` gets neither the CLAUDE.md pointer nor the scope-check hook. That's intended.
- The MASTER_PLAN's stated scope ("everything in ~/.openclaw") refers to what the plan *documents and reasons about* — not what the enforcement mechanism *gates*. The registry tracks all families; the hook only blocks edits made from within this repo.
- **Do not "fix" this by adding the hook to other repos or the global CLAUDE.md.** It is not an oversight. If the operator later wants broader reach, that's a new decision logged here.

---
