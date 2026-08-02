# AUDIT_PRE — step 4.3 · Watcher process truth

## §0 Re-orient

- Where am I: Block 4, step 4.3, after v4.2 made full deep-watch execution stable.
- This step contributes: operator health verdicts earned from current artifacts and running PIDs.
- Still the right next step? Yes. The live watcher currently calls an 18-day-old gateway JSONL
  WORKING and maps launchd label presence directly to mesh/coordinator WORKING.

## §1 Needs pre-screen

- Operator approval: full runtime-repair block approved 2026-08-02.
- Step 4.2: closed and pushed at `a1cadd9`.
- Reproduction: `runtime.gateway` reports WORKING from historical session files without a freshness
  threshold; `net.mesh` and `fed.coordinator` inspect `launchctl list` text for labels but not PIDs.
- Live fixture: launchd output includes loaded service labels with `-` in the PID column.

## §4 Risks

- A daemon may be intentionally on-demand; absence must be OFF where role semantics establish that,
  not BROKEN by default.
- `launchctl list` uses `-` for a loaded-but-not-running job and an integer for a running process;
  parsing must preserve labels and not mistake exit status for PID.
- Gateway freshness must use the artifact the probe actually claims as evidence and a documented
  threshold, not unrelated current transcript activity.

## §6 Intended deltas

- Add pure launchd parsing/service graders and pure gateway freshness grading.
- Require running PID evidence for mesh and coordinator WORKING verdicts.
- Lock the stale-file and PID-less-label regressions in focused tests.
- Deploy the watcher library, restart the monitor, and record corrected one-shot evidence.
