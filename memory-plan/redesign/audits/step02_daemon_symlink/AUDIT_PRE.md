# AUDIT_PRE — Step 0.2: Symlink runtime daemon binary → repo; restart

## §0 Re-orient (micro)

- **Where am I:** Block 0 (L0 deploy gap + NATS), step 2/4, 2/36 overall.
- **Last step changed:** 0.1 symlinked runtime `lib/` → repo `lib/` (deps moved, daemon left running on old in-memory code).
- **This step contributes:** swaps the daemon *binary* to the repo copy and restarts — the first time new-bin + new-lib run together. Completes the code half of the deploy-gap close.
- **Block serves the north star via:** MASTER_PLAN §4.1 "Code on disk ≠ shipped" — after this, the running daemon IS the repo HEAD.
- **Still the right next step?** Yes. INVENTORY first `[ ]` (0.2). NATS (0.3/0.4) comes after.

## 1. Intent

Make `~/.openclaw/workspace/bin/memory-daemon.mjs` a symlink → repo `workspace-bin/memory-daemon.mjs`, then restart via launchd so the running process executes the current code against the (0.1-symlinked) current lib. Scope: the daemon binary + restart only.

## 2. Pre-flight risk verification (all done read-only, all cleared)

| Risk | Finding | Verdict |
|---|---|---|
| New binary imports lib files absent from old runtime | imports `../lib/{shared-event-stream,federation-resilience}.mjs` — both now present via 0.1 symlink | CLEARED |
| Module-load crash from bare imports | binary's only static imports are node builtins; all third-party (nats/zod) are lazy (`createRequire`/dynamic) | CLEARED |
| Symlink → repo realpath shifts node_modules resolution to repo tree | repo `node_modules` has nats, zod, better-sqlite3 | CLEARED |
| Native ABI mismatch (better-sqlite3) under daemon node | repo `better-sqlite3` loads + runs a query under `~/.openclaw/bin/node`; it's what session-store/extraction-store use | CLEARED |
| Dead `NODE_PATH=/Users/moltymac/openclaw/...` | path doesn't exist; deps resolve via repo tree walk-up; harmless (old daemon ran with it too) | CLEARED |
| NATS-down boot crash | new binary catches NATS-unavailable (line 1179) and continues; event-log/federation are lazy | CLEARED |

## 3. Risk register (residual)

| Risk | Likelihood | Mitigation |
|---|---|---|
| New code behaves differently at runtime (logic, not imports) | Medium | restart and watch .err for NEW error classes; rollback ready |
| Crash-loop after restart | Low | KeepAlive + ThrottleInterval 10s; verify PID stable >10s; rollback = restore old binary + kickstart |
| Data corruption from new code | Low | full WAL-safe DB security copy taken (`~/.openclaw/backups/pre-step-0.2-2026-05-28/`, integrity_check ok) |

## 4. Done-evidence refinement (must log in DECISIONS)

The INVENTORY done-evidence says "after restart a log line only current code emits appears." Verified impossible at 0.2: the old/new startup banners are byte-identical, and **every** new-only log line is gated behind a successful NATS connection (lines 1117/1136/1138 etc.), which won't happen until NATS is up (0.4). Substitute evidence per MASTER_PLAN §5 ("a process state visible in ps/launchctl that only the new code creates"):

- `readlink` shows the binary is the repo file.
- Restart yields a new PID executing that symlinked repo file, stable past ThrottleInterval (no crash-loop).
- Clean boot: no new error class in `.err` beyond the known pre-existing Zod extraction baseline.
- The NATS-gated new-only lines ("Shared stream OPENCLAW_SHARED verified") are deferred confirming evidence at 0.4.

## 5. File-delta outline

**Filesystem (Bash, not gated):**
- `mv ~/.openclaw/workspace/bin/memory-daemon.mjs ~/.openclaw/workspace/bin/memory-daemon.mjs.bak-2026-05-23`
- `ln -s ~/openclaw-nodedev/workspace-bin/memory-daemon.mjs ~/.openclaw/workspace/bin/memory-daemon.mjs`
- `launchctl kickstart -k gui/<uid>/ai.openclaw.memory-daemon`

**Repo paperwork (gated, in SCOPE):**
- this `AUDIT_PRE.md` + `AUDIT_POST.md`
- `INVENTORY.md` — flip 0.2 `[ ]` → `[x]`
- `COMPONENT_REGISTRY.md` — Family 8 deploy gap (binary now closed); 1.1 status
- `DECISIONS.md` — 0.2 close + the done-evidence refinement
