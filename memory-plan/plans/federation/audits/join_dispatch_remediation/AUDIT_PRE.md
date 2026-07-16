# AUDIT_PRE — join-path dispatch remediation (P0-2 from the 2026-07-16 deep review)

**Written:** 2026-07-16T14:14Z — before the code changes.

## The finding (code-verified; live repro to follow BEFORE the fix)

Recruiting can close through **two** paths, and only one got the 3.1 mode-dispatch seam:

- **Sweep path** (`checkRecruitingDeadlines`, bin/mesh-task-daemon.js:1715–1790) — CORRECT: circling
  role-validation + assignment, cooperative `integrator_order`/`current_integrator`, collaborative
  `merger_node_id`/partitioned scope, legacy modes via `isModeImplemented`, **fail-loud abort** for
  declared-but-unbuilt modes. Fires when `recruiting_deadline` passes (session listed as RECRUITING).
- **Join path** (`handleCollabJoin`, :768–788) — STALE pre-3.1 binary: `circling_strategy` gets a
  reduced role assignment (no <3-node validation); **everything else falls into legacy
  `startCollabRound`**. Fires synchronously when the Nth join reaches `max_nodes`
  (`isRecruitingDone` :406: `nodes.length >= max_nodes` short-circuits before the deadline).

**Determinism under the natural config:** a 3-node grappe submits `max_nodes: 3` → the third join
closes recruiting via the join path **every time** — the sweep never sees it. Consequences:
cooperative starts with an **empty integrator rotation** and "completes" rounds of
`"(integrator submitted no reflection)"` placeholders; collaborative gets no merger/decomposition;
management (unbuilt) **silently runs the legacy parallel protocol** — the exact
silent-wrong-protocol failure 3.1's fail-loud seam claims to have closed.

**Why every prior "live run" missed it:** the 2.x/3.x runs and my 6.2 generator submitted **without
`max_nodes`** → recruiting always closed via the deadline sweep → correct path. The natural config
was never exercised. (Same class as the quorum bug: the test fed the path that works.)

**Why the tests missed it:** `daemon-circling-handlers.test.js` says it outright — "the daemon isn't
importable as a module, so these tests **replicate** the key decision paths." Replicated logic can't
catch divergence between two real call sites.

## Plan

1. **Reproduce live FIRST** (before-evidence): cooperative task with `min_nodes:3, max_nodes:3`,
   3 shell agents (mock infrastructure — this tests choreography, not worker quality, per the D11
   boundary the chaos harness already uses) → observe join-close → `cooperative.integrator_order`
   EMPTY + placeholder integrations.
2. **Fix by extraction**: one `startRecruitedSession(sessionId)` containing the full sweep dispatch;
   both call sites call it. Entry guard: fresh-read + `status === RECRUITING` (defensive against
   join/sweep double-fire; the deeper evaluateRound reentrancy is review P1-6, a separate finding).
3. **Make the daemon importable for tests**: wrap `main()` in `require.main === module`; export the
   real dispatch under `__test` with injectable store/nc context. New test calls the **real
   function** — no replication: cooperative → rotation set; collaborative → merger set; management →
   loud abort + task released; below-min → abort.
4. **Re-run the live repro** (after-evidence): rotation populated, real integrations, completion; and
   a management-mode submit aborts loudly instead of running legacy.
5. Existing `collab-mode-dispatch.test.mjs` updated only if its assertions encode the old split.

## Contract

No inference closes. Before/after runtime evidence in the commit trailer. COMPONENT_REGISTRY mesh
row updated. INVENTORY 3.1 row gets a correction note (its "seam closed" claim was sweep-path-only).
