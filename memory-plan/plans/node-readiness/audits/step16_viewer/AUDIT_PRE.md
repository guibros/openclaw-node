# Step 1.6 — Restore authenticated workplan viewing

## 0 — Re-orient
Block 1 restores the existing local substrate before wider deployment changes.
Step 1.2 restored supervised Mission Control and preserved its board data.
Step 1.6 restores the stopped viewer with authenticated reads, controls and streams.
This serves the north-star operator monitoring and plan-control surface.
The existing service remains disabled until its replacement passes acceptance.

## 1 — Intent and prerequisites
The operator authorized the review, repairs and deployment with Claude as an
independent adversarial collaborator. The existing viewer unit and paths were
inventoried, and the unit was stopped and persistently disabled. Plan automation
will remain unchanged. Decisions D1, D3 and D8 govern the implementation.

This file records the contract already established in the private investigation
and D8; its transcription into the silo occurred during implementation.

## 2 — Design
Authenticate at the common request boundary. Publish only a static sign-in shell
and fixed scripts. The private file key issues expiring, revocable browser
sessions; browser API requests and live streams send explicit Bearer credentials.
Validate request authority and browser origin, and terminate streams when their
authorization ends. Keep authorized controls and their existing errors.

Extract the existing browser code to a fixed script so a restrictive script
policy can apply. Escape dynamic configuration display. Keep selected history
logs confined throughout the lifetime of the stream. Update the existing watcher
to verify authenticated plan discovery, rather than the public sign-in shell.

## 3 — Risks
Browser compatibility, stream reconnection/cancellation, file replacement,
session lifecycle, deployment drift and preservation of existing plan controls.
Use isolated plan roots, home directories, fake credentials, stub supervisors
and harmless tick commands for control acceptance. Do not execute real plans.

## 4 — Verification
Focused auth, transport, HTTP and watcher tests; original negative reproduction
and legitimate control; browser sign-in, live data and invalidation; independent
candidate review and Claude challenge; required CI. Deploy attributable source
and restore the existing supervisor, then observe authenticated reads and
anonymous/foreign-origin rejection plus service restart. Root local suite is
deferred to test-isolation step 2.1; CI runs it in the isolated runner.

## 5 — Deployment
Preserve the live checkout and its runtime symlinks. Back up existing units and
create an attributed source release for the viewer and its watcher caller.
Preserve plan roots, working directory and schedules. Keep the viewer disabled
if verification fails; do not roll back to unauthenticated exposure.

## 6 — File deltas
- `workspace-bin/workplan-viewer.mjs`: common authentication boundary and fixed shell/assets.
- `workspace-bin/workplan-viewer-client.js`: extracted UI with authenticated transport and escaped configuration.
- `lib/workplan-viewer-auth.mjs`: private key, sessions and request-origin boundary.
- `lib/workplan-viewer-client.mjs`: authenticated fetch and stream lifecycle.
- `lib/node-watch.mjs`: authenticated viewer discovery health check.
- `test/workplan-viewer-{auth,client,http}.test.mjs`, `test/node-watch.test.mjs`: isolated regressions and legitimate controls.
- `docs/WORKPLAN_VIEWER.md`: access, monitoring and session lifecycle.
- This silo's inventory, decisions, version, registry and audits: implementation/evidence ledger.

## Mid-Implementation Findings
The independent candidate review identified selected-log replacement and default
HTTP-port normalization edge cases. Both remain within this boundary and have
focused regressions. Browser automation stalled at an existing native confirmation
dialog. A later disposable fixture confirmed sign-in, a live append, sign-out,
key rotation and a harmless run-once. Production browser acceptance remains
incomplete: Chrome reports ERR_BLOCKED_BY_CLIENT before requests reach the
viewer, and the operator was asked to enter the private key locally. The repaired
service is now deployed; the step remains open.

Claude reproduced a write-after-end crash on the real viewer when a stalled
stream is ended during revocation or key rotation. Authorization termination
now destroys the connection, including expiry and shutdown, so response close
releases the pinned file. The HTTP suite exercises 24 MiB stalled logs, checks
file release and healthy authenticated requests, and includes the idle
heartbeat and shutdown cases. The old source must fail the same regression.

Claude independently approved b4bbac2 on 2026-09-28. On old source, revocation
reproduces the crash and rotation fails because resources remain open. The
shutdown case is a behavior check; reverting expiry/shutdown to end() is caught
by unit tests. The test-only 4b5c0e2 extends the large-log header deadline from
five to thirty seconds; resource-release checks remain unchanged.

Nonblocking carry-forwards: CI currently tests Node 20/22 while the deployed
viewer/watcher engine is Node 24 (step 2.1). Pinned raw history logs are read and
encoded in one blocking operation, with memory/time growing with file size;
Claude measured approximately 300 ms and 179 MB peak for 24 MiB on an idle Linux
Node 24 instance. Bound history loading in a separate viewer performance step;
this observation is not a Mac runtime measurement or an authentication regression.

The watcher bootstrap initially returned error 5 during the old service's
bootout. After verifying the service was absent, bootstrap succeeded with the
reviewed unit. No overlapping watcher remains. Record this deployment sequencing
requirement in step 1.5; do not infer an application startup defect from the
supervisor transition.

Deployment guard until steps 1.5/2.2: do not rerun the installer/services stage
or manually launch the old viewer from e57f89b/workspace copies. The current
accepted viewer/watcher units point at the reviewed release; a services reinstall
could overwrite the watcher unit. Repeat its missing-key negative after any
installer/stack action. The authenticated API's roots field names the original
live directory; federation log 20260711-143943.log is returned by its logs API
and absent from the release snapshot. There is exactly one installed viewer
LaunchAgent and one loopback listener, both attributed to the release. The
release root was already 0700; all owned files/directories now also have private
modes, with executable bits preserved and all 1,915 content hashes unchanged.
