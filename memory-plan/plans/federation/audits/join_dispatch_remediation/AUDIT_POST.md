# AUDIT_POST — join-path dispatch remediation

**Written:** 2026-07-16T14:23Z (PRE 14:14Z, before the code). **Result:** P0-2 FIXED — reproduced
live BEFORE the fix, fixed by extraction, re-observed live AFTER, plus real-function unit tests.

## Before-evidence (live, the bug as shipped) — repro-before.txt

Cooperative task, the natural grappe config (`min_nodes:3, max_nodes:3`), 3 shell agents (mock
choreography infrastructure, per the chaos-harness D11 boundary). Third join closed recruiting via
`handleCollabJoin`:

```
integrator_order  : []
current_integrator: undefined
status            : completed          ← "completed" garbage
  R1 by null:      {"summary":"(integrator submitted no reflection)","artifacts":[]}
  R2 by undefined: {"summary":"(integrator submitted no reflection)","artifacts":[]}
```

Silent-wrong-protocol completion, exactly as the deep review predicted. (Why every earlier "live
run" missed it: they submitted WITHOUT `max_nodes`, so recruiting always closed via the deadline
sweep — the correct path. The join path had never been exercised with a Block-3 mode.)

## The fix

One dispatch, two callers: the sweep's full 3.1 dispatch (circling validation/roles, cooperative
rotation, collaborative merger/partition, legacy via `isModeImplemented`, fail-loud for unbuilt
modes, below-min abort) extracted to **`startRecruitedSession(session_id)`**;
`handleCollabJoin` and `checkRecruitingDeadlines` both call it. Entry guard fresh-reads and only
proceeds from `RECRUITING` — a join-close and a concurrent sweep tick can't both dispatch. (The
deeper evaluateRound reentrancy remains review P1-6 — separate finding, not silently absorbed.)

Side effect worth naming: the join path's circling branch was ALSO weaker than the sweep's (no
<3-node/role validation, no auto-assign) — unified now.

## After-evidence (live, restarted daemon) — repro-after.txt

Daemon **restarted first** (launchd kickstart, new PID — the running process held the old code; same
drift class the probe remediation hit). Identical submission:

```
integrator_order  : ["alpha","charlie","bravo"]      ← set at close
  R1 by "alpha":   {"summary":"repro work",...}       ← rotation[0] integrates R1
  R2 by "charlie": {"summary":"repro work",...}       ← rotation ROTATES
status            : completed (real artifacts, real integrators)
```

And the fail-loud branch, live: `management` (declared, unbuilt) with min=max=3 →
`status: aborted`, `rounds: 0`, reason `"Mode 'management' not yet implemented"` — where the old
join path silently ran the legacy parallel protocol.

## Tests — the layer that failed is now the layer tested

The daemon was unimportable, so prior tests **replicated** its dispatch (and stayed green through
the divergence). Now: `main()` runs only under `require.main === module`; a `__test` surface exposes
the REAL `startRecruitedSession` with injectable `{collabStore, store, nc}`.
`test/daemon-recruit-dispatch.test.js` (5 tests, all against the daemon's actual function):
cooperative join-close sets rotation; collaborative sets merger/partition; management aborts loudly
+ releases the task; below-min deadline aborts; double-close no-ops (idempotency). **5/5**, and the
adjacent collab/daemon suites **67/67** (no regression). Verified requiring the daemon starts
nothing and exits clean.

## Bookkeeping

- INVENTORY 3.1 row: correction note (its "fail-loud seam closed" claim was sweep-path-only).
- COMPONENT_REGISTRY mesh-task-daemon row: re-verified with this evidence.
- Repro script kept in this audit dir (`repro-join-dispatch.mjs`) with both outputs — rerunnable.
