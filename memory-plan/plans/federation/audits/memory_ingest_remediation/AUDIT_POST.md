# AUDIT_POST — memory ingest remediation

**Written:** 2026-07-16T15:35Z. **Result:** ingest RESURRECTED + observed; watcher grading made
honest (and it immediately surfaced a real red); ollama runner healed; extraction's remaining
blocker precisely characterized (native crash) and QUEUED — not silently absorbed, not fake-closed.

## Fixed + observed

1. **Ingest is alive again.** Root cause chain (PRE): install.sh `claude_project_path()` stripped
   the leading slash → the Jul-14 19:11 re-render produced registry paths that match nothing →
   `_detectActivity` silently skipped them → only `gateway` scanned → 39h dark.
   - install.sh slug fixed (keeps the leading dash) + `CLAUDE_PROJECT_REPO` var; template gains a
     `claude-code-repo` source (the dir where the operator's sessions actually live — state.db's
     biggest sessions are from it).
   - Live registry corrected (dashed paths + repo source; `claude-code-workspace` set
     `enabled:false` — never used on this box; a permanently-missing enabled source would read
     BROKEN forever, and honest-but-noise is still noise when the config is *intentional*).
   - Daemon `_detectActivity` now **warns loudly once per missing enabled source** (deployed).
   - **Observed:** daemon restart → `State: ENDED → BOOT (session: b24b3011)` →
     `session-store: imported 9 sessions` → state.db **13117 → 13591 messages**, newest
     `2026-07-14T23:04:49Z → 2026-07-16T14:59:52Z`; this session 101 → 537 rows. The live watcher:
     `Session ingest WORKING — keeping pace with live transcripts`.

2. **Watcher honesty (`lib/node-watch.mjs`).** `mem.ingest`/`mem.extraction` graded PRESENCE
   (count>0 ⇒ WORKING forever) — they said WORKING through all 39 dark hours. Now pure graders
   (`gradeIngest`, `gradeExtraction`, exported + unit-tested with the REAL failure values):
   ingest BROKEN when transcripts lead ingested messages >30min or an enabled source dir is
   missing; extraction BROKEN when ingest flows >6h past the newest entity landing; UNKNOWN when
   unobservable. 30/30 tests. **Observed live:** ingest WORKING (honestly), extraction
   **BROKEN — "STALLED — ingest has flowed 115.2h past the newest entity landing (Jul 11)"** — a
   true red the old probe hid.

3. **Ollama runner wedge healed.** `llama-server` born in the Jul-14 19:43 cutover batch had been
   returning EMPTY responses for 39h (`eval_count>0, response:""` even for trivial prompts) —
   why entity extraction produced nothing. Killed the runner; fresh one loads in 8s and answers
   (`think:false → "OK"`; the extraction client already sends `think:false`). llm.local axis
   generation verified.

4. **Env token deduped.** Two `OPENCLAW_NATS_TOKEN` lines: JS resolution (first-match) got the
   live one, shell-sourcing (last-wins) got the DEAD one — and `ai.openclaw.mesh-agent.plist`
   shell-sources it (plausibly why that unit never ran). Dead line removed; **verified by direct
   equality** with the running server's config + a live client connect + a shell-source test now
   yielding the live token. (First fingerprint check scared me with a mismatch — that was my own
   trailing-newline hashing artifact; the equality test settled it.)

## NOT fixed — queued with evidence (the honest red stays red)

- **The daemon dies with a NATIVE crash mid-flush:** `libc++abi: terminating … mutex lock failed:
  Invalid argument` killed pid 54898 at ~11:16 while the post-heal backlog flush was grinding
  (llama-server 45–63% CPU for ~6min) with the inject server serving concurrently
  (`memory.retrieved emit failed: TIMEOUT` immediately prior). Same signature as the Jul-14
  crash-loop noise and as the abort in a node-watch one-shot exit — embedder/onnxruntime-class
  native teardown/concurrency bug. KeepAlive restarted the daemon (now tracking the session live);
  **no entities have landed yet**, so `mem.extraction` correctly stays BROKEN until a flush
  survives. This is its own remediation (native-level), not absorbable into this batch.
- **`NATS_PROTOCOL_ERR`** on the first post-heal flush attempt (11:08:27, connection dropped +
  reconnected) — suspect oversized flush-event payload vs the server's max_payload; unproven.
- **`memory.error` event schema mismatch** — the daemon cannot emit its own error events
  (`Invalid option … "ingest"|"extract"|…` + missing `error_code`/`error_message`); the error
  reporter itself errors. Small fix, separate.
