# AUDIT_PRE — Step 5.1: Set up per-node Obsidian vault structure under ~/.openclaw/obsidian-local/

**Version:** v5.1-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Set up the per-node Obsidian vault infrastructure. Create a library module that ensures the vault directory structure exists at `~/.openclaw/obsidian-local/` (or operator-overridden path via `OBSIDIAN_VAULT_PATH` env var) with the 5 required subdirectories: `concepts/`, `decisions/`, `sessions/`, `themes/`, `daily/`. This is the foundational filesystem layer for Steps 5.2–5.5 which populate, parse, cache, and promote vault content.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [A] | Set up per-node Obsidian vault structure under ~/.openclaw/obsidian-local/ |

## §3 — Design decisions (consumed from prior step's AUDIT_POST §6)

Carry-forwards from Step 4.9 (Block 4 close) AUDIT_POST §6:

- Test baseline is now 685 tests (608 pass, 77 fail — 73 pre-existing + 4 flaky). +14 tests added last step.
- `.claude/hooks/pre-compact.sh` still needs manual operator update to delegate to `hooks/claude-code/pre-compact.sh` (sandbox constraint across Steps 4.7-4.9). Not relevant to this step.
- Health-watch launchd plist not created — deferred from Step 4.8. Not relevant to this step.
- `EXTRACT_SUBJECT` duplicated between `lib/extraction-trigger.mjs:16` and `lib/publishers/publish-helper.mjs:18`. Not relevant to this step.
- `bin/openclaw-restart.sh` still needs `chmod +x`. Not relevant to this step.
- Block 4 validation gate (24h health-watch) explicitly waived per Block 5 frozen decisions.

Block 5 frozen decisions (RESUME.md §0):

- **Vault location:** `~/.openclaw/obsidian-local/` (per-node, outside repo, gitignored). Override via `OBSIDIAN_VAULT_PATH` env var.
- **Subdirectory layout:** `concepts/`, `decisions/`, `sessions/`, `themes/`, `daily/`.
- **NOTE:** REFERENCE_PLAN says `memory/` but Block 5 frozen decisions say `daily/` — frozen decisions govern.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Vault path outside repo — tests creating dirs in `~/.openclaw/` pollute real environment | LOW | Tests use `os.tmpdir()` for isolated temp vault paths. |
| 2 | Path resolution on Windows vs macOS/Linux | LOW | Use `node:os` `homedir()` + `node:path` `join()` for cross-platform paths. No hardcoded `/`. |

No HIGH-severity risks.

## §5 — Deferrals

- README.md files in each subdir: deferred. Empty dirs with `.gitkeep` are sufficient for this step. Steps 5.2–5.5 populate content.
- `.obsidian/` config directory: not created — operator sets up Obsidian app config manually.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/obsidian-vault.mjs` | new | `DEFAULT_VAULT_PATH` constant (resolves `~/.openclaw/obsidian-local/` via `os.homedir() + path.join`). `VAULT_SUBDIRS` array constant (`['concepts', 'decisions', 'sessions', 'themes', 'daily']`). `getVaultPath(opts)` function reading `OBSIDIAN_VAULT_PATH` env var with fallback. `ensureVaultStructure(vaultPath)` async function creating vault root + all subdirs with `{ recursive: true }`. Returns `{ vaultPath, created: string[] }` listing newly created dirs. |
| 2 | `test/obsidian-vault.test.mjs` | new | ~6 tests: DEFAULT_VAULT_PATH value, VAULT_SUBDIRS content + count, getVaultPath default, getVaultPath env override, ensureVaultStructure creates all dirs, ensureVaultStructure idempotent. |
