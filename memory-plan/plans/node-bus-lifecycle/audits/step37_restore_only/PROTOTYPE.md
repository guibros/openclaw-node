# Owned restore-only prototype

Run `node --test test/journal-hold.test.mjs test/restore-only.test.mjs` from
the repository root on macOS. The second suite constructs a private temporary
launchd timer and daemon, captures their actual prior state in the sole
Journal, kills the controller after gate publication, and invokes
`restore_only.py --owned-root <private-fixture> --window owned` in a separate
Python process. It fires the timer through launchd, observes no application
output while the gate is closed, bootstraps the missing saved daemon, verifies the complete
baseline, resolves the journal, then observes the timer run after reopen. The
fixture and owned launchd jobs are removed by the test.
`generate_runtime_evidence.py` reruns this suite and an independent interrupted
hold scenario, writing the test transcript, one captured loaded-timer
`launchctl print`, and a source-hashed JSON result beside this document.
The saved print has only its inherited SSH-agent socket path redacted; the
loaded program, properties, arguments, job environment and schedule are intact.

The command intentionally accepts only roots named
`openclaw-owned-recovery-<16 hex digits>` directly under macOS `$TMPDIR`'s
resolved directory. It accepts no other location or root name. It has no
production mode, no caller-provided adapter, and no
baseline-capture or forward-stop option. A successful `resolved` result means
only that saved prior services and the physical gate were restored. It never
certifies work during the interrupted interval. `partial` means recovery made
some change but did not resolve the journal; the reported physical gate may be
open or closed, so inspect `gate` and `gate_marker`. `refused` means this run
made no gate or journal change; the reported physical gate still needs
inspection. `already-finished` is a read-only terminal report, including
whether the saved receipt head lags the
last terminal record.

The Mac suite also exercises a SIGSTOP-suspended owner, missing and corrupt
durable files, a journal sequence gap, changed service identity, substituted
gate lock, saved receipt drift, an extra private job, a mismatched loaded
timer, malformed or production-shaped plists, unready health, failed durable
writes, and a pre-publication run that holds the gate's
shared lock past the drain deadline. None of those cases authorizes a new
baseline, seal, or production mutation. Receipt drift remains a manual
operator handoff under the existing 3.1 rule. Steps 3.8–3.11 and parent 1.2
remain required for any production preservation flow.

The adapter requires the loaded `program` to equal the pinned first argument
and the launchd `properties` field to include `inferred program`. Its loaded
environment parser currently expects `OSLogRateLimit = 64` on this macOS;
a different launchd rendering refuses recovery rather than guessing readiness.
The complete inherited launch environment is a separate 3.9 prerequisite.

Earlier fixture teardown created persistent `enabled` entries for 333 unique
private test labels in launchd's disabled-service database. They have no loaded
jobs or surviving fixture directories. Current teardown no longer calls
`launchctl enable`, and tests verify no new override entry for each fixture.
