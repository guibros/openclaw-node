# SCOPE — Today's Work Contract

**Status:** done
**Goal:** Make the workplan-viewer emit a banner+sound on plan state transitions — Glass (step moving forward: version advanced / step closed) and Sosumi (a plan became BLOCKED) — by detecting transitions server-side and firing the existing memory-plan-notify.sh. Works whether or not a browser tab is open. Add a notify-test endpoint for verification.
**Closed:** 2026-05-28 — server-side 12s transition poller + fireNotify + /api/notify-test added to workplan-viewer.mjs; restarted (PID 12797), both plans listed (no regression); both test kinds fired (enabled:true); real induced block transition logged `[notify] redesign BLOCKED at v0.0`; first-sight seeds silently.
**Set by:** operator ("viewer emit a sound when a step moves forward, another when blocked, with banner notif")
**Set at:** 2026-05-28T02:05:00-04:00 (Montreal)
**Expires:** 2026-05-28T23:00:00Z

> Prior scope closed + committed: redesign-tick wiring (3c09d07).
**Set by:** operator (chose "Build redesign-tick wiring first")
**Set at:** 2026-05-28T01:40:00-04:00 (Montreal)
**Expires:** 2026-05-28T13:00:00Z

> Prior scope closed + committed: atomicity revision + Re-Orient Loop (f5b5841).
**Set by:** operator ("review steps at most atomic level" + "hook a loop for a global view to counter the attention span deficit")
**Set at:** 2026-05-28T01:10:00-04:00 (Montreal)
**Expires:** 2026-05-28T12:00:00Z

> Prior scope closed + committed: concrete redesign workplan (624babd).
**Set by:** operator ("update a concrete plan for every item ... within the workplan viewer work frame ... 9 phase protocol ... devising a workflow from master plan to implementation")
**Set at:** 2026-05-28T00:40:00-04:00 (Montreal)
**Expires:** 2026-05-28T12:00:00Z

> Prior scope closed + committed: redesign decisions + roadmap (aca225a). Viewer tab (67f263a). Discipline bootstrap (9b81fbd).
**Set by:** operator (answered all 6 §7 questions 2026-05-28)
**Set at:** 2026-05-28T00:10:00-04:00 (Montreal)
**Expires:** 2026-05-28T12:00:00Z

> Prior scopes closed: viewer Master Plan tab (2026-05-27T23:30), design-inputs capture (2026-05-27T23:50). Both committed (9b81fbd, 67f263a).
**Set by:** operator ("yes yes" to both DESIGN_INPUTS.md + OUT_OF_SCOPE.md capture)
**Set at:** 2026-05-27T23:45:00-04:00 (Montreal)
**Expires:** 2026-05-28T08:00:00Z

> Prior scope (viewer Master Plan tab) CLOSED 2026-05-27T23:30 — all 6 runtime-evidence criteria verified. PID 2514→30633, /scope + /registry + /decisions endpoints live, data-tab="plan" + pane-plan in served HTML, legacy /inventory intact (58 rows). Family-8 parser gap caught + fixed mid-verification.
**Set by:** operator (chose "Add new view alongside legacy")
**Set at:** 2026-05-27T23:05:00-04:00 (Montreal)
**Expires:** 2026-05-28T08:00:00Z

## Files allowed to touch (this session)

```files
workspace-bin/workplan-viewer.mjs
memory-plan/SCOPE.md
memory-plan/OUT_OF_SCOPE.md
memory-plan/DECISIONS.md
```

## Runtime evidence required for "done"

1. Viewer relaunched with the feature; still serves :7892 and lists both plans (no regression).
2. `curl 'http://localhost:7892/api/notify-test?kind=forward'` and `?kind=block` fire the banner+sound (osascript/afplay rc 0; operator confirms audibly/visually).
3. A real induced transition: `touch memory-plan/redesign/BLOCKED.md` → the server-side poller detects blocked false→true and fires the block notification (viewer log line + banner); then remove BLOCKED.md.
4. First-sight of a plan does NOT fire (state seeded silently) — no notification storm on viewer start.

## What this scope will do (implementation contract)

1. **Server side** — add new read-only endpoints to `workplan-viewer.mjs`:
   - `/api/plans/<id>/scope` → parsed SCOPE.md: `{ status, goal, set_at, expires, expired (bool), files[], evidence[], override }`
   - `/api/plans/<id>/registry` → parsed COMPONENT_REGISTRY.md: families + components with status badges (LIVE/DEGRADED/STALE/INERT/ABSENT)
   - `/api/plans/<id>/decisions` → DECISIONS.md entries (date + title + body)
   - `/api/plans/<id>/out-of-scope` → OUT_OF_SCOPE.md captured items (or empty if file absent)
   - Each fails gracefully (returns `{present:false}`) when the doc doesn't exist, so legacy plans without these files don't break.

2. **Frontend** — add one tab + one pane:
   - New tab button `data-tab="plan"` labeled "Master Plan", placed first (before "Live")
   - New `<div id="pane-plan" class="pane">` with sections: SCOPE status banner (active/expired, goal, files, evidence checklist), COMPONENT_REGISTRY status grid, DECISIONS ledger, OUT_OF_SCOPE list
   - Client JS to fetch the 4 endpoints and render. Reuse existing markdown/styling where present.

3. **Legacy untouched** — Live/Progress/Steps/Automation/Block/Documents/History tabs unchanged.

## Runtime evidence required for "done"

1. Viewer restarted (kill PID 2514, relaunch) — verified by new PID in `lsof -iTCP:7892`.
2. `curl http://localhost:7892/api/plans/memory-plan/scope` returns parsed SCOPE.md with `status: "active"`.
3. `curl .../registry` returns the 8 families.
4. `curl .../decisions` returns the 2026-05-27 repo-scoped decision.
5. The "Master Plan" tab is present in the served HTML (`curl http://localhost:7892/ | grep 'data-tab="plan"'`).
6. No regression: `/api/plans/memory-plan/inventory` still returns the legacy step rows.

## Notes

- The viewer lives in `workspace-bin/` but is NOT the deployed `~/.openclaw/workspace/bin/` runtime — it's a dev tool run directly from the repo. So "deploy gap" (MASTER_PLAN §4.1) doesn't apply here; the runtime IS this file. Restart = relaunch the node process.
- Prior scope (bootstrap: MASTER_PLAN/REGISTRY/hook/CLAUDE.md/SCOPE) is COMPLETE but UNCOMMITTED. Recommend committing it as its own commit before or after this viewer work. Operator's call on commit timing.
- The bootstrap files (MASTER_PLAN.md, COMPONENT_REGISTRY.md, CLAUDE.md, .claude/*) are intentionally NOT in this scope's files block — this session is viewer-only. If a bootstrap doc needs fixing, that's a scope change.

## How this file works

- **Status:** must be `active` for the hook to allow edits. Set to `done`/`abandoned` when closing.
- **Expires:** ISO-8601 UTC. If now > expires, the hook blocks. Refresh before continuing.
- **`files` block:** one path per line, repo-relative. Exact or shell-glob. `#` comments.
- **Override:** add `**Override:** true` to bypass the hook (operator emergency escape).
