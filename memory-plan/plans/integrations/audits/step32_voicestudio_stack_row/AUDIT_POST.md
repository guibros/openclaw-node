# AUDIT_POST — step 3.2 · VoiceStudio row in `openclaw-stack`

**Closed:** 2026-09-14, Montreal · **Carrier:** `v3.2` · **Branch:** `claude/hermes-essential-skills-ch3s0o`

## The correction this step turned on

The INVENTORY row asked for a `LIVE / DOWN / ABSENT` row **and** exit 0 when the app is closed.
Reading the code first showed those cannot both hold: `status` and `up` exit
`rows.some(r => r.status === 'DOWN') ? 1 : 0`, so a `DOWN` VoiceStudio flips the exit code by
construction — and `openclaw-stack status` is what the operator and any wrapper reads.

Filtering the row out of that one predicate would have satisfied the letter of the row while still
printing the word DOWN next to an app behaving exactly as intended. The status token carries the
distinction instead: **`CLOSED`** for an installed desktop app that is not open. A launchd daemon
that is not running is a fault; a GUI app you have not opened is not. Because `CLOSED` is neither
`DOWN` nor `OFF`, both the exit predicate and `notifyResult`'s `bad` set skip it with no special
case added to either — the row is report-only by construction rather than by exception.

One real change was still needed. `notifyResult` counted `live`/`total` over every row, so a closed
VoiceStudio would have made the popup read "6/7 up" about a healthy node. `notifyCounts` (extracted
and exported, which is also what made the rule testable) excludes report-only rows from the tally,
not merely from `bad`.

## Evidence

### `code:` — `node --test test/openclaw-stack.test.mjs` → 14/14 (was 8)

Six new cases: LIVE on an open port regardless of the install dir; `CLOSED` — asserted as *not*
`DOWN` — when the dir exists and the port is shut; `ABSENT` when neither; the closed row absent from
`bad` **and** from `rows.some(status === 'DOWN')`, i.e. both places a verdict is drawn; a
report-only row moving neither `live` nor `total`; and a control proving real units still count and
still fail (`{live: 1, total: 2, bad: ['gateway']}`).

### `runtime:` — the real CLI, four probes

Driven through `node bin/openclaw-stack.mjs status` with a stand-in `systemctl` on `PATH` so the
Linux discovery path has units to report on (this container has no openclaw units, and the CLI
exits 1 before printing when discovery is empty).

| Probe | Condition | `voicestudio` row | Exit |
|---|---|---|---|
| 1 | dir exists, port 3900 shut | `CLOSED … 3900 closed` | **0** |
| 2 | listener on 3900 | `LIVE … 3900 open` | **0** |
| 3 | same, plus `OPENCLAW_BRIDGE_DIR` set so companion-bridge is `DOWN` | `CLOSED` | **1** |
| 4 | dir does not exist | `ABSENT … 3900 closed` | **0** |

**Probe 3 is the falsification.** In one table, one external app reported `DOWN` and one `CLOSED`.
The exit went to 1 — traceable to the bridge alone, since probe 1 is the identical run without it.
So the exit code is genuinely sensitive to a failing external app and genuinely exempt from a closed
one; the CLOSED row is not passing because the predicate is inert.

### Regression guard — full root suite, like-for-like

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| baseline `768930f` (worktree) | 2167 | 1881 | **211** | 7 |
| branch, this step | 2175 | 1889 | **211** | 7 |

Failure lists diffed by name: **identical**, 75 failing files on both sides — the only line comm
reported is the same `readonly-sql.test.mjs` under two worktree paths. (These 211 are the container's
standing environmental failures: no NATS, no ollama, no `~/.openclaw` runtime.) The two extra passes
beyond the six new cases are the new suite's own entry and `mission-control eslint gate is not
vacuous`, which the baseline worktree **SKIP**ped for want of `mission-control/node_modules` — an
artifact of the worktree, not of this diff.

## Deliberately unchanged

companion-bridge keeps flipping the exit code when its repo exists and :8787 is shut. It is a
process this script itself spawns on `up`, not a GUI app the operator opens on demand — giving it
the same exemption is a separate decision, not a side effect of adding a voice row.

## Config

`openclaw.env.example` documents `OPENCLAW_VOICESTUDIO_DIR` (default `/Applications/VoiceStudio.app`,
the upstream artifact being an Apple Silicon DMG) beside 3.1's block, noting it is what lets the
table tell CLOSED from ABSENT.

## Left open

On the design box the row's `LIVE` should be seen with the real app open — the probes above used a
listener on 3900 and a directory, which is exactly what the row inspects, but not the app itself.
4.2 reuses `externalAppRow` verbatim for God's Eye View on 4173.
