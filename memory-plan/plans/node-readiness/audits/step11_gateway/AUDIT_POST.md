# Step 1.1 — gateway startup

## 1. Promised vs landed
- YES: two template fields use mode objects; live config migrated identically.
- YES: private 0600 backup precedes atomic replacement; all other parsed fields unchanged.
- YES: actual OpenClaw 2026.5.27 validator accepts rendered template and migrated live config.
- YES: existing gateway service restarted; health passes at 23:07:28 and 23:08:10 EDT, 41.77 seconds apart, no degraded event loop or plugin errors.

## 2. Greppable deltas
config/openclaw.json.template has streaming.mode partial and off. Runtime template matches source. See evidence.json for sanitized results. Private originals remain under ~/.openclaw/backups/node-readiness and are not committed.

## 3. Cross references
GitHub #66; new node-readiness inventory 1.1; MASTER_PLAN 3.1. Model inference and frontend memory remain later acceptance gates.

## 4. Findings
[POSITIVE] Gateway no longer rejects the config or crash-loops; PID 2902 listens on loopback 18789.
[NEGATIVE] Immediate startup health failed before the service warmed; later initial health reported event-loop delay, then both accepted probes were healthy.
[NEGATIVE] Unmodified focused installer run: 18 pass / 1 fail reproducing known #53 Python cache writes during macOS dry-run. With PYTHONDONTWRITEBYTECODE=1, all 19 pass / 0 skip. This test environment setting is not a product fix for #53.
[NEGATIVE] Full root suite is not run against production defaults (#52/#61); isolation remains step 2.1.
[NEGATIVE] Gateway generates an ephemeral auth token because none is configured. This repair does not establish stable client authentication or inference readiness.

## 5. Phase-8 patches
None. No unrelated changes.

## 6. Feeds / carry-forwards
Running gateway is available for later plugin/harness acceptance. Next bounded outcome is Mission Control startup. Record persistent gateway authentication as a separate acceptance prerequisite before harness access. Claude adversarial review is in progress; do not claim merged approval until received.

## Independent review follow-up (2026-09-27)
Claude accepted the code scope and required stronger runtime evidence before merge. Step 1.1 was reopened locally, then reclosed only after a 703.0-second observation from 2026-09-27T23:10:13.117108-04:00 through 2026-09-27T23:21:56.135839-04:00: PID 2902 and runs 17074 unchanged in every sample. Earlier process observation began after the 23:06 restart; the explicit counter window starts at 23:10, not retroactively at first listen. Error log last modified 23:06:33, the already-recorded ephemeral-token warning; no later errors. Final health passes, anonymous chat returns 401, unchanged-field SHA256 matches, config stays 0600 in the operator's ownership and backup directory 0700. Config mtime remains 23:05:21 (candidate creation).

CI on 812c0fc passes root Node 20/22 and Mission Control. Local full-suite isolation remains separate. Fresh-clone plan lint still has #70's missing runtime automation.json/tick-logs failures; this chain is unloaded and is not claimed portable. Installer acceptance includes that defect. Verify dependencies now require recovered bus and attributable runtime before later runtime acceptance. Persistent gateway authentication is a harness prerequisite.

No schema-mirroring unit test added: the whole-file upstream validator is the behavioral compatibility check for the exact installed version. Future versions and other machines remain installation acceptance, not inferred compatibility.