- **MEM-L2-INJECT acceptance FAIL ("operation was aborted")** — observed only inside the
  flush/crash window while the watcher's identical probe passes in ~200ms normally; re-check
  after the native crash is fixed before treating it as its own bug.
- **Token/key ROTATION (operator):** the NATS token and a MINIMAX key have both echoed into
  session transcripts during diagnostics — including once by me today (my redaction sed missed a
  non-TOKEN line). Dedupe ≠ rotation; rotate both.

## Bookkeeping
Deployed daemon copy synced (repo → workspace/bin, real file not symlink — the deploy gap bit
again: first restart ran the old copy). Watcher restarted onto the new graders. Repro/evidence in
this audit dir; commit carries the Runtime-Evidence trailer.

## FOLLOW-UP ADDENDUM — 2026-07-16T21:35Z (live import + budget calibration + crash reframed)

- **The "native crash" is reframed with crash-report evidence:** the `.ips` reports show the abort
  happens in `exit → __cxa_finalize_ranges` — a native static destructor (onnxruntime-class)
  aborting while the process was ALREADY exiting via `node::Exit` — i.e., exit-path NOISE, not a
  mid-work crash. Most reports correspond to one-shot CLIs (acceptance/node-watch) exiting. A calm
  full flush later ran 5.5min and completed with the daemon surviving. The earlier daemon deaths
  coincided with restart churn + acceptance runs; no daemon death reproduced on a calm system.
- **Extraction is LANDING again:** entities 1112 → 1117, newest 2026-07-16T20:26Z (the 115h stall
  is broken). Flush LLM leg still degrades to regex under timeouts ("aborted"/"fetch failed") —
  the honest ⚠ EXTRACTION DEGRADED path, queued, not dark.
- **Live session import added** (daemon Phase 2, sessionRecapMs cadence): state.db imports used to
  happen only at boot + session end, so marathon sessions lagged by design. Verified: block runs
  (throttle stamped), correctly no-ops when the parse has no new turns.
- **Ingest lag budget calibrated 30min → 2h:** proven live that the transcript FILE grows with tool
  noise while the parser ingests only conversational turns (parsed 554 == stored 554 as the file
  grew 30+ min) — 30min false-alarms during tool marathons; 2h still catches real darkness. Tests
  32/32 incl. the marathon-tolerance + 3h-BROKEN cases.
- Machine rebooted ~16:44 local (fresh pids); post-reboot "disk I/O error" on extraction/graph DB
  opens seen at boot then recovered on retry — integrity_check ok on state/graph DBs; inject-server
  on the current boot reported extractionDb open failure (privacy filter degraded) — worth watching.

## FINAL ADDENDUM — 2026-07-16T21:48Z (inject characterized: event-loop starvation)

- **mem.inject "operation was aborted" root-caused by thread sample:** the daemon's MAIN THREAD is
  saturated in V8 string ops (`CopyChars`/`String::WriteToFlat`) while a flush grinds — the inject
  HTTP server shares that event loop and starves (manual request: 60s, zero bytes). Inject isn't
  broken; it is BLOCKED whenever a flush/synthesis pass does its synchronous string work over the
  ~11MB transcript. **QUEUED (architecture):** move flush parsing/string work off the main thread
  (worker) or chunk it; until then mem.inject honestly reads BROKEN during flush windows and
  recovers between them.
- **extractionDb open race fixed properly:** the inject-server's one-shot open raced Phase-0's
  wholesale re-import (SQLITE_IOERR) and gave up permanently (privacy filter rejecting everything
  for the whole boot). Now retries 5×15s inside resolveDeps (the first version used a setInterval
  assigning a dead local — caught and replaced before commit).
- Ingest continues to track live (13612 msgs, latest 21:37Z — the live-import cadence landing
  mid-session as designed).

## ITEM-7 ADDENDUM — 2026-07-17 (error-reporter fixed + observer test root-caused)

- **memory.error schema mismatch FIXED:** the culprit was `emitDegradeEvent` — the P0
  "degradation must be LOUD" event shipped `{kind, detail, extraction_error, mode, model}` while
  MemoryErrorSchema requires `{boundary, error_code, error_message}`, so every degrade alert died
  in validation and never reached the watcher. Reshaped to conform; proven against the compiled
  schema (fixed payload validates ✓, old shape correctly rejected ✓). Deployed + daemon restarted.
- **observer test root-caused — not a date flake:** the test injects `lastExtraction: null`
  meaning "none exists", but `opts.lastExtraction ?? readLastExtraction(...)` treats null as
  not-provided and reads the REAL state.db. The test only ever passed while live extraction was
  5+ days stale; healing extraction this morning broke it. Fixed the opts contract
  (`!== undefined`) so explicit null is respected. 8/8.
