# SCOPE — Today's Work Contract

**Status:** done
**Goal:** Redesign step 0.1 — close the `lib/` deploy gap: make runtime `~/.openclaw/workspace/lib` a symlink to repo `lib/`, preserving mcp-knowledge's native deps (DECISIONS: node_modules Option A — move the box). **CLOSED 2026-05-28** — see DECISIONS + audits/step01_lib_symlink/AUDIT_POST.md. Next: step 0.2.
**Set at:** 2026-05-28
**Expires:** 2026-05-29T05:00:00Z

> Step 0.1 per `redesign/INVENTORY.md` (Block 0). Filesystem ops (mv/ln) are
> Bash, not gated. The files below are the step's paperwork: the AUDIT_PRE/POST,
> the inventory flip, the registry status update, and the decisions log.

## Done-evidence (runtime-observable, MASTER_PLAN §5)

- Runtime `~/.openclaw/workspace/lib` IS a symlink → repo `lib/`.
- `diff -rq lib/ ~/.openclaw/workspace/lib/` returns empty.
- Daemon (PID 869) still alive; :7893 still responds; one retrieval still
  returns through the symlinked mcp-knowledge (proves native deps intact).
- No restart in 0.1 (restart belongs to 0.2). "Still boots" = running daemon
  undisturbed + new wiring proven correct.

## Plan (filesystem ops, shown before each runs)

1. `mv` runtime `lib/mcp-knowledge/node_modules` → repo (same-FS instant rename).
2. `mv` runtime `lib` → `lib.bak-2026-05-28` (intact rollback snapshot).
3. `ln -s` repo `lib` → runtime `lib` (the switch).
4. Verify: PID alive, :7893 answers, a retrieval returns.

Rollback: `rm` the symlink; `mv` the backup back; `mv` node_modules back if needed.

```files
memory-plan/redesign/audits/step01_lib_symlink/**
memory-plan/redesign/INVENTORY.md
memory-plan/COMPONENT_REGISTRY.md
memory-plan/DECISIONS.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
  `idle` / `done` / anything else → the hook blocks (forces a fresh scope).
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked. Refresh before continuing.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
