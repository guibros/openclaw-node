# Step 1.1 — gateway config

## 0. Micro re-orient
Live gateway crash-loops while memory and viewer listen.
Main and live checkout differ.
This step restores only gateway startup through valid config shapes.
It serves MASTER_PLAN 3.1's existing agent runner.
This is the first bounded repair, not inference or channel acceptance.

## 1. Intent
Resolve #66's reproduced streaming validation failure.

## 2. Design and Needs
Installed upstream 2026.5.27 schema requires streaming objects with mode. Live modes partial/off and disabled channels remain unchanged. Back up privately, validate candidate before replacement, restart existing service.

## 3. Risks
Broad doctor rewrites unrelated settings; avoid it. Health does not prove model provider operation. Root-suite isolation unresolved (#52/#61), explicitly tracked in 2.1; use actual upstream validator and inspected focused tests.

## 4. Verification
Template and migrated live config validate. Two post-restart health checks at least 30 seconds apart pass. All unrelated configuration identical.

## 5. Review
Send focused diff and evidence to the actual Claude collaborator before merge.

## 6. File deltas
- config/openclaw.json.template: two streaming values become mode objects.
- This newly instantiated silo: delivery roadmap, registry, decisions, inventory, audit and version.
- workspace-bin/node-readiness-tick.sh: generated shim, no job loaded.
- Runtime: private backup and same two-field migration in ~/.openclaw/openclaw.json.

## Mid-Implementation Findings
None.
