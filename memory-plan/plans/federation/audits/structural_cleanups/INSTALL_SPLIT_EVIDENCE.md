# Structural cleanup 4/4 — install.sh modular split (2026-07-17)

Security-review-2 item (d): split the monolithic install.sh into sourced modules, behavior-identical.
All claims below are observed on this machine (macOS lead node); raw outputs live beside this file.

## What changed

install.sh (1846 lines) → 134-line entrypoint + 9 modules in scripts/install/, each a byte-identical
extraction of a contiguous section of the original, sourced in original order via
`source "$REPO_DIR/scripts/install/<name>.sh"` (REPO_DIR = dirname of install.sh, so sourcing is
relative to the entrypoint's own directory). New wiring lock: test/install-modules.test.mjs.

## Module map (orig line ranges, byte-diff-verified in extraction_fidelity_proof.txt)

| module | orig lines | content |
|---|---|---|
| (install.sh keeps) | 1-76, 128-133, 1808-1846 | shebang/set -euo pipefail, flag parsing + --help, OS banner, Done! summary |
| helpers.sh (49) | 78-126 | colors, info/warn/error/step, run() incl. dry-run cp/rsync source guards, detect_os, OS= |
| system-deps.sh (178) | 135-312 | Step 1: node (>=22 check), python3, git, sqlite3, build-essential, curl, jq, pip/pyyaml, scrot, nats-server, ollama; whole block gated by ! $UPDATE_ONLY |
| env.sh (76) | 314-389 | NODE_BIN/NATS_SERVER_BIN/NPM_BIN resolution, repo npm deps, node role + node ID, OPENCLAW_NATS defaults, claude_project_path() leading-dash slug + CLAUDE_PROJECT_* exports |
| workspace.sh (190) | 391-580 | Steps 2-6: dirs, workspace-bin + repo-bin cherry-picks (-ef guard), workspace lib + mcp-knowledge deps, packages, node_modules symlinks, mesh home bin/lib, identity files, souls, skills + skill deps |
| config.sh (227) | 582-808 | Steps 7-8.5: openclaw.env create/parse, OPENCLAW_NATS_TOKEN generation, LLM env defaults, generate_config() + daemon/transcript/nats{,-1,-2,-3}/obsidian/openclaw renders, --cluster-peers block (tailscale auto-detect for --cluster-bind, 0.0.0.0 refusal, OPENCLAW_NATS_CLUSTER_PASS generation, cluster dry-run guard), ed25519 identity, deploy-trust provisioning |
| components.sh (401) | 810-1210 | Steps 8.6-15.5: LLM backend (ollama/RAM-tier/pull/embedder), boot manifest, obsidian vault, Mission Control, playwright, companion-bridge + harness rules, agent frontend, clawvault, memory init heredocs, hyperagent |
| services.sh (308) | 1212-1519 | Steps 16-16.5: manifest-driven unit render (launchd + systemd, envsubst/sed) with the 3 F4 dry-run guards + check_rendered fail-loud audit + lifecycle (--enable-services), notifications + notifier/launcher builds |
| integrations.sh (253) | 1521-1773 | Steps 17-20: mesh network, install_rule + path-scoped rules, plan templates, Claude Code settings jq-merge + hooks + git hooks |
| verify.sh (32) | 1775-1806 | Step 21: acceptance gate (node-acceptance.mjs, GATE_STATE) |

Dropped: only the 11 inert blank seam lines between ranges. Added: 9 source lines + layout blanks.
No BASH_SOURCE anywhere; $0 uses are message-only (unchanged under `source`); the only "$@" is
inside run(); no external code references installer-internal functions (grepped).

## Flag inventory (unchanged; locked by the test)

--dry-run · --update · --skip-mesh · --enable-services · --skip-llm · --skip-verify ·
--skip-frontend · --verify-frontend · --sandbox (implies --skip-llm --skip-mesh --skip-frontend) ·
--role=lead|worker · --cluster-peers=A,B · --cluster-bind=IP · --help/-h

Env consumed: OPENCLAW_ROOT, OPENCLAW_NODE_ROLE, OPENCLAW_NODE_ID, OPENCLAW_NATS(_TOKEN),
OPENCLAW_NATS_CLUSTER_PASS, OPENCLAW_NATS_SERVER_VERSION, OPENCLAW_MESH_HOME,
OPENCLAW_LAUNCHD_DIR, OPENCLAW_SYSTEMD_DIR, OPENCLAW_TIMEZONE, MESH_LLM_PROVIDER, LLM_MODEL,
LLM_BASE_URL, plus every key=value in openclaw.env (safe parse).
Env generated/exported: NODE_BIN, NATS_SERVER_BIN, NPM_BIN, OPENCLAW_NODE_ROLE/ID, OPENCLAW_NATS,
OPENCLAW_NATS_TOKEN (openssl rand -hex 32 when absent, persisted), OPENCLAW_NATS_CLUSTER_PASS,
OPENCLAW_KV_REPLICAS, CLAUDE_PROJECT_{WORKSPACE,HOME,REPO}, OPENCLAW_WORKSPACE, OPENCLAW_REPO_DIR,
OPENCLAW_DEPLOY_TRUSTED_KEYS, OPENCLAW_TIMEZONE, MESH_LLM_PROVIDER, LLM_MODEL, LLM_BASE_URL.

## Verification (all observed; raw files in this dir)

1. `bash -n` install.sh + all 9 modules → 10/10 OK (bash_n_after.txt; baseline install.sh OK too).
2. `bash install.sh --help` before vs after → byte-identical, exit 0 both (installer_help_*.txt).
3. `bash install.sh --dry-run` (no other flags, repo cwd, live node) before vs after →
   **byte-identical 230-line output, exit 0 both** (installer_dryrun_*.txt; diff empty).
4. Write-nothing proof for the guarded render targets, after-run (dryrun_write_nothing_proof.txt):
   `find ~/Library/LaunchAgents -name 'ai.openclaw.*' -newer <pre-run marker>` → 0;
   `~/.config/systemd/user` → 0; `~/.openclaw/config` type f → 0; all 23 ai.openclaw.*.plist
   mtimes unchanged across BOTH runs vs the pre-baseline snapshot.
5. `node --test test/install-modules.test.mjs` → 7/7 pass (install_modules_test_run.txt):
   bash -n locks, source-order lock, flag inventory via live --help + parser grep, the 3
   unit-render dry-run guards counted ==3 in services.sh (0 left in install.sh), cluster
   guard/0.0.0.0 refusal/cluster-pass gen/deploy-trust in config.sh, claude_project_path slug in
   env.sh, Node -ge 22 in system-deps.sh.
6. Existing tests referencing install.sh: `grep -rln "install\.sh" test/` → none exist, nothing to
   re-run (wiring-manifest.test.mjs has no install refs).

## Known caveats (captured in OUT_OF_SCOPE.md 2026-07-17)

- package.json "files" lacks scripts/install/ → the npm-tarball/npx flow (cli.js → packed
  install.sh) breaks at first `source` until `"scripts/install/",` is added. Observed via
  `npm pack --dry-run`: install.sh packs, scripts/ does not. package.json was outside this batch's
  allowed surface — NOT edited.
- --dry-run's five pre-existing unguarded side-effect sites (harness-sync apply, hyperagent status,
  notifier/launcher app rebuilds, settings.json jq-merge + hook recopies) fired identically in both
  baseline runs; content-idempotent here (settings/harness diffed identical). Pre-dates the split;
  now grep-isolated per module for the queued dry-run-honesty pass.
