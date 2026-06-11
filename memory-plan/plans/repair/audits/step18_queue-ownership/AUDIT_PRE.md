# AUDIT_PRE — Step 3.2: Queue wait-timeout abandons only its OWN job (R11)

## §0 Re-orient
- Where am I: Block 3, step 2/4, 18/48. Operator "go for step 3"; 3.1's audit is this step's design input (LLM_INFRA.md §3).
- Last step changed: 3.1 — audit (v3.1).
- This step contributes: restores the queue's single-flight invariant — its entire reason for existing.
- Still the right next step? Yes — spec'd to the line by the audit.

## Intent (the two parts, from LLM_INFRA §3)
1. `requestAnalysis`'s timeout path abandons `state.currentJob` without ownership — analysis B timing out while A executes abandons A's slot, drains the next job concurrently with A's still-running fetch, and B's abort cancels nothing (its run never started).
2. B's pending entry survives and later fires an analysis nobody consumes.

## Design
- A per-call `ticket` object threads through opts → enqueueJob entry (`_ticket`) → executeJob's `myJob.ticket`. The timeout path: remove own pending entry by ticket identity (settle it into the void — the race already resolved); abandon the slot ONLY if `currentJob.ticket === ticket` (own running job — where the abort signal actually cancels the fetch).
- `drainPending` defensively drops cancelled entries (ticket.cancelled) before firing.
- Late resolutions land on already-settled races — safe by promise semantics.

## Done-evidence contract (INVENTORY 3.2 Proof)
Regression test: two overlapping analyses, B times out while A runs → A's job NOT abandoned, B's run NEVER invoked, no second concurrent request (queue-state + concurrency-counter assertions); own-job abandonment still works; full suite green.
