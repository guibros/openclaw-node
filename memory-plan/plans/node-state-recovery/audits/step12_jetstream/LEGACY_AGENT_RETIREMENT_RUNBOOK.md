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

At 09:06 EDT, `/etc/sudoers.d/openclaw-mesh` was also present as root:wheel
0440 (227 bytes). `sudo -n -l` showed three legacy passwordless grants:
`/bin/launchctl load *`, `/bin/launchctl unload *`, and
`/usr/bin/killall -9 node`. These can undermine a durable retirement. The
file's contents and hash require administrator access and have not been read;
they must be inspected before its separate cleanup below.

Immediately before any mutation, repeat the hash, ownership, mode, plist
semantics, missing entry file, and loaded-label checks. Refuse if any differs.
Also require that no full-node preservation or root NATS transfer is active.
The current full-node preflight already refuses this job, and no such window
has been started. Do not run this procedure while a window is unresolved.
The pinned plist hash is authoritative for all of its contents, including its
saved NATS URL; do not substitute a hand-copied key list for that hash.

Hold the existing node preservation lock exclusively throughout the entire
preflight, administrator action, and post-action census. It is currently a
regular `moltymac:staff` 0600 file inside the owner-private preservation
directory. On this Mac, `/usr/bin/lockf` uses the same BSD `flock(2)` lock as
the journal; `-n` refuses an absent file, `-t 0` refuses an active owner, and
`-k` leaves the lock pathname intact. Start a nested shell with:

```sh
/usr/bin/stat -f '%Su:%Sg %Lp %N' /Users/moltymac/.openclaw/preservation/node.lock
/usr/bin/lockf -kn -t 0 /Users/moltymac/.openclaw/preservation/node.lock /bin/zsh -l
```

Run every following command inside that shell and exit it only after the
post-action checks. If lock acquisition fails, do nothing. Recheck the
receipt and root paths while holding it; a pre-lock observation cannot rule
out a preservation controller starting in between.

Run these checks as the node user inside the locked shell before opening an
administrator session:

```sh
printf '%s  %s\n' eaa61962d86643d3fa301875b2f65e5fa8c97fd37468840ddabcb1a5f9701351 /Library/LaunchDaemons/com.openclaw.agent.plist | /usr/bin/shasum -a 256 -c -
/usr/bin/stat -f '%Su:%Sg %Lp %N' /Library/LaunchDaemons/com.openclaw.agent.plist
/usr/bin/plutil -lint /Library/LaunchDaemons/com.openclaw.agent.plist
/bin/test ! -e /Users/moltymac/openclaw/agent.js
/bin/test ! -e /private/var/db/openclaw-retired-jobs
/bin/test ! -e /private/var/db/openclaw-nats/writer-handoff.json
/bin/test ! -e /private/var/db/openclaw-nats-ledger
/bin/test ! -e /private/var/db/openclaw-nats-outcomes
/bin/launchctl print system/com.openclaw.agent
/bin/launchctl print-disabled system
python3 -c 'import json,pathlib; d=json.loads((pathlib.Path.home()/".openclaw/preservation/node.lock.state.json").read_text()); assert d["status"] == "restored" and d["baseline"]["scope"] == "timer-commissioning"'
```

Each line must have the expected result: the plist is root:wheel 0644, the
job is loaded and enabled, and all `test ! -e` checks succeed. An unexpected
preflight result ends this procedure. Capture the current NATS launchd and
process census with `python3 bin/nats-live-census.py` from the repository,
recording its output in an owner-private file outside Git. Repeat that same
census after the action and investigate any unexpected change; live stores
may advance while their servers run, so file counts alone are not an
equality test.

## Root action, in order

The operator must unlock administrator access locally; never enter a password
in chat. Run each command only after the previous command and its evidence
check succeeds. Use the absolute commands and paths shown below, and do not
run the repository uninstaller.

1. Create `/private/var/db/openclaw-retired-jobs` as root:wheel 0700 only if
   it is still absent. Copy the
   exact plist into it as `com.openclaw.agent.plist.original`, root:wheel 0600.
   Refuse if either copy destination exists. Read back that copy and require
   the SHA-256 above before changing launchd. Never overwrite evidence from
   a partial earlier attempt.

   ```sh
   sudo /bin/test ! -e /private/var/db/openclaw-retired-jobs
   sudo /usr/bin/install -d -o root -g wheel -m 0700 /private/var/db/openclaw-retired-jobs
   sudo /bin/test ! -e /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original
   sudo /bin/test ! -e /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   sudo /usr/bin/install -o root -g wheel -m 0600 /Library/LaunchDaemons/com.openclaw.agent.plist /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original
   sudo /usr/bin/shasum -a 256 /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original
   ```

