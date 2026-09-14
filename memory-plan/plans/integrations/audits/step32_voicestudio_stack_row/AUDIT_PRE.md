# AUDIT_PRE — step 3.2 · VoiceStudio row in `openclaw-stack`

**Opened:** 2026-09-14, Montreal · **Carrier:** `v3.2-pre`

## What the code actually does today (read, not assumed)

`bin/openclaw-stack.mjs` builds its table from launchd/systemd unit discovery, then pushes exactly
one hand-written row for an external app with no service unit (lines 115–119): companion-bridge,
`LIVE` when :8787 answers, else `DOWN` if `BRIDGE_DIR` exists, else `ABSENT`. `PORTS` (lines 32–37)
holds five ports; VoiceStudio is absent from all of it, as 3.1's registry row recorded.

**The premise in the INVENTORY row needs a correction.** It asks for `LIVE / DOWN / ABSENT` *and*
exit 0 when the app is closed. Those two cannot both hold: the `status` and `up` commands exit
`rows.some(r => r.status === 'DOWN') ? 1 : 0` (lines 241, 246). A `DOWN` VoiceStudio row would flip
the exit code by construction, and `openclaw-stack status` is what the operator and any wrapper
script read. Listing the row and then filtering it out of one predicate would leave the word DOWN
printed next to an app that is behaving normally.

So the status token itself carries the distinction: **`CLOSED`** for an installed desktop app that
is not open. It is not `DOWN`, so the exit predicate and `notifyResult`'s `bad` set
(`status === 'DOWN' || status === 'OFF'`, line 209) skip it with no filter added to either — the
row is report-only by construction rather than by a special case. This is the honest shape: a
launchd daemon that is not running is a fault, an on-demand desktop app that is not open is not.

One real change is still needed. `notifyResult` counts `live` and `total` over every row, so a
closed VoiceStudio would make the popup read "6/7 up" and imply something is wrong. Report-only
rows are excluded from that count.

## Scope of the change

- `EXTERNAL_APPS`-style row for `voicestudio`: port 3900, dir from `OPENCLAW_VOICESTUDIO_DIR`,
  defaulting to `/Applications/VoiceStudio.app` (the upstream artifact is an Apple Silicon DMG).
- `statusTable` pushes it beside the bridge row, marked `reportOnly`.
- `notifyResult` counts only rows that are not report-only.
- `openclaw.env.example` documents `OPENCLAW_VOICESTUDIO_DIR` next to the 3.1 block.

Deliberately **not** changed: companion-bridge keeps flipping the exit code when its repo exists and
the port is closed. It is a bridge process this script itself spawns on `up`, not a GUI app — and
changing its semantics is a separate decision, not a side effect of adding a voice row.

## Verify

- `code:` unit tests over the row builder and the counter: LIVE when the port answers, CLOSED when
  the dir exists and the port does not, ABSENT when neither; the row never appears in `bad`; a
  report-only row does not move `live`/`total`.
- `runtime:` `node bin/openclaw-stack.mjs status` with a real listener on 3900 (row LIVE) and
  without one (row CLOSED, **exit 0**), against real discovered units.
