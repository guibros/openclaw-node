# SCOPE — protocol plan

**Status:** active
**Goal:** Operator-directed 2026-06-15: lock the node watch-target list as a spec and build the
**watcher** that fills in the REAL per-element status (WORKING / BROKEN / OFF / UNKNOWN). Honesty
invariant: never WORKING without an observed signal; unimplemented/unobservable => UNKNOWN (never
green); intentionally-off => OFF. Read-only probes only in watch mode (no synthetic writes per tick).
Reuses the node-acceptance probes/health-check (no parallel impl, MASTER_PLAN §4.6). Verified with
mocked unit tests; NOT run against the live node.
— CLOSED 2026-06-15: `docs/NODE_WATCH_SPEC.md` (locked list + verdict model), `lib/node-watch.mjs`
(registry + honest verdicts + read-only probes), `bin/node-watch.mjs` (one-shot + `--watch`),
`openclaw-node-watch` bin + `node-watch` script, `test/node-watch.test.mjs` (12 tests). All 43 node-*
tests green. 3 honest UNKNOWN-stubs: vault links, calendar, cloud-LLM-reachability. NOT run on live node.
**Addendum 2026-06-15:** reopened to add an HTML dropdown view to the watcher engine (`formatHtml` +
`--html`) listing every checked item + its result, with a detail panel. Files already in scope below.
— CLOSED 2026-06-15: `formatHtml` (self-contained page; `<select>` grouped by family via `<optgroup>`,
option per item = "STATUS — label", detail panel, color-coded) + `--html`/`--html-out` flags. 14 watch
tests green (2 new). Sample rendered to /tmp/node-watch-sample.html from mock data. NOT run on live node.
**Addendum 2026-07-03 (operator-directed, interactive session):** P0 remediation from the
2026-07-03 deep review: (1) fix C1 — memory daemon cross-wired to two DBs (`createExtractionStore`
silently ignores `opts.db`; extraction writes → state.db while consolidation/federation read the
0-byte extraction.db); (2) fix the four C7 node-watch bugs (deploy-drift cwd false-green, hardcoded
node id in plist, `--axis` false-ACCEPT, axis snapshot clobber) + atomic snapshot write + tick
overlap guard, then commit the 15-day-old node-watch working tree; (3) refresh CLAUDE.md
"Where we are" + AGENTS.md to match reality (repair complete at v7.8, not BLOCKED).
**Set at:** 2026-07-03 (operator-directed, interactive session)
**Expires:** 2026-07-10T23:59:00Z

```files
docs/NODE_WATCH_SPEC.md
docs/NODE_ACCEPTANCE.md
bin/openclaw-memory-daemon.mjs
lib/extraction-store.mjs
test/extraction-store.test.mjs
CLAUDE.md
AGENTS.md
lib/node-watch.mjs
lib/node-acceptance.mjs
lib/node-acceptance-probes.mjs
bin/node-watch.mjs
bin/node-acceptance.mjs
test/node-watch.test.mjs
test/node-acceptance.test.mjs
test/node-acceptance-probes.test.mjs
package.json
mission-control/src/app/api/node-watch/route.ts
mission-control/src/app/diagnostics/page.tsx
mission-control/src/lib/scheduler.ts
mission-control/src/app/api/scheduler/status/route.ts
mission-control/src/app/node-watch/page.tsx
mission-control/src/components/layout/sidebar.tsx
services/launchd/ai.openclaw.node-watch.plist
services/systemd/openclaw-node-watch.service
services/service-manifest.json
```

## Prior closed scopes (retained for history)

- 2026-06-15: built node-acceptance harness (bin/lib/node-acceptance*, 31 mocked tests) — the test-mode gate.
- 2026-06-15: `docs/NODE_ACCEPTANCE.md` design draft delivered.
- 2026-06-03 (Block 2 — conformance): all six viewer surfaces + 9-phase + Goal/Needs/Feeds/Verify.
  CLOSED v2.4: 2.1 68a78fe · 2.2 09babba · 2.3 39c24a8 · 2.4 final; silo CONFORMANT 15P/1W/0F.

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
