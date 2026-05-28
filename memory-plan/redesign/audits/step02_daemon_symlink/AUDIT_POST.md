# AUDIT_POST — Step 0.2: Symlink runtime daemon binary → repo; restart

## 1. What was done

- `mv ~/.openclaw/workspace/bin/memory-daemon.mjs` → `…/memory-daemon.mjs.bak-2026-05-23` (in-place rollback copy; also in security copy).
- `ln -s ~/openclaw-nodedev/workspace-bin/memory-daemon.mjs` → runtime `bin/memory-daemon.mjs`.
- `launchctl kickstart -k gui/<uid>/ai.openclaw.memory-daemon` — old PID 869 → new PID 51216.

## 2. Done-evidence (runtime-observable, all confirmed)

| Evidence | Result |
|---|---|
| `readlink` runtime binary | → `/Users/moltymac/openclaw-nodedev/workspace-bin/memory-daemon.mjs` ✓ |
| New PID executing the repo file | 51216 (≠ 869), `ps` shows it running `…/workspace/bin/memory-daemon.mjs` ✓ |
| Stable past ThrottleInterval (10s) | alive 2:48+, same PID throughout — no crash-loop ✓ |
| Inject server up | `:7893/memory/inject` → HTTP 401 (auth-gated, listening) ✓ |
| Clean boot log | "Daemon starting (pid: 51216)", "Extraction store initialized", "[inject-server] listening …" ✓ |
| No new error class | `.err` frozen at 1602 lines, mtime = restart instant (16:34:10); zero growth from new process ✓ |

## 3. The two restart-instant error lines (investigated, benign)

At the restart instant (`.err` mtime 16:34:10) two lines appeared, both attributable to the **old** process (869) being torn down, NOT the new code:

```
libc++abi: terminating due to uncaught exception of type std::__1::system_error: mutex lock failed: Invalid argument
[memory-daemon] PID check failed (process not alive): kill ESRCH
```

- `mutex lock failed` (count: 1) — old process's better-sqlite3 native binding hit a mutex while being killed mid-operation by SIGTERM. A shutdown-path artifact of the dying old process, not a property of new-bin+new-lib.
- `kill ESRCH` — the watchdog/launchd observing 869 is gone.

Proof these are not the new code: after these lines (written at the restart instant) the new PID 51216 ran 2:48+ and added **zero** further `.err` lines, with the inject server responding. The `.err` file size and mtime have been frozen since the restart.

## 4. Carry-forward to next step (0.3 / 0.4)

- NATS-gated new-only log lines ("Shared stream OPENCLAW_SHARED verified") remain deferred confirming evidence — they fire only once NATS is up (0.4). The daemon currently logs `NATS unavailable (TIMEOUT) — continuing` and runs fine without it, as designed.
- Pre-existing Zod extraction-validation errors (`Invalid option: expected one of "depends_on"|…`) persist in `.err` as the known baseline — unrelated to the deploy gap; a separate extraction-schema issue to triage later (OUT_OF_SCOPE candidate).

## 5. Verdict

Code half of the deploy gap is **closed**: the running daemon binary AND its lib are now the repo HEAD (symlinks). First clean co-execution of new-bin + new-lib confirmed. Block 0 remainder is NATS (0.3 install, 0.4 connect).
