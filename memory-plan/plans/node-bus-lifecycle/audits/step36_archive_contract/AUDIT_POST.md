# Step3.6 — Candidate verification

## 1 — Promised vs landed

| Delta | Landed | Evidence |
|---|---|---|
| Exact runtime archive body tracked | yes | SHA2563f8e3d4ec9ad97e90d52ecbb3b057a2c2f6b38e56ad85c97cc8407adbeb7ee60 |
| Original hourly Mac unit parameterized | yes | Original rendered dictionary equality; interval3600/RunAtLoad retained |
| Transcript filter/update/retention controls | yes | Installed Node24 behavior control,1 pass/0 fail/0 skip |
| Real copied private runtime/job | yes | Native launchd RunAtLoad run1/exit0, two fixture transcripts, no unrelated file/log bytes |
| Owned teardown | yes | bootout0 and target absence |
| Exact CI and independent source review | pending | Candidate not closed before these pass |

## 2 — Greppable deltas

- `workspace-bin/archive-transcripts.sh`: ARCHIVE="$HOME/.openclaw/transcript-archive".
- `services/launchd/ai.openclaw.transcript-archive.plist`: StartInterval3600.
- `test/transcript-archive.test.mjs`: real filter/update/retention control.
- `OWNED_EVIDENCE.json`: exact raw record hash and locally observed Mac result.
- Existing `scripts/install/workspace.sh` copies workspace-bin into workspace/bin;
  service activation is deliberately deferred to the commissioning step3.11.

## 3 — Cross-references

D22 explicitly maps the original installation3.6 to3.11. Existing historical
decisions/audits remain unchanged. New3.7–3.10 have contracts/Needs before that
outcome. No Linux service or whole-node quiet claim is attached to this archive.

## 4 — Findings

[POSITIVE] Exact old bytes include foreground rsync and retain absent source
copies without --delete. Updated transcript files replace current archived copies.
[POSITIVE] The original rendered plist retains /bin/sh, paths, scheduling and logs.
[POSITIVE] A real private Mac job executes the copied source, exits0 and unloads.
[NEGATIVE] Existing rsync failure suppression can yield a misleading success line;
archive integrity/error reporting remains a separate parent follow-up.
[NEGATIVE] RunAtLoad is the observed native fire; no natural hourly interval,
production gate, stop-safe child drain or VM durability is inferred.

## 5 — Phase8 patches

None currently. Candidate source review and exact isolated CI remain required.

## 6 — Carry-forward

3.7 supplies the bounded existing-Journal restore-only command before actual
commissioning.3.8 reconciles the reachable consolidation graph;3.9 supplies the
protected launch contract;3.10 proves the old-entry transition.3.11 owns actual
five-timer deployment, persistent baseline, closed fires and readiness reopen.
Never force an old live run to manufacture an idle proof. Existing archive
source/unit, primarye57 and shared dependencies were not modified in this step.
