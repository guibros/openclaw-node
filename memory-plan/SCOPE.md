# SCOPE — Today's Work Contract

**Status:** done
**Goal:** Fix notifications to be real top-right Notification Center banners (not center-modal display alert). Install terminal-notifier and rewrite memory-plan-notify.sh to post via it (top-right NC banner, -sound Glass/Sosumi), with an osascript `display notification` fallback. Persistence remains a one-time System Settings "Alerts" toggle for the terminal-notifier app — document it.
**Closed:** 2026-05-28 — terminal-notifier 2.0.0 installed; notify.sh posts top-right NC banners (Glass/Sosumi), `display alert` count 0; direct + viewer-path calls fire top-right; persistence toggle + first-run permission documented in DECISIONS.
**Set by:** operator ("I want a top-right NC banner, not a modal" → "install terminal-notifier")
**Set at:** 2026-05-28T16:45:00-04:00 (Montreal)
**Expires:** 2026-05-29T04:00:00Z

> Prior scope closed + committed: notify on/off toggle (e4d4422).
**Set by:** operator ("add a switch in workplan viewer to activate or deactivate the notification")
**Set at:** 2026-05-28T16:25:00-04:00 (Montreal)
**Expires:** 2026-05-29T04:00:00Z

> Prior scope closed + committed: persistent alert windows (907c1f3).
**Set by:** operator ("leave the banner until I discard it" → "both persist")
**Set at:** 2026-05-28T16:05:00-04:00 (Montreal)
**Expires:** 2026-05-29T04:00:00Z

> Prior scope closed + committed: viewer transition notifications (ac52b46).
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
workspace-bin/memory-plan-notify.sh
memory-plan/SCOPE.md
memory-plan/OUT_OF_SCOPE.md
memory-plan/DECISIONS.md
```

## Runtime evidence required for "done"

1. `command -v terminal-notifier` resolves (installed).
2. `memory-plan-notify.sh closed v-test "fwd"` posts a TOP-RIGHT Notification Center banner (not a center modal) with Glass sound — operator confirms position.
3. `memory-plan-notify.sh blocked v-test "blk"` posts a top-right banner with Sosumi sound.
4. `grep -c "display alert" memory-plan-notify.sh` == 0 (the center-modal is gone).
5. Viewer path still drives it: `curl '…/api/notify-test?kind=forward'` posts the top-right banner.
6. README/doc: the one-time persistence toggle (System Settings → Notifications → terminal-notifier → Alerts) is captured in DECISIONS.

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
