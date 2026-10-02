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
`/usr/bin/killall -9 node`. They can reload the obsolete root job or stop
Node services, defeating both durable retirement and the proposed root
boundary. The
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
/usr/bin/lockf -kn -t 0 /Users/moltymac/.openclaw/preservation/node.lock /bin/zsh -f
```

Run every following command inside that shell and exit it only after the
post-action checks. If lock acquisition fails, do nothing. Recheck the
receipt and root paths while holding it; a pre-lock observation cannot rule
out a preservation controller starting in between. Set `umask 077` in the
locked shell before writing any census or evidence file. Start from the
repository root; require the checkout contains the merged Tailscale exclusion
and record its commit for the evidence:

```sh
umask 077
/bin/pwd -P
/usr/bin/git rev-parse --show-toplevel
/usr/bin/git merge-base --is-ancestor 8b451da19d95aa3cc605ebe713598241902d365c HEAD
/usr/bin/git rev-parse HEAD
```

The physical working directory and Git top level must match. A failed
ancestor check refuses the action.

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
/usr/bin/python3 -c 'import json,pathlib,sys; d=json.loads((pathlib.Path.home()/".openclaw/preservation/node.lock.state.json").read_text()); sys.exit(0 if d["status"] == "restored" and d["baseline"]["scope"] == "timer-commissioning" else 2)'
```

Each line must have the expected result: the plist is root:wheel 0644, the
job is loaded and enabled, and all `test ! -e` checks succeed. An unexpected
preflight result ends this procedure. Capture the current NATS launchd and
process census with `/usr/bin/python3 bin/nats-live-census.py` from the repository,
recording its output in an owner-private file outside Git. Repeat that same
census after the action and investigate any unexpected change; live stores
may advance while their servers run, so file counts alone are not an
equality test.

## Root action, in order

From the node-user shell still held by `lockf`, enter a nested root shell with
`/usr/bin/sudo -H /bin/sh`. This avoids loading shell startup code as root. The operator
types the password locally, never in chat.
Keep that root shell open until the sudo policy and job have been verified; it
is the recovery path if the sudoers change unexpectedly breaks authentication.
The commands in steps 1–3 below run in this root shell without `sudo`.
Execute each command separately and inspect its exit status and expected
output before issuing the next. Never paste a whole fenced block: `/bin/sh`
continues after a failed line, while the absence probes after `bootout` are
expected to return nonzero. Those are the post-bootout exact-label
`launchctl print` and `pgrep` lines; both must say absent. A nonzero `bootout`
itself is ambiguous and requires physical checks. Stop immediately on any
other failed check.

1. Inspect the legacy sudoers file before any move. Require root:wheel 0440,
   a regular file with no unexpected rule, and exactly the three effective
   passwordless grants observed above. Check every `#include`, `@include`,
   and `#includedir` directive in the root policy: a direct include of this
   file would make its removal unsafe. Require only the stock includedir for
   `/private/etc/sudoers.d`, and a clean syntax check. Recheck the marker,
   root ledger and outcomes as root while the node lock is held. If any result
   differs, leave both the sudoers file and daemon untouched.

   ```sh
   /usr/bin/stat -f '%Su:%Sg %Lp %HT %z %N' /etc/sudoers.d/openclaw-mesh
   sudoers_hash=$(/usr/bin/shasum -a 256 /etc/sudoers.d/openclaw-mesh | /usr/bin/awk '{print $1}')
   printf 'sudoers SHA-256: %s\n' "$sudoers_hash"
   /bin/cat /etc/sudoers.d/openclaw-mesh
   /usr/bin/grep -nE '^[[:space:]]*[#@]include' /etc/sudoers /private/etc/sudoers.d/*
   /usr/sbin/visudo -c
   /bin/test ! -e /private/var/db/openclaw-nats/writer-handoff.json
   /bin/test ! -e /private/var/db/openclaw-nats-ledger
   /bin/test ! -e /private/var/db/openclaw-nats-outcomes
   /bin/test ! -e /private/var/db/openclaw-retired-jobs
   ```

   The printed hash must contain exactly 64 hexadecimal characters; save it
   with the root-side evidence before leaving this shell. If the file changes
   between the hash and copy, the copy's read-check below refuses.

