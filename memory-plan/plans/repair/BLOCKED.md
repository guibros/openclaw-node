# BLOCKED — repair chain at step 1.7

**When:** 2026-06-02 16:16 Montreal · carrier at v1.6
**Why:** 1.7 (restore bug-archived entities) and 1.8 (rebaseline salience/mention_count) are `operator`-driver steps by design — irreversible writes to live state.db (restore policy, baseline values, archived-row disposition are operator decisions per their INVENTORY Proofs).

**Chain delivered before blocking:** 1.1–1.6 closed, each with runtime evidence (DECISIONS entries, audits/step01–06, commits da12671→12d4568). All three mention-count inflators (R1 decay, R2 reinforcement, R4 re-extraction) are off; turn provenance valid (R5); MEMORY.md atomic (R39); tick single-flighted (R3). Suite 1499/0; daemon running v1.6 (PID 19302).

**Before starting 1.7:** let one live consolidation cycle complete post-fix (last completed cycle 15:05 was pre-fix; the 16:04–16:14 cycles skipped on Ollama-busy). Expected signature: one cycle `Decayed: ~110 / Reinforced: ~102` (anchoring + credit seeding), then steady-state `Decayed: ~0 / Reinforced: 0`. Then 1.7/1.8 per their Proof lines (backup first).

**To resume:** operator drives 1.7 interactively (or directs otherwise). Delete this file when work resumes.
