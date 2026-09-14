# AUDIT_PRE — step 4.2 · God's Eye View row in `openclaw-stack`

**Opened:** 2026-09-14, Montreal · **Carrier:** `v4.2-pre`

## Why this is startable while the rest of Block 4 is not

4.2's **Needs** are "3.2 closed (row pattern) or the same pattern applied fresh; env
`OPENCLAW_GEV_DIR`". 3.2 is closed and `externalAppRow` exists. 4.1 appears in 4.2's *Feeds* chain,
not in its Needs — and rightly: the row inspects a TCP port and a directory, so what it can prove
does not depend on God's Eye View being installed, exactly as 3.2 proved VoiceStudio's row without
VoiceStudio.

The rest of Block 4 genuinely cannot start here. 4.1 needs the operator's design box, a Node 24
runtime the node baseline must not adopt, and a `visual:` check on a globe; 4.3 edits an external
clone; 4.5 is an operator decision.

## The premise correction this step inherits

4.2's Goal says the row is "LIVE after 4.1 and **DOWN** with the app stopped, exit 0 either way".
Those are the same two clauses 3.2 could not both satisfy: the exit predicate is
`rows.some(r => r.status === 'DOWN')`, so a `DOWN` row flips the exit code by construction. 3.2
settled it with a `CLOSED` status that is neither `DOWN` nor `OFF`, so the exit predicate and
`notifyCounts`'s `bad` set skip it with no special case. 4.2 inherits that decision rather than
relitigating it; the row reads `CLOSED`, and "exit 0 either way" — the clause that actually matters
to an operator — holds.

## Scope of the change

Two external-app rows now exist, and a third copy-paste is how a resolution rule drifts. The two
hand-pushed call sites become a small `EXTERNAL_APPS` table (`id`, `port`, `dir`) that `statusTable`
loops over, so the id ↔ port ↔ env-var mapping is readable in one place and adding the next app is a
row rather than a code change. `companion-bridge` stays separate and keeps its `DOWN` semantics: it
is a process this script itself spawns on `up`, not a GUI app.

Default dir `~/Documents/openclaw infrastructure/gods-eye-view`, matching D3's "external app tracked
upstream" and the same parent directory `BRIDGE_DIR` already uses; `OPENCLAW_GEV_DIR` overrides.

## Verify

- `code:` the GEV row LIVE / CLOSED / ABSENT, excluded from `bad`, not counted in `live`/`total`;
  the table drives both apps so neither can silently lose its row.
- `runtime:` four `node bin/openclaw-stack.mjs status` runs — a listener on 4173 (LIVE, exit 0), dir
  present and port shut (CLOSED, exit 0), dir absent (ABSENT, exit 0), and the falsifying contrast
  where a `DOWN` external app in the same table does drive exit 1.
