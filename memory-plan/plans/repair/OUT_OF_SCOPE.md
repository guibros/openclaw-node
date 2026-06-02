# Out of Scope — Captured Observations

Things observed while doing repair-plan work that deserve attention later. Agnostic specifications only (MASTER_PLAN §4.3): WHAT + WHY, never HOW. Always-writeable (hook exempt).

---

## 2026-06-02 — Phase 0 bootstrap's memory-maintenance exits 1 while Phase 2's succeeds

- **Observed while:** step 1.1 runtime verification (daemon log 15:37:01).
- **Area:** the daemon's Phase 0 bootstrap subprocess chain (`memory-maintenance failed: exit 1:` — empty error tail) vs the Phase 2 invocation of the same tool, which logged `done` 5 seconds later.
- **Problem:** the bootstrap-context invocation fails where the throttled-work invocation succeeds — likely an environment/argument difference between the two call sites. The failure is logged and swallowed; bootstrap continues.
- **Why it matters:** a silently-failing bootstrap step is the silent-failure class this whole effort targets; if it ever matters (missing daily file, stale recap), nobody will know why.
- **Severity guess:** LOW (Phase 2 covers the work minutes later).
- **Who-touches-next:** whoever works daemon lifecycle (Block 4) — cheap to diagnose while in that file.
