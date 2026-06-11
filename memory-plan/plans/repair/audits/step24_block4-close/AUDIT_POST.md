# AUDIT_POST — Step 4.6 + Block 4 close

## 4.6 ledger
`MIN_SESSION_BYTES = 1024` (named, WHY-documented) replaces the bare 50KB literal at **three** sites — findCurrentJsonl, findJsonlBySessionId, and findPreviousJsonl (a third gate the capture didn't even know about). Wiring test locks zero bare literals + 4 constant uses. Deployed (PID 82349). Suite **1533/1533**.

## Macro Re-Orient (Block 4 close, WORKFLOW §7.2)

- **Block outcome:** the daemon's lifecycle is now trustworthy. Four consecutive exit-0 restarts this session (every restart in the plan's prior history: -9/-6); SQLite probes survive a dead broker; the event spine self-heals when the broker returns (same-PID recovery, publish→consume verified); ended sessions flush their own transcripts; the idle-timer fires once instead of forever; short sessions are no longer invisible to the flush paths.
- **Registry probes (live):** daemon PID 82349 healthy; NATS + health-watch up; queue snapshot exporting; vault integrity 100% holding on live flushes.
- **Block 5 re-survey (5.1 knowledge re-index, 5.2 channel-error surfacing, 5.3 promotion emit-on-change, 5.4 stall detector, 5.5 readonly busy_timeout, 5.6 integrity_check scoping):** all atomic, correctly ordered, unchanged. 5.1 remains the quality-critical one (search still serves truncated session prefixes).
- **Drift check:** none; every change maps to a step commit.
- **OUT_OF_SCOPE balance:** 50KB floor RESOLVED (4.6). Bootstrap `memory-maintenance` exit-1 (assigned to this block's territory) deliberately NOT promoted — LOW severity, Phase 2 covers the work minutes later; stays captured for an idle moment. Theme↔session linkage and the unclaimed tier selector remain captured.
- **Documented substitutions this block:** 4.4 live session-switch induction (pattern byte-identical to the runtime-proven ACTIVE→ENDED handler; wiring-locked); 4.5 long-window live absence (loopback-mock reproduces the mechanism; the 45-min ping pair's absence is a free grep for the next session).
