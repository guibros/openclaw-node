# Owned restore-only prototype

Run `node --test test/journal-hold.test.mjs test/restore-only.test.mjs` from
the repository root on macOS. The second suite constructs a private temporary
launchd timer and daemon, captures their actual prior state in the sole
Journal, kills the controller after gate publication, and invokes
`restore_only.py --owned-root <private-fixture> --window owned` in a separate
Python process. It observes the timer produce no application output while the
gate is closed, bootstraps the missing saved daemon, verifies the complete
baseline, resolves the journal, then observes the timer run after reopen. The
fixture and owned launchd jobs are removed by the test.

The command intentionally accepts only roots named
`openclaw-owned-recovery-<16 hex digits>` directly under the system temporary
directory. It has no production mode, no caller-provided adapter, and no
baseline-capture or forward-stop option. A successful `resolved` result means
only that saved prior services and the physical gate were restored. It never
certifies work during the interrupted interval. `partial` means the gate is
still closed and the journal unresolved; `refused` requires inspecting the
reported physical gate state and preserved journal. `already-finished` is a
read-only terminal report, including whether the saved receipt head lags the
last terminal record.

The Mac suite also exercises a SIGSTOP-suspended owner, missing and corrupt
durable files, a journal sequence gap, changed service identity, substituted
gate lock, saved receipt drift, an extra private job, unready health, a failed
restoration-intent write, and a pre-publication run that holds the gate's
shared lock past the drain deadline. None of those cases authorizes a new
baseline, seal, or production mutation. Receipt drift remains a manual
operator handoff under the existing 3.1 rule. Steps 3.8–3.11 and parent 1.2
remain required for any production preservation flow.