2. Create the owner-protected retirement directory. Use the inspected and
   recorded sudoers SHA-256, require both destinations absent, and
   read-check the copy before moving the original. `mv -n` must not overwrite
   a destination. Require the installed path absent, the moved copy identical,
   and sudo policy syntax still valid. If the syntax check fails, keep the root
   shell open and restore the pinned original before doing anything else.

   ```sh
   /usr/bin/install -d -o root -g wheel -m 0700 /private/var/db/openclaw-retired-jobs
   /bin/test ! -e /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original
   /bin/test ! -e /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired
   /usr/bin/install -o root -g wheel -m 0600 /etc/sudoers.d/openclaw-mesh /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original
   printf '%s  %s\n' "$sudoers_hash" /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original | /usr/bin/shasum -a 256 -c -
   /bin/mv -n /etc/sudoers.d/openclaw-mesh /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired
   /bin/test ! -e /etc/sudoers.d/openclaw-mesh
   /bin/chmod 0600 /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired
   printf '%s  %s\n' "$sudoers_hash" /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired | /usr/bin/shasum -a 256 -c -
   /usr/sbin/visudo -c
   /bin/sync
   ```

   If `visudo -c` fails after the move, keep the root shell open. Recheck
   the saved original against `$sudoers_hash` and require the installed path
   absent, then restore from the saved copy and check policy again:

   ```sh
   printf '%s  %s\n' "$sudoers_hash" /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original | /usr/bin/shasum -a 256 -c -
   /bin/test ! -e /etc/sudoers.d/openclaw-mesh
   /bin/test ! -L /etc/sudoers.d/openclaw-mesh
   /usr/bin/install -o root -g wheel -m 0440 /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original /etc/sudoers.d/openclaw-mesh
   printf '%s  %s\n' "$sudoers_hash" /etc/sudoers.d/openclaw-mesh | /usr/bin/shasum -a 256 -c -
   /usr/sbin/visudo -c
   ```

   This is a failure-recovery branch, never part of the successful sequence.
   If any recovery check differs, diagnose in the still-open root shell and
   do not touch the daemon.

   With the root shell still open, enter a temporary node-user shell using
   `/usr/bin/su -l moltymac`. Run `/usr/bin/sudo -k`, then
   `/usr/bin/sudo -n -l`: it must now fail specifically because a password is
   required. Run `/usr/bin/sudo -v`, entering
   the operator password locally, and require success. Exit the temporary
   node-user shell back to the root shell. If fresh authentication fails,
   diagnose and use the pinned restore branch above from the still-open root
   shell. This is the lockout guard; do not close root access on an untested
   policy. No repository-managed service needs the removed wildcard grants.

