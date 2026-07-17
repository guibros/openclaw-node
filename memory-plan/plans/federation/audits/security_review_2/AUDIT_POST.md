# AUDIT — security review 2 (external deployment/security audit, 2026-07-17)

All 7 findings VERIFIED against code + runtime before acting (PRE folded into this file — the
review itself served as the finding list; each was independently confirmed).

## Fixed + verified this batch

**F1 (P0) — Mission Control exposed node secrets without auth. LIVE finding:** the running MC was
bound to `*:3000` (all interfaces), and `/api/memory-file`'s jail (~/.openclaw) CONTAINS
`openclaw.env` (every API key), `identity.key`, tokens; plus 38 unauthenticated mutation routes
incl. POST /api/system/restart.
- `next start -H 127.0.0.1` in MC's start script (fixes every invocation path). **Verified:
  listener now `127.0.0.1:3000`** (was `*:3000`).
- Secret-path denylist in `/api/memory-file` (env files, `identity.key` by basename anywhere,
  `*token*`, `*secret*`, `.pem`, `config/nats*`, `identity/`). **Verified live:
  `?path=openclaw.env` → 403 "secret path denied"; legit `workspace/MEMORY.md` still served.**
- Full auth middleware = QUEUED (loopback bind is the trust boundary today — the same model as the
  inject server :7893; adding token auth to 38 routes is its own design task).

**F2 (P0-fleet) — deploy triggers accepted unsigned by default.** Both deploy-listener units now set
`OPENCLAW_REQUIRE_SIGNED_DEPLOY=1` + `OPENCLAW_DEPLOY_TRUSTED_KEYS`; install.sh provisions the
trust allowlist from the node's own `identity.pub` (operator appends other machines' keys for
fleets); the render var added to the sed fallback lists. Listener is not running on this box
(loaded, dead), so no live drill — fail-closed is now the shipped default.

**F3 (P1) — production vulns.** `npm audit fix --omit=dev` → **0 vulnerabilities** (was 1 critical
protobufjs + 2 high + 7 moderate). Verified the fix did NOT touch the transformers/onnxruntime
embedder chain (lockfile diff has zero lines for those packages) and `@huggingface/transformers`
still loads. MC retains 2 moderates requiring a BREAKING Next bump (`npm audit fix --force`) —
QUEUED deliberately, not forced blind.

**F4 (P1) — `--dry-run` wrote real service units.** Three raw `envsubst > $DEST` redirects bypassed
`run()`'s guard. All three sites now short-circuit under dry-run. **Verified: full
`install.sh --dry-run` run → unit mtimes UNCHANGED, 19 "[dry-run] would render" lines.**

**F5 (P1) — impossible Node version matrix.** Root `engines` >=18 → **>=22**; installer check 18 →
22 with the reason in the warn (MC requires 22).

**F6 (P1) — npx artifact shipped without required runtime code.** `packages/event-schemas/dist` was
excluded (workspace + gitignore) while `lib/event-schemas.mjs` imports it. Fixed: `packages/` +
explicit dist entries in `files`, `prepack` builds workspaces, `.npmignore` overrides the gitignore,
and typescript added as a real devDependency of the workspace (the build script's bare `tsc`
resolved to the npx decoy package — the dist on disk predated the tree ever being able to build it).
**Verified: `npm pack --dry-run` now carries 96 event-schemas dist files.**

## Queued honestly (not silently absorbed)

- **F7 (P2) CI gates:** adding a lint job today = permanent red (106 errors / 53 warnings in MC).
  Order: lint cleanup → then gate lint + MC build + installer dry-run + `npm audit` + packed-artifact
  smoke in CI.
- MC auth middleware (F1 follow-up) + the 2 moderate MC vulns (breaking Next bump).
- Reviewer optimizations: consolidate live/dormant memory daemons; split the 1,8xx-line installer;
  self-host Geist fonts; replace operator-specific `.mcp.json` paths.

## Environmental note
Full root suite after all changes: **1850/1852, 1 skip, 1 fail — `embed-benchmark` latency
(1334ms vs 500ms target) under box load-average 18–20 with llama mid-flush.** Not a regression:
the audit fix touched no embedder packages; the target was calibrated on an idle box. CI skips this
test (no embed model on runners).
