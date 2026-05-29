# AUDIT_POST — Step 5.1: Set up per-node Obsidian vault structure under ~/.openclaw/obsidian-local/

**Version:** v5.1-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/obsidian-vault.mjs` (new) — DEFAULT_VAULT_PATH, VAULT_SUBDIRS, getVaultPath, ensureVaultStructure | `lib/obsidian-vault.mjs:13` (DEFAULT_VAULT_PATH), `:16` (VAULT_SUBDIRS), `:23` (getVaultPath), `:34` (ensureVaultStructure) | yes | `grep -n 'export' lib/obsidian-vault.mjs` → 4 exports |
| 2 | `test/obsidian-vault.test.mjs` (new) — ~6 tests | `test/obsidian-vault.test.mjs` (8 `it()` blocks) | yes | `grep -c 'it(' test/obsidian-vault.test.mjs` → `8` |

2 of 2 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'DEFAULT_VAULT_PATH' lib/obsidian-vault.mjs` | `13:export const DEFAULT_VAULT_PATH = join(homedir(), '.openclaw', 'obsidian-local');` |
| 2 | `grep -n 'VAULT_SUBDIRS' lib/obsidian-vault.mjs` | `16:export const VAULT_SUBDIRS = ['concepts', 'decisions', 'sessions', 'themes', 'daily'];` |
| 3 | `grep -n 'export function getVaultPath' lib/obsidian-vault.mjs` | `23:export function getVaultPath(opts = {}) {` |
| 4 | `grep -n 'export async function ensureVaultStructure' lib/obsidian-vault.mjs` | `34:export async function ensureVaultStructure(vaultPath) {` |
| 5 | `grep -c 'it(' test/obsidian-vault.test.mjs` | `8` |

## §3 — Cross-references still valid

- `lib/obsidian-vault.mjs` imports: `homedir` from `node:os`, `join` from `node:path`, `mkdir`/`stat` from `node:fs/promises` (all Node.js built-ins). No external dependencies.
- `test/obsidian-vault.test.mjs` imports: `DEFAULT_VAULT_PATH`, `VAULT_SUBDIRS`, `getVaultPath`, `ensureVaultStructure` from `../lib/obsidian-vault.mjs`. All 4 imports resolve.
- No pre-existing symbols renamed or deleted.
- No existing imports modified.
- No new dependencies added to `package.json`.

## §4 — Findings

- [POSITIVE] `DEFAULT_VAULT_PATH` uses `os.homedir()` + `path.join()` for cross-platform resolution — no hardcoded `/` separator.
- [POSITIVE] `VAULT_SUBDIRS` matches Block 5 frozen decisions exactly: `['concepts', 'decisions', 'sessions', 'themes', 'daily']`. REFERENCE_PLAN had `memory/` but frozen decisions override to `daily/`.
- [POSITIVE] `getVaultPath(opts)` follows standard precedence: explicit opts > env var > default. Clean, testable.
- [POSITIVE] `ensureVaultStructure` is idempotent — uses `mkdir({ recursive: true })` and checks existence before reporting `created` dirs. Safe to call repeatedly.
- [POSITIVE] `ensureVaultStructure` returns `{ vaultPath, created }` — callers can inspect what was actually created vs already existed.
- [POSITIVE] All tests use `os.tmpdir()` for temp vault paths — no pollution of real `~/.openclaw/` environment.
- [POSITIVE] Test count: 8 `it()` blocks — covers constants (3), getVaultPath (3), ensureVaultStructure (2).
- [POSITIVE] All 8 new tests pass. Test count: 693 (616 pass, 77 fail — unchanged baseline of 77 pre-existing + flaky failures).
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 said "~6 tests". Actual: 8 `it()` blocks. Phase-4-correction streak: 0 (Block 5; reset).

8 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Step 5.2

- Test baseline is now 693 tests (616 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added this step.
- `DEFAULT_VAULT_PATH` exported from `lib/obsidian-vault.mjs:13` — resolves to `~/.openclaw/obsidian-local/`.
- `VAULT_SUBDIRS` exported from `lib/obsidian-vault.mjs:16` — `['concepts', 'decisions', 'sessions', 'themes', 'daily']`.
- `getVaultPath(opts)` exported from `lib/obsidian-vault.mjs:23` — resolves vault path with env override.
- `ensureVaultStructure(vaultPath)` exported from `lib/obsidian-vault.mjs:34` — creates all subdirs.
- Step 5.2 will import these to locate the vault and ensure structure before writing concept notes.
- Concept-note threshold is `mention_count >= 5` per Block 5 frozen decisions (override via `OBSIDIAN_CONCEPT_THRESHOLD` env var).
- Body generation uses hybrid data + LLM (same Ollama/Qwen3 stack from Block 3) with fallback to data-only.
