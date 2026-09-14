# AUDIT_POST — step 4.2 · God's Eye View row in `openclaw-stack`

**Closed:** 2026-09-14, Montreal · **Carrier:** `v4.2` · **Branch:** `claude/hermes-essential-skills-ch3s0o`

## What shipped

`openclaw-stack status` now prints a `gods-eye-view` row on port 4173, LIVE when the app answers,
`CLOSED` when the clone is there but it is not running, `ABSENT` when it was never cloned — and
never moving the exit code or the notification tally in any of those states.

The two hand-pushed external-app call sites became an `EXTERNAL_APPS` table. Two was the moment to
do it: a third copy-paste is how a resolution rule drifts, and the id ↔ port ↔ env-var mapping now
reads in one place. `companion-bridge` deliberately stays outside the table with its `DOWN`
semantics — it is a process this script itself spawns on `up`, not a GUI app the operator opens.

## Two judgements

**Why this was startable while the rest of Block 4 is not.** 4.2's *Needs* are "3.2 closed (row
pattern) … env `OPENCLAW_GEV_DIR`" — 4.1 is in its Feeds chain, not its Needs. That is correct on
inspection: the row probes a TCP port and a directory, so nothing it can prove depends on God's Eye
View existing, exactly as 3.2 proved VoiceStudio's row without VoiceStudio. 4.1 (operator's box,
Node 24, a `visual:` check on a globe), 4.3 (an external clone) and 4.5 (a decision) remain the
operator's.

**The Goal's `DOWN` is inherited as `CLOSED`.** 4.2's row asks for "DOWN with the app stopped, exit 0
either way" — the same pair 3.2 found cannot both hold, since the exit predicate is
`rows.some(r => r.status === 'DOWN')`. 3.2 settled it with a status that is neither `DOWN` nor `OFF`;
this step inherits that rather than relitigating it. The clause that matters to an operator — exit 0
when the app is simply not open — holds.

## Evidence

### `runtime:` — four `node bin/openclaw-stack.mjs status` runs

A stand-in `systemctl` on `PATH` gives the Linux discovery path units to report on (this container
has no openclaw units, and the CLI exits 1 before printing when discovery is empty).

| Probe | Condition | Row | Exit |
|---|---|---|---|
| 1 | clone dir present, 4173 shut | `gods-eye-view  CLOSED  4173 closed` | **0** |
| 2 | listener on 4173 | `gods-eye-view  LIVE  4173 open` | **0** |
| 3 | no clone dir | `gods-eye-view  ABSENT  4173 closed` | **0** |
| 4 | same, plus `OPENCLAW_BRIDGE_DIR` so companion-bridge reads `DOWN` | `gods-eye-view  CLOSED` | **1** |

**Probe 4 is the falsification**, and it is stronger than 3.2's because three external rows sit in
one table: `companion-bridge DOWN`, `voicestudio ABSENT`, `gods-eye-view CLOSED`, exit 1 — traceable
to the bridge alone, since probe 1 is the same run without it. The exit code is demonstrably live and
the exemption demonstrably real.

**What the probe does not show:** the listener on 4173 is a two-line HTTP server, not God's Eye View.
The row inspects a port and a directory and that is exactly what was exercised; whether the thing
answering is really the globe is 4.1's `curl /api/setup/status` on the operator's box.

### `code:` — `node --test test/openclaw-stack.test.mjs` → 17/17 (was 14)

Three new cases: every table entry has a port, a canonical short id and an install dir; the table
covers both apps by name with GEV on 4173, so neither can lose its row unnoticed; and the GEV row
gets the same never-a-verdict treatment — `CLOSED`, `reportOnly`, absent from `bad`, `live`/`total`
unmoved at 1/1, and `rows.some(status === 'DOWN')` false.

### Regression guard

Full root suite: **2199 / 1913 pass / 211 fail / 7 skipped**, against **2196 / 1910 / 211 / 7** on
the previous commit. Failure lists diffed by name: empty both ways. The +3 is exactly this step's
new cases; the 211 are the container's standing environmental failures (no NATS, no ollama, no
`~/.openclaw` runtime).

## Left open

- The real `LIVE` with God's Eye View actually running is 4.1's, on the design box.
- 4.4's skill is meant to tell agents to check this row before driving the globe; that step is
  blocked with the rest of Block 4.
