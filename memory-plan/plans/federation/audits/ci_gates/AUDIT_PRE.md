# AUDIT_PRE — remaining CI gates (queue item 4)

**Written:** 2026-07-18 evening, before the workflow edit. Review F7's list minus what already
exists: lint gate LIVE, install-modules + wiring tests already in the root suite.

## Gates added (each proven locally first, same invocation)
1. **MC production build** — `npm run build` in mission-control-tests (green 3+ times today:
   agent run, orchestrator deploy build, live tree build).
2. **npm audit, high threshold** — root: observed `found 0 vulnerabilities` exit 0; MC: the 2
   known moderates sit below `--audit-level=high` → observed exit 0 (the moderate fix needs the
   breaking Next bump, separately queued — the gate catches NEW highs without blocking on that).
3. **Packed-tarball smoke** — `npm pack --dry-run` + grep asserts: install.sh, all 9
   scripts/install modules, packages/event-schemas/dist present (the two past packaging escapes,
   both found post-hoc — F6 and the installer split's files-array gap). Runs on the node-22
   matrix leg only.

## Deliberately NOT added
- **installer --dry-run on ubuntu** — unproven cross-OS (baseline captured on macOS; system-deps
  probes differ). Needs one branch-PR test run before it can gate main. Ledgered.

## Verify
The gates prove themselves on their own first CI run — push, observe all jobs green, confirm the
new steps executed (not skipped) in the run log.
