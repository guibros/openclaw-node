# Retire the obsolete system-domain mesh agent

This is a prepared operator action, not a record that it ran. Federation D4
already approves retirement of `com.openclaw.agent`; node-state recovery D22
requires its durable disposition before a full-node preservation journal. The
ordinary `uninstall.sh` is too broad for this action because it also unloads
other OpenClaw services.

## Exact target and preflight

At 2026-10-02 08:35 EDT, the only target is
`/Library/LaunchDaemons/com.openclaw.agent.plist`, SHA-256
`eaa61962d86643d3fa301875b2f65e5fa8c97fd37468840ddabcb1a5f9701351`,
regular root:wheel mode 0644. It declares label `com.openclaw.agent`,
`RunAtLoad=true`, `KeepAlive=true`, `UserName=moltymac`, and arguments
`/usr/local/bin/node /Users/moltymac/openclaw/agent.js`. The script is absent.
The system-domain job is enabled, loaded, repeatedly exits 1, and was observed
with run count above 3,600. `/private/var/db` is root:wheel 0755; the proposed
`/private/var/db/openclaw-retired-jobs` backup directory does not exist.
At 08:49 EDT the root handoff marker and ledger were absent; the local node
receipt was `restored` for a prior `timer-commissioning` scope, not an active
full-node window. Recheck these immediately before applying the action.

At 2026-10-02 08:54 EDT, the plist hash and ownership still matched, the
entry file was still absent, and `launchctl print` reported 3,848 runs with
last exit code 1. Noninteractive administrator access was unavailable (`sudo:
a password is required`). No root action was attempted.

Immediately before any mutation, repeat the hash, ownership, mode, plist
semantics, missing entry file, and loaded-label checks. Refuse if any differs.
Also require that no full-node preservation or root NATS transfer is active.
The current full-node preflight already refuses this job, and no such window
has been started. Do not run this procedure while a window is unresolved.

## Root action, in order

The operator must unlock administrator access locally; never enter a password
in chat. Run each command only after the previous command and its evidence
check succeeds. Use the absolute commands and paths shown below, and do not
run the repository uninstaller.

1. Create `/private/var/db/openclaw-retired-jobs` as root:wheel 0700. Copy the
   exact plist into it as `com.openclaw.agent.plist.original`, root:wheel 0600.
   Read back that copy and require the SHA-256 above before changing launchd.

   ```sh
   sudo /usr/bin/install -d -o root -g wheel -m 0700 /private/var/db/openclaw-retired-jobs
   sudo /usr/bin/install -o root -g wheel -m 0600 /Library/LaunchDaemons/com.openclaw.agent.plist /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original
   sudo /usr/bin/shasum -a 256 /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original
   ```

2. Persistently disable `system/com.openclaw.agent` with `/bin/launchctl
   disable`, then boot it out with `/bin/launchctl bootout`. Require the label
   absent from `launchctl print` and from the system-domain service listing;
   also require no process still executing the absent `agent.js` path.

   ```sh
   sudo /bin/launchctl disable system/com.openclaw.agent
   sudo /bin/launchctl bootout system/com.openclaw.agent
   /bin/launchctl print-disabled system
   /bin/launchctl print system/com.openclaw.agent
   ```

   The last command must fail because the job is no longer loaded.

3. Move the original plist into the same protected directory as
   `com.openclaw.agent.plist.retired`; require both protected copies have the
   original SHA-256, the installed path is absent, and the disabled override
   remains set. Sync the filesystem before reporting completion.

   ```sh
   sudo /bin/mv /Library/LaunchDaemons/com.openclaw.agent.plist /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   sudo /usr/bin/shasum -a 256 /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   /bin/sync
   ```

4. Re-run the 23-unit full-node entrypoint preflight. It must still recognize
   the exact idle Tailscale helper exclusion and have no unclassified job.
   Recheck the approved LaunchAgents, NATS processes/ports, and system-domain
   labels for unintended changes. This preflight is structural only; it does
   not authorize a preservation window or the NATS migration.

If any step fails, leave the agent disabled, preserve both the original plist
and the observed partial state, and diagnose before retrying. Do not
automatically revive a missing-code KeepAlive job. A future explicit reversal
can restore the pinned plist and re-enable/bootstrap its exact label, but that
would reintroduce the known crash loop and requires a new operator decision.
The next reboot must confirm that the job remains absent and disabled; until
then the runtime claim is limited to the current boot.
