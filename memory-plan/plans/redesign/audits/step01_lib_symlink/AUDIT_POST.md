# AUDIT_POST — Step 0.1: Symlink runtime lib/ → repo lib/

## 1. Files vs plan ledger

| Planned (AUDIT_PRE §4) | Done | Note |
|---|---|---|
| `mv` node_modules → repo | ✓ | 580 MB, same-FS instant rename; gitignored (verified clean) |
| `mv` runtime lib → backup | ✓ | `~/.openclaw/workspace/lib.bak-2026-05-28` (intact, May-23 snapshot) |
| `ln -s` repo lib → runtime | ✓ | `lib -> /Users/moltymac/openclaw-nodedev/lib` |
| AUDIT_PRE/POST | ✓ | this dir |
| INVENTORY flip | ✓ | 0.1 `[ ]` → `[x]` |
| COMPONENT_REGISTRY update | ✓ | Family 8 deploy-gap (lib portion) + 1.1 lib note |
| DECISIONS log | ✓ | node_modules Option A + 0.1 close |

No scope creep. No surprises requiring OUT_OF_SCOPE capture.

## 2. Runtime evidence (MASTER_PLAN §5)

- `readlink ~/.openclaw/workspace/lib` → `/Users/moltymac/openclaw-nodedev/lib` (symlink in place).
- `diff -rq lib/ ~/.openclaw/workspace/lib/` → empty, exit 0 (identical).
- `ps -p 869` → daemon alive, undisturbed (no restart, by design).
- `curl :7893/memory/inject` → HTTP 401 (server up, token-gated).
- `node -e` loads + runs `better-sqlite3` via the runtime symlink path under the daemon's node (`~/.openclaw/bin/node`) → native deps + ABI intact through the symlink. Retrieval's hard dependency proven reachable.

## 3. Carry-forwards to 0.2

- Daemon binary still the May-23 runtime copy (`~/.openclaw/workspace/bin/memory-daemon.mjs`), NOT yet the repo `workspace-bin/memory-daemon.mjs` (they differ). 0.2 swaps it + restarts → first run of new-bin + new-lib together.
- On 0.2 restart, the daemon will load the NEWER repo lib (incl. 11 files absent from the old runtime: broadcast/federation/consolidation/etc.). Those only execute if imported; the new binary defines what's imported. Watch the daemon boot log on 0.2 for missing-import or signature errors.
- Backup `lib.bak-2026-05-28` retained until 0.2 verifies a clean restart, then it can be removed.

## 4. Deep Review Gate

1. Single responsibility (lib symlink only)? ✓
2. No scope creep / no parallel impl? ✓
3. Tests/baseline unaffected (no code changed, only deploy wiring)? ✓ (n/a — no source edits)
4. Reversible? ✓ (backup snapshot + rollback documented)
5. Docs/registry updated? ✓
6. **Runtime evidence cited?** ✓ (§2 above)

PASS → commit.
