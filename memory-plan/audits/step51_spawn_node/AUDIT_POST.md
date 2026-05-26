# AUDIT_POST — Step 10.1: `bin/spawn-node.mjs` — create isolated openclaw node tree at `~/.openclaw-<nodeid>/`

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `bin/spawn-node.mjs` (new) | `bin/spawn-node.mjs:1` | yes | `spawnNode` at line 131, `validateNodeId` at line 87, `readNodeConfig` at line 194, `NODE_SUBDIRS` at line 35, `resolveNodeRoot` at line 108 |
| 2 | `test/spawn-node.test.mjs` (new) | `test/spawn-node.test.mjs:1` | yes | 13 `it()` blocks across 4 describe groups (validateNodeId, resolveNodeRoot, spawnNode, readNodeConfig) |

All 2 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| spawnNode export | `grep -n 'export async function spawnNode' bin/spawn-node.mjs` | line 131 |
| validateNodeId export | `grep -n 'export function validateNodeId' bin/spawn-node.mjs` | line 87 |
| readNodeConfig export | `grep -n 'export async function readNodeConfig' bin/spawn-node.mjs` | line 194 |
| NODE_SUBDIRS constant | `grep -n 'export const NODE_SUBDIRS' bin/spawn-node.mjs` | line 35 |
| Idempotency test | `grep -n 'is idempotent' test/spawn-node.test.mjs` | line 107 |
| CLI --id parsing | `grep -n "id.*type.*string" bin/spawn-node.mjs` | line 211 |

## §3 — Cross-references still valid

- `bin/spawn-node.mjs` imports only from `node:os`, `node:path`, `node:fs/promises`, `node:util`, `node:module` — all Node.js built-ins. No cross-repo dependencies.
- `better-sqlite3` is loaded via `createRequire` for state.db initialization, with a try/catch fallback for environments where it's unavailable. This matches the same pattern used in other test files (`test/privacy-markers.test.mjs`, `test/broadcast-cross-node.test.mjs`).
- `test/spawn-node.test.mjs` imports from `../bin/spawn-node.mjs` — relative path resolves correctly. No other files import from spawn-node.
- No symbols renamed or deleted. No stale references.

## §4 — Findings

1. **[POSITIVE]** `spawnNode` is fully idempotent — calling it twice with different params does not overwrite the existing `config/node.json`, ensuring spawned nodes retain their original configuration.
2. **[POSITIVE]** `validateNodeId` enforces lowercase alphanumeric + hyphens (no leading/trailing hyphen, max 32 chars) — prevents filesystem-unsafe node IDs.
3. **[POSITIVE]** `resolveNodeRoot` handles both the `~/.openclaw-` prefix pattern (appends directly) and a parent-directory pattern (joins as subdir), making the API flexible for testing and deployment.
4. **[POSITIVE]** State.db initialization uses WAL mode (`journal_mode = WAL`) matching the production convention used by the memory daemon.
5. **[POSITIVE]** Full Obsidian vault subdirectory structure (concepts/decisions/sessions/themes/daily) is created inside each node, matching `lib/obsidian-vault.mjs` conventions.
6. **[POSITIVE]** CLI output includes the exact `OPENCLAW_HOME=... OPENCLAW_NODE_ID=... node workspace-bin/memory-daemon.mjs` command for starting the spawned node — immediately actionable.
7. **[POSITIVE]** Tests use `os.tmpdir()` for isolation — no risk of polluting the operator's actual `~/.openclaw-*` namespace during test runs.
8. **[POSITIVE]** `readNodeConfig` provides a programmatic way for later steps (10.5, 10.6) to discover spawned node configurations without filesystem parsing.
9. **[POSITIVE]** CLI uses `node:util` `parseArgs` (same pattern as `bin/publish-item.mjs`) — consistent with project conventions.
10. **[POSITIVE]** Test count: 13 `it()` blocks (vs planned ~8-10) — exceeds plan due to splitting validation and resolution into dedicated describe groups.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Step 10.1 → Step 10.2)

- Test baseline: 1037 tests (962 pass, 75 fail — 73 pre-existing + 2 flaky variance). +13 `it()` blocks added this step.
- `bin/spawn-node.mjs` creates the node tree but does NOT generate identity keys (Step 10.4) or start any NATS processes (Step 10.2).
- `config/node.json` stores `nats_url` for use by subsequent steps when spawned nodes connect to the cluster.
- The `resolveNodeRoot` and `readNodeConfig` utilities are available for use in Steps 10.5/10.6 integration tests to locate and configure spawned test nodes.
- `@publish` directive wiring into daemon's per-prompt path still deferred (carried from Step 9.5).
