# Step3.6 — Capture the existing transcript archive in the tracked timer contract

## 0 — Micro Re-Orient
- Block3 supplies scheduled application quiescence before recovery1.2.
- Step3.5 merged fa18058 with exact CI and restored-only interruption evidence.
- Its broad next installation contains multiple missing prerequisites, split by D22.
- This step captures the one live archive entry whose source/unit are untracked.
- It serves durable frontend memory and reproducible timer commissioning.
- Yes: capture existing bytes first; actual installation is now3.11.

## 1 — Needs verified (2026-09-29 08:42:35 EDT)

Live archive script SHA2563f8e3d4ec9ad97e90d52ecbb3b057a2c2f6b38e56ad85c97cc8407adbeb7ee60;
live plist SHA2562eb251171ec7d3550b4469b90c6d33786e0d317d4976024977c5eedfcf54d556.
The existing workspace installer copies workspace-bin into workspace/bin. The
hourly /bin/sh entry uses RunAtLoad and one shared archive.err output path.
Its body runs foreground rsync with JSONL filtering and without --delete.
Installed /bin/sh, rsync and native owned launchd fixtures are available. Existing
production paths/units/dependencies remain unchanged; no timer gate is installed.

## 2 — Design

Copy exact existing archive bytes into workspace-bin/archive-transcripts.sh.
Track its same Mac plist with only HOME/OPENCLAW_WORKSPACE path substitution.
Do not add service activation to the manifest yet: that changes installation
behavior and belongs to commissioning. Render the template back to the original
loaded unit and compare its semantic dictionary. Keep the actual hourly schedule;
an owned shorter fixture interval is explicitly test-only, never hourly evidence.

## 3 — Risks and limits

Existing rsync failures are swallowed and the summary can still say archived ok;
this is retained, not repaired here. Existing files can be updated, so this is
not an immutable historical archive or a common-point preservation snapshot.
Foreground shell/rsync alone does not prove bootout-safe child drain. No forced
production archive or log rotation, Linux service, gate or general controller.

## 4 — Verify

Exact source identity and original rendered unit; owned transcript filtering,
updates and removal-without-archive-deletion; source trees unchanged; actual
private copied /bin/sh invocation and one owned Mac scheduled job exit0 with
fixture archive output, then bootout and verified absence. Isolated exact CI
and independent source challenge before closure.

## 5 — Landing

Private copied runtime only. The existing installer copy route makes the script
reachable for later installations;3.9/3.11 consume the tracked unit. No live
source, service settings or shared modules change.

## 6 — File deltas

- workspace-bin/archive-transcripts.sh: exact current runtime body.
- services/launchd/ai.openclaw.transcript-archive.plist: same existing unit with
  parameterized source/log paths.
- test/transcript-archive.test.mjs: meaningful owned archive behavior controls.
- This audit's pre/post/owned evidence and plan inventory/version/registry/
  append-only D22. No unrelated archive semantics or installer activation.
