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
dialog; browser control acceptance is still incomplete. The production service
remains disabled while these checks are completed.
