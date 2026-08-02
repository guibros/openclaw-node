# AUDIT_PRE — step 4.4 · Scheduler heartbeat authentication

## §0 Re-orient

- Where am I: Block 4, final step, after watcher service verdicts became evidence-bearing.
- This step contributes: browser-independent Mission Control scheduling through the existing auth gate.
- Still the right next step? Yes. The loaded heartbeat has 247 runs and last exit 22 because it POSTs
  the protected mutation route without a token.

## §1 Needs pre-screen

- Operator approval: full runtime-repair block approved 2026-08-02.
- Step 4.3: closed and pushed at `ac5ff89`.
- Mission Control token: `~/.openclaw/config/mc-session-token`, 64 bytes, mode 0600.
- Auth contract: non-GET `/api` requests require the session cookie or matching Bearer token; the
  scheduler POST remains a mutation and must not be made public.
- Current units: launchd and systemd call curl directly with no credentials; launchd last exit is 22.

## §4 Risks

- Supplying the token in curl argv exposes it through process inspection.
- A configurable remote endpoint could turn the helper into a token exfiltration path.
- HTTP success must be checked explicitly; a timer firing is not evidence that a tick executed.
- Installer ownership must precede unit load so a fresh node cannot install a dangling command.

## §6 Intended deltas

- Add a Node one-shot that reads the token internally, permits loopback HTTP only, posts the tick,
  prints bounded result evidence, and exits nonzero on failures.
- Point both service families at the helper and add it to workspace installation.
- Test token handling, loopback restriction, HTTP verdicts, service templates, and installer ownership.
- Deploy helper/unit, restore Mission Control reachability if needed, and observe HTTP 200 plus a
  launchd run-count increment with last exit 0.
