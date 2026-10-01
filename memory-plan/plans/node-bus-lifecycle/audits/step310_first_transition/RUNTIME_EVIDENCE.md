# Step 3.10 runtime evidence — 2026-09-30 21:28:11 EDT

PR 164 merged the step 3.9 protected candidate as `e65af5a`. The five
installed timers and their loaded launchd entries remained unchanged during
this step. The accepted 3.9 root is
`~/.openclaw/backups/node-readiness/timer-entry-candidate-20260930-5`.
The 3.10 preparer checked that saved candidate without recapturing it, then
staged exact old plist bytes, source bytes or observer symlink target, and
five service-specific fence files in
`~/.openclaw/backups/node-readiness/timer-transition-candidate-20260930-3`.
Its transition manifest SHA-256 is
`6e9b54f0a9e49c77901be7e97ac2cc48ea6a1c8fd2ea51824cd6c630e2df3e73`.
The root and subdirectories are 0700; files containing old plist environment
values are 0600. Saved verification returned `verified:true`, five jobs and
the same manifest hash. A private copy with one altered consolidation fence
was refused as a changed artifact. No raw environment value is in this audit.

`python3 -m unittest -v test/timer_transition_test.py` passed 10/10 focused
controls on this Mac. They include scheduled-versus-manual Node and shell
fences, consolidation's retained import/export behavior, and observer's
non-timer target import. Actual owned launchd jobs proved active Node parent
and detached child writes, foreground same-group child writes, shell fsync and
gzip output finish after an atomic source-path swap. The tests waited for the
old job to report `state = not running` and `last exit code = 0` before
bootout. A forced refire after fencing incremented the job run count without
adding an old application write. A separate same-label handoff loaded the
3.9 Python gate after old-job bootout: its first run under a closed marker
was inert, and a post-reopen run wrote the expected application output.
The completed gzip archive decompressed byte-for-byte to its original log.
Every owned label was unloaded on test exit; a later `launchctl list` search
found no matching temporary label.

Two negative controls define the boundary. An earlier owned `bootout` while
parent and child were active killed them before their planned fsynced writes;
`launchctl disable` was followed by another timer fire after it returned.
The new same-group unawaited-child control showed the child disappear without
its planned output when its old-style parent exited normally. The local
`/usr/share/man/man5/launchd.plist.5` explains why: a dying job's remaining
same-process-group children are killed unless `AbandonProcessGroup` is true.
The five installed plists leave that key unset. The old deployed scheduler
starts the notification child asynchronously and may lose notification
delivery on its own forced exit. The accepted 3.8 replacement waits for that
child, but no 3.10 test claims to repair a pre-fence old invocation.

The prepared source fences were syntax-checked with their real interpreters.
`python3 -m py_compile` and `git diff --check` passed. Source review matched
the actual deployed scheduler SHA-256
`a9eb20eed46875d7a8107c3804ca5d1d6b30da7e83c0a1213f5f1da9ecdab703`,
not the newer repository file. All live units still use their old sources;
this is owned first-transition proof and private staging, not a live install.
The actual five-job fence publication, source restore, gated bootstrap and
post-install stability check belong to step 3.11. Ordinary installer activity
during that brief fence window must be coordinated before any production
source mutation.
