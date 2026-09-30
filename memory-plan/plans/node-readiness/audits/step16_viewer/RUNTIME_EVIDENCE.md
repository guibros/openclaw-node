# Step 1.6 — Deployment evidence, browser gate open

Observed on the operator's Mac, 2026-09-28 07:29 EDT. This is an in-flight
evidence record, not AUDIT_POST or a completed step.

## Source and attribution

PR #142 source b4bbac2b7f1fc94dff63aa90c95ad3c6c05fd438 is unchanged at
documentation head 860c853cb6ac6966297db5f9b19ab7bd71365025. Earlier head
4b5c0e28f6f9d7343df6e2e89adebc980f453117 contains source
b4bbac2b7f1fc94dff63aa90c95ad3c6c05fd438 plus one test-only deadline change.
Claude independently approved the source, passed 103 focused tests on Node
22.22.2 and 24.13.0, and caught six deliberate reversions/mutations. Required
Node 20/22 and Mission Control CI passed on 4b5c0e2 (run 36413879946).
The same required jobs passed on 860c853 (run 36416164402).

The deployed release is `~/.openclaw/releases/viewer-b4bbac2-e57f89b`:
the live e57f89b264a30892389cabe573786fb516a6a208 base plus six reviewed
viewer/watcher files. All 1,915 file hashes match the manifest. The original
checkout, unrelated local work and external node_modules link are preserved.
Release directories/files are owner-private, with executable bits retained.
The release is intentionally mixed provenance; installer-managed immutable
deployment remains step 1.5, not a claim of this repair.

## Live request and lifecycle observations

- Authenticated `/api/plans`: 200, roots exactly the original live
  `/Users/moltymac/openclaw-nodedev/memory-plan/plans`, nine IDs/versions match
  disk. The federation logs API returns `20260711-143943.log` (403,368 bytes),
  absent from the release snapshot, independently discriminating the live root.
- Both public client assets hash to the staged files.
- The key file is UID 501, mode 0600, 65 bytes, with valid trimmed format. No
  credential value is recorded or published.
- Anonymous `/api/plans`, stream routes and protocol run-once return 401.
  Invalid bearer returns 401; foreign Host/Origin/Fetch-Site return 403.
- Real global streams close on sign-out and key rotation. Old sessions return
  401; the current credential returns 200; viewer PID/run count is unchanged.
- All live plan inventories, versions, automation configs, blocks and log
  names/sizes/mtimes remain unchanged across deployment and these probes.
- Exactly one installed viewer unit and one loopback 7892 listener point at
  the reviewed release. Exactly one watcher process uses the release entry.
- Node 24 watcher reports `WORKING: viewer authenticated; 9 plans discovered`.
  With an overridden nonexistent key path, it reports `BROKEN: viewer HTTP 401`;
  the real key is untouched by that negative control.

## Restart and stability

Supervised restart changed viewer PID 29115/runs 1 to PID 30402/runs 2.
The pre-restart session returns 401. The key's modification time predates the
restart; startup did not replace it. Across 11 samples over 603.38 seconds,
viewer PID/runs remain stable, authenticated discovery returns 200 with nine
plans, and gateway plus Mission Control health both return 200.

After that successful window, an intentional SIGKILL verified KeepAlive crash
recovery: PID 30402/runs 2 became PID 35823/runs 3 in 0.447 seconds with
authenticated discovery 200 and the old session 401. Key inode/mtime are
unchanged. This deliberate counter increase is separate from the stable window.
During a 120.22-second authenticated HTTP stream observation, all four service
PID/run counts stayed constant, viewer file descriptors stayed at 16, RSS was
30,928–48,176 KiB without accumulation, and viewer/watcher stderr added zero
bytes. This HTTP reader is explicitly not browser evidence.

The initial watcher bootstrap returned error 5 while the old service's
bootout completed. After confirming the service was absent, the retry succeeded
with PID 29201/runs 1. There is no overlapping watcher. Its 60-second cadence
may miss a brief viewer restart; no unobserved OFF transition is claimed.

## Live control acceptance

On the deployed viewer, an exclusively owned disposable plan used an executable
command that only printed `acceptance` into its own marker. No existing schedule
was loaded. Anonymous run-once returned 401 with no marker. Authenticated config
returned 200 and persisted chain mode without creating a plist or loading the
unique job. Block returned 200; a paused run-once returned 409 with no marker.
Unblock returned 200 with scheduler_reloaded false. Authenticated run-once
returned 200 and produced the expected marker. After removal, discovery returned
the original nine plans; their inventory, versions, configs, blocks and logs were
unchanged, and the live checkout retained only its pre-existing untracked files.
One notification ledger entry refers to the temporary plan; it is retained as
operational history. No notification configuration override was created.
This test covered the anonymous run-once handler; the other anonymous control
handlers are covered by the focused suite, not separately claimed as live probes.

The watcher's native SQLite dependency also executed an in-memory query on
Node 24.13.0 ABI 137 with SQLite 3.49.2. This is native load evidence, not a full
dependency provenance audit. File and session credentials grant shell-equivalent
operator control through the authorized automation configuration; no separate
read-only user role is claimed.

## Browser verification still required

The embedded disposable fixture passed sign-in, a displayed live append,
sign-out, key rotation and a harmless run-once. The live embedded browser
displays the sign-in shell. Actual live sign-in, displayed stream/control
behavior and desktop browser acceptance remain open. Chrome's automation
client reports ERR_BLOCKED_BY_CLIENT before reaching the viewer. The operator
was asked to enter the private key locally and report rendering; browser
protections are preserved. Step 1.6 stays `[A]` and VERSION stays `v1.6-pre`.

## Deployment guards and carry-forwards

Do not run the old viewer manually or rerun the installer/services stage until
steps 1.5/2.2 manage the reviewed paths. Repeat the watcher's missing-key
negative control after any installer/stack change. Viewer rollback means stop
and disable; never restore unauthenticated exposure.

CI needs the actual Node 24 engine added during isolation step 2.1. Whole-file
history loading is tracked as step 4.3. Largest current tick JSONL is 2,023,052
bytes; Claude's 24 MiB/179 MB measurement was on a disposable Linux fixture,
not this Mac. Memory capture, bus topology, fresh installation and two-machine
execution remain unaccepted; a restored viewer does not prove those outcomes.

Private manifests and probe results live in
`~/.openclaw/backups/node-readiness/viewer-b4bbac2/` (0700 directory, 0600
records). Sanitized security evidence is retained through the security artifact
store. Browser acceptance must land before an AUDIT_POST closes this step.