2. Persistently disable `system/com.openclaw.agent` with `/bin/launchctl
   disable` and verify its override says disabled before booting it out. Then
   boot it out with `/bin/launchctl bootout`. Judge the observed result by
   requiring the label absent from `launchctl print` and the system listing;
   also require no process still executing the absent `agent.js` path.

   ```sh
   sudo /bin/launchctl disable system/com.openclaw.agent
   /bin/launchctl print-disabled system
   sudo /bin/launchctl bootout system/com.openclaw.agent
   /bin/launchctl print system/com.openclaw.agent
   /bin/launchctl print system
   /usr/bin/pgrep -fl '^/usr/local/bin/node /Users/moltymac/openclaw/agent.js$'
   ```

   Both the exact-label `print` and `pgrep` must find nothing. A nonzero
   `bootout` exit is ambiguous: stop and inspect those physical results. Do
   not move the plist until the disabled override and absence are proven.

3. Move the original plist into the same protected directory as
   `com.openclaw.agent.plist.retired`, then set that moved file to 0600. Require
   both protected copies have the original SHA-256, are root:wheel, the
   installed path is absent, and the disabled override remains set. Sync the
   filesystem before reporting the daemon retired.

   ```sh
   sudo /bin/mv /Library/LaunchDaemons/com.openclaw.agent.plist /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   sudo /bin/chmod 0600 /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   sudo /usr/bin/shasum -a 256 /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   /bin/test ! -e /Library/LaunchDaemons/com.openclaw.agent.plist
   /bin/launchctl print-disabled system
   /bin/sync
   ```

4. Re-run the 23-unit full-node entrypoint preflight **as the node user**. It
   reads that caller's uid and home for the GUI and user domains. From the
   repository root:

   ```sh
   PYTHONPATH=memory-plan/plans/node-state-recovery/audits/step12_jetstream python3 -c 'from preservation_checks import capture_entrypoint_inventory; from preservation_journal import UNITS; assert capture_entrypoint_inventory(UNITS)["verified"] is True'
   ```

   It must still recognize
   the exact idle Tailscale helper exclusion and have no unclassified job.
   Repeat the pre-action NATS census, compare approved LaunchAgents,
   processes/ports, and system-domain labels for unintended changes. Save
   boot identity, the two protected hashes, disabled override, preflight
   result and a hash of each private census in an owner-private evidence file;
   repeat the verification after the next reboot. This structural success
   does not authorize a preservation window or the NATS migration.

## Retire the legacy sudoers grant

The daemon retirement is incomplete as a protected boundary while the
`openclaw-mesh` passwordless wildcard grants remain. In the same local
administrator session, inspect `/etc/sudoers.d/openclaw-mesh` and confirm its
only effective entries are the three grants above. Refuse any unexpected
rule. Pin its current hash, require root:wheel 0440, and require both
`openclaw-mesh.sudoers.original` and `.retired` destinations absent. Copy it
into the 0700 retirement directory as root:wheel 0600, verify the copied
hash, then move the installed file there as `.retired` and set it to 0600.
Run `/usr/sbin/visudo -c` and `sudo -l` as the node user; the three
passwordless grants must be gone. Preserve its original hash and both copies
in the private evidence. Do not remove the file blindly if it grants anything
else. This cleanup does not change the user-domain LaunchAgents, which load
without those root sudo grants.

After reviewing the root-readable contents and recording the hash, use these
commands only if the file has exactly the expected scope:

```sh
sudo /usr/bin/stat -f '%Su:%Sg %Lp %z %N' /etc/sudoers.d/openclaw-mesh
sudo /usr/bin/cat /etc/sudoers.d/openclaw-mesh
sudo /usr/bin/shasum -a 256 /etc/sudoers.d/openclaw-mesh
sudo /usr/sbin/visudo -c
sudo /bin/test ! -e /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original
sudo /bin/test ! -e /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired
sudo /usr/bin/install -o root -g wheel -m 0600 /etc/sudoers.d/openclaw-mesh /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original
sudo /usr/bin/shasum -a 256 /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original
sudo /bin/mv /etc/sudoers.d/openclaw-mesh /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired
sudo /bin/chmod 0600 /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired
sudo /usr/bin/shasum -a 256 /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired
sudo /usr/sbin/visudo -c
sudo -l
/bin/sync
```

If any step fails, leave the agent disabled, preserve both the original plist
and the observed partial state, and diagnose before retrying. Do not
automatically revive a missing-code KeepAlive job. A future explicit reversal
can restore the pinned plist and re-enable/bootstrap its exact label, but that
would reintroduce the known crash loop and requires a new operator decision.
The next reboot must confirm that the job remains absent and disabled and the
sudoers grant remains absent; until then the runtime claim is limited to the
current boot.
