# AUDIT_POST — step 4.3 · Watcher process truth

## 1. Verdict

PASS. Historical files and loaded launchd labels can no longer earn WORKING. The deployed monitor
now separates configured, running, recently exercised, and unobservable states, and its corrected
verdicts reveal real runtime work rather than producing a healthier-looking score.

## 2. Landed

- Added one pure `launchctl print` parser for running PID, loaded/stopped, absent, and command-error
  states; node-watch and federation acceptance share it.
- Gateway WORKING now requires both a running launchd PID and a session JSONL newer than 24 hours;
  the directory scan ignores non-JSONL files.
- Mesh aggregation requires every loaded mesh label to carry a PID. Coordinator acceptance and watch
  grading require the mesh-task-daemon PID explicitly.
- Required core service grading now checks PIDs for memory-daemon, Mission Control, and the three
  active R=3 NATS jobs rather than the retired single-node NATS label.

## 3. Code Evidence

- Focused watcher, federation grader, federation acceptance, and node-acceptance tests: 88/88 pass.
- Regressions cover an 18-day stale gateway artifact, loaded/no-PID jobs, a running PID fixture,
  missing service, unobservable launchctl, partial mesh state, and required-core state.
- Final broad host suite: 1931 pass / 1 fail / 1 skip of 1933. The sole failure is the known fixed
  embedding latency budget (1224.2ms mean versus 500ms); the 100-item batch passes at 9.62s.

## 4. Runtime Evidence

- The restarted watcher daemon is running and writes corrected `.node-watch.json` snapshots.
- Gateway alternated between `spawn scheduled` without a PID (BROKEN) and a transient PID with a
  69,773-minute stale session (UNKNOWN). Neither state graded WORKING.
- Mesh reports BROKEN: four of six loaded services have PIDs; mesh-agent and mesh-tool-discord do not.
- Coordinator reports WORKING only from mesh-task-daemon pid 56662.
- Core fabric reports WORKING with explicit PIDs for memory-daemon, NATS 1/2/3, and Mission Control.
- A deployed full deep run completed normally at 27 WORKING / 3 BROKEN / 3 OFF / 3 UNKNOWN. Its rc 1
  is the documented health verdict, not a crash.

## 5. Findings Carried Forward

- The now-visible gateway retry/staleness and stopped mesh-agent are runtime failures, not watcher
  defects; they are recorded in OUT_OF_SCOPE and must not be relabeled as monitor regressions.
- The retired `ai.openclaw.nats` launchd job still spawn-loops beside the healthy R=3 services. It is
  excluded from the active topology and separately recorded for installer/service cleanup.
- Graph-cache staleness and local LLM probe latency remain honest independent findings.

## 6. Re-orient

The watcher can now support federation and HyperAgent evidence without treating labels as workers.
Step 4.4 remains the next bounded runtime repair: authenticate the external scheduler heartbeat and
prove launchd ticks Mission Control with HTTP 200 and exit 0.