3. Retire the exact LaunchDaemon. Recheck the plist's pinned hash, root:wheel
   0644 ownership, installed path and loaded program/arguments after the
   sudoers grant is gone; refuse any drift. Require both protected
   copy destinations absent. Copy and read-check the plist before touching
   launchd. Persistently disable the label, require its override says disabled,
   then boot it out. A nonzero `bootout` result is ambiguous: inspect both
   physical absence checks before deciding whether to continue. Only after
   the label and process are absent, move the plist with `mv -n`, set it to
   0600, and read-check both protected copies. Do not automatically revive a
   missing-code KeepAlive job on a partial failure.

   ```sh
   printf '%s  %s\n' eaa61962d86643d3fa301875b2f65e5fa8c97fd37468840ddabcb1a5f9701351 /Library/LaunchDaemons/com.openclaw.agent.plist | /usr/bin/shasum -a 256 -c -
   /usr/bin/stat -f '%Su:%Sg %Lp %N' /Library/LaunchDaemons/com.openclaw.agent.plist
   /bin/launchctl print system/com.openclaw.agent
   /bin/test ! -e /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original
   /bin/test ! -e /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   /usr/bin/install -o root -g wheel -m 0600 /Library/LaunchDaemons/com.openclaw.agent.plist /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original
   printf '%s  %s\n' eaa61962d86643d3fa301875b2f65e5fa8c97fd37468840ddabcb1a5f9701351 /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original | /usr/bin/shasum -a 256 -c -
   /bin/launchctl disable system/com.openclaw.agent
   /bin/launchctl print-disabled system
   /bin/launchctl bootout system/com.openclaw.agent
   /bin/launchctl print system/com.openclaw.agent
   /bin/launchctl print system
   /usr/bin/pgrep -fl '^/usr/local/bin/node /Users/moltymac/openclaw/agent.js$'
   /bin/mv -n /Library/LaunchDaemons/com.openclaw.agent.plist /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   /bin/test ! -e /Library/LaunchDaemons/com.openclaw.agent.plist
   /bin/chmod 0600 /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired
   printf '%s  %s\n' eaa61962d86643d3fa301875b2f65e5fa8c97fd37468840ddabcb1a5f9701351 /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired | /usr/bin/shasum -a 256 -c -
   /usr/bin/stat -f '%Su:%Sg %Lp %N' /private/var/db/openclaw-retired-jobs /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.original /private/var/db/openclaw-retired-jobs/com.openclaw.agent.plist.retired /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.original /private/var/db/openclaw-retired-jobs/openclaw-mesh.sudoers.retired
   /bin/launchctl print-disabled system
   /bin/sync
   ```

   The exact-label `print` and `pgrep` must find nothing; the system listing
   must contain no loaded `com.openclaw.agent`. Both protected plist copies
   must be root:wheel 0600, and both sudoers copies must remain root:wheel
   0600 inside the root:wheel 0700 directory. Exit the root shell only after
   these checks. If a command fails, preserve the observed partial state and
   investigate while the root shell remains available.

4. Back in the locked node-user shell, repeat the NATS census and all 23-unit
   entrypoint checks. The preflight must explicitly return the pinned idle
   Tailscale helper exclusion, not merely `verified=True`:

   ```sh
   PYTHONPATH=memory-plan/plans/node-state-recovery/audits/step12_jetstream /usr/bin/python3 -c 'from preservation_checks import capture_entrypoint_inventory; from preservation_journal import UNITS; import sys; e=capture_entrypoint_inventory(UNITS); sys.exit(0 if e["verified"] is True and "com.openclaw.tailscale-up" in e["excluded"] else 2)'
   ```

   Compare the before/after approved LaunchAgents, NATS process identities and
   listeners, and system-domain labels; investigate any unexpected change.
   Save boot identity, the four protected hashes, disabled override, syntax
   and fresh-authentication results, preflight result and hashes of the
   private censuses in an owner-private evidence file. Only after that report
   the daemon and sudoers rules retired for this boot, then exit the locked
   shell. Repeat the checks after the next reboot. Structural success does not
   authorize a full-node preservation window, healthy cold masters or NATS
   cutover.

   Before exiting the locked shell, run `/usr/bin/lockf -kn -t 0
   /Users/moltymac/.openclaw/preservation/node.lock /usr/bin/true` from a
   **second terminal**. It must fail because the first terminal still holds
   the lock. If it succeeds, the lock was lost; refuse the retirement claim
   and re-evaluate the observed state.

If any step fails, preserve every original, copy and observed partial state.
The recovery root shell must not close while sudo policy is unverified. A
future explicit reversal of the daemon would reintroduce its known crash loop
and requires a new operator decision. A reboot must confirm that the job
remains absent and disabled and the sudoers grant remains absent before the
retirement is called durable across boots.
