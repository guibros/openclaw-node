# SCOPE — Today's Work Contract

**Status:** done
**Goal:** Redesign step 0.2 — symlink runtime daemon binary `~/.openclaw/workspace/bin/memory-daemon.mjs` → repo `workspace-bin/memory-daemon.mjs`, restart via launchd, confirm the current code runs cleanly (new-bin + new-lib together, first time).
**Set at:** 2026-05-28
**Expires:** 2026-05-29T06:00:00Z

> Step 0.1 per `redesign/INVENTORY.md` (Block 0). Filesystem ops (mv/ln) are
> Bash, not gated. The files below are the step's paperwork: the AUDIT_PRE/POST,
> the inventory flip, the registry status update, and the decisions log.

## Done-evidence (runtime-observable, MASTER_PLAN §5)

- Runtime `~/.openclaw/workspace/bin/memory-daemon.mjs` IS a symlink → repo
  `workspace-bin/memory-daemon.mjs`.
- Daemon restarted: new PID (≠ 869), executing the symlinked repo file, stable
  past the 10s ThrottleInterval (no crash-loop; launchctl shows it loaded).
- Clean boot: no NEW error classes in `.tmp/memory-daemon.err` beyond the known
  pre-existing Zod extraction baseline; :7893 responds.
- **Done-evidence refinement (logged in DECISIONS):** the binaries' startup
  banners are byte-identical and every new-only log line is NATS-gated — so a
  "current-code-only log line" is not observable until NATS is up (0.4). Substitute
  per §5: process executes the repo file via symlink (a state only the new code
  creates). The NATS-gated lines ("Shared stream OPENCLAW_SHARED verified") become
  confirming evidence at 0.4.

## Plan (shown before each runs)

1. `mv` runtime binary → `bin/memory-daemon.mjs.bak-2026-05-23` (in-place rollback;
   also already in the security copy).
2. `ln -s` repo `workspace-bin/memory-daemon.mjs` → runtime `bin/memory-daemon.mjs`.
3. `launchctl kickstart -k` the daemon; capture new PID.
4. Verify: new PID stable >10s, executes repo file, :7893 answers, no new errors.

Rollback: `rm` the symlink; `mv` the backup binary back; `launchctl kickstart -k`.
Full data rollback available in `~/.openclaw/backups/pre-step-0.2-2026-05-28/`.

```files
memory-plan/redesign/audits/step02_daemon_symlink/**
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
