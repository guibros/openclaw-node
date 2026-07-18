# AUDIT_POST — structural cleanups (all four delivered)

**Closed:** 2026-07-17 evening. Execution matched the PRE's model: disjoint-surface subagents,
orchestrator-only git, per-cleanup verification before staging.

## Outcomes

1. **`.mcp.json` paths** — `${HOME}` expansion, zero templating. Commit `ff7a360`.
2. **Fonts** — MC self-hosts Geist via `geist@1.7.2`; identical CSS variables, layout.tsx the
   only source change. Build log + built `.next/static/` both grep-clean of
   fonts.googleapis/gstatic; vendored .woff2 present; tsc 0 / eslint 0 errors / vitest 82/82.
   Commit `88cf91e`. **Escape + fix:** the agent's lockfile (written by local npm 11) pruned
   platform-conditional entries npm 10 needs — CI `npm ci` broke; orchestrator had reviewed the
   churn pre-push and wrongly called it benign. Regenerated with `npx npm@10 install
   --package-lock-only`; `npm@10 ci --dry-run` exit 0; delta vs last-green = geist only. Commit
   `49c6609`, CI observed green. Lesson: lockfile review = run what CI runs, not eyeball the diff.
3. **One memory daemon** — dormant `bin/openclaw-memory-daemon.mjs` deleted; federation wiring
   folded into the live daemon behind `OPENCLAW_FEDERATION=1` (default off, one env-check on the
   default path). Wiring-manifest 23/23 (two independent runs), adjacent suites 67/67, live
   redeploy PID 96152 with 0 `[federation]` boot lines, fed-smoke showed full init under the
   flag. `bin/openclaw-status.mjs` repointed + three alias false-negatives fixed
   (natsConnect/createBudget/new SessionStore) → honest 13 wired / 1 stub / 0 not-wired, exit 0.
   Commit `7dcb79c`.
4. **Installer split** — `install.sh` 1846 → 134-line entrypoint sourcing 9 modules under
   `scripts/install/` (helpers/system-deps/env/workspace/config/components/services/integrations/
   verify), cut along the file's own step boundaries. Per-module extraction byte-diff-verified
   against the pristine original (md5 12e908c1…). `--help` and `--dry-run` byte-identical
   before/after (230-line dry-run output, exit 0 both; orchestrator independently re-diffed
   --help). Write-nothing proof via `-newer` marker on LaunchAgents/systemd/config. New
   `test/install-modules.test.mjs` 7/7 locks module syntax, sourcing, flag inventory, and the
   3 dry-run guards' location. `package.json` files gained `scripts/install/` (orchestrator —
   packed tarball would otherwise break at the first `source`; npm pack verified post-edit).

## Ledgered, not done here
- Pre-existing `--dry-run` side effects (harness-sync, app rebuilds, settings jq-merge) —
  OUT_OF_SCOPE, feeds the queued dry-run-honesty pass; identical before/after so not a split issue.
- MC auth middleware, Next moderate-vuln bump, remaining CI gates, 127 lint warnings — unchanged
  queue from security_review_2.
