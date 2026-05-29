# AUDIT_PRE — Step 10.1: `bin/spawn-node.mjs` — create isolated openclaw node tree at `~/.openclaw-<nodeid>/`

## §1 — Intent

Implement `bin/spawn-node.mjs`, a CLI tool that creates an isolated openclaw node tree at `~/.openclaw-<nodeid>/` with its own state.db, config, workspace, and directory structure. This enables running N independent openclaw instances on a single dev machine without containers, which is the foundation for all subsequent Block 10 federation validation steps.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 10 | 10.1 | v10.1 | [A] | `bin/spawn-node.mjs` — create isolated openclaw node tree at `~/.openclaw-<nodeid>/` |

## §3 — Design decisions (from prior step's AUDIT_POST §6 + RESUME.md §0)

- Test baseline: 1024 tests (949 pass, 75 fail — 73 pre-existing + 2 flaky variance).
- Block 10 frozen decisions are authored and present in RESUME.md §0.
- Single-machine dev nodes FIRST. Each node gets `~/.openclaw-<nodeid>/` with the same directory structure as `~/.openclaw/`.
- Node identity = ed25519 keypair at `~/.openclaw-<nodeid>/identity.key` — but key generation is Step 10.4's scope. This step only creates the directory placeholder.
- CLI: `spawn-node --id alpha --port 7900`. Idempotent.
- `OPENCLAW_HOME` env var pattern (from `bin/hyperagent.mjs:34`) is the established convention for pointing at a node's root directory.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | better-sqlite3 import might fail in test env | LOW | Use try/catch + skip if not available; but better-sqlite3 is already a project dependency used in many tests |
| 2 | Filesystem permission errors on CI/test | LOW | Tests use `os.tmpdir()` not actual `~/.openclaw-*` paths |
| 3 | Port allocation conflicts | LOW | Port is stored in config but not bound; binding happens at daemon startup (later steps) |

## §5 — Deferrals

- ed25519 key generation → Step 10.4
- NATS cluster wiring → Step 10.2
- Shared stream setup → Step 10.3
- Actual daemon startup within spawned node → later steps

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `bin/spawn-node.mjs` | new | CLI tool: `--id`, `--port`, `--nats-url`, `--base-dir` flags. Creates `~/.openclaw-<id>/` with subdirs (`workspace/`, `workspace/memory/`, `config/`, `obsidian-local/`, `artifacts/`, `logs/`, `state/`). Initializes empty `state.db` via better-sqlite3. Writes `config/node.json` with `{ id, port, nats_url, created_at }`. Idempotent (skip existing dirs/files, never overwrite config). Exports `spawnNode(opts)` for programmatic use + CLI entry. |
| 2 | `test/spawn-node.test.mjs` | new | Tests: idempotent creation, directory structure verification, config file content, state.db initialization, re-run doesn't clobber, missing --id errors, port defaults, programmatic API. Target: ~8-10 `it()` blocks. |
