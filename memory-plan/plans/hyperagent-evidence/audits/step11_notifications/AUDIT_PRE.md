# AUDIT_PRE — step 1.1: durable idempotent notifications (2026-07-21)

**Before code.** Contract: INVENTORY 1.1 (amendment included: reflections AND proposals).

## Probed reality
- lib/notify.mjs `notify()`: every call appends a NEW ledger event with `crypto.randomUUID()` —
  **no dedup exists**; the exactly-once contract must be built. Ledger = append-only JSONL,
  currently 3,770 lines / 2.3MB (linear scan affordable at drain frequency).
- Pending-row creation sites: reflections — daemon maintenance (mechanical); proposals — CLI
  `reflect --write-synthesis` (operator workflow). Both write ha_* in state.db.

## Design (the Phase-1 outbox decision → DECISIONS D2 at close)
1. **notify() stable-id dedup** (lib/notify.mjs): optional `input.id`; when provided, scan the
   ledger for that id first — if present, return `{deduped: true, id}` WITHOUT dispatch or
   append. Absent → normal dispatch+append using the caller id. Random-UUID path unchanged for
   every existing caller.
2. **Outbox = ha_notify_outbox in state.db** (the durable obligation, same transaction as row
   creation): `(id PK, item_type reflection|proposal, item_id, event_id UNIQUE, delivered_at)`.
   Enqueue INSIDE putReflection's and putProposal's transactions — creation and obligation are
   atomic by construction. event_id = `hyperagent-reflection:<id>` / `hyperagent-proposal:<id>`.
3. **drainNotifyOutbox(deliver)** (store): for each undelivered row call deliver(evt) →
   mark delivered. deliver = notify() with the stable id; crash between dispatch and mark →
   retry re-calls notify → ledger dedup returns deduped → mark proceeds. Exactly one ledger
   identity per obligation under any crash/retry interleaving.
4. **Drain hooks**: daemon HyperAgent maintenance block (covers daemon-created reflections +
   anything left over) and CLI after write-synthesis (immediate proposal signal). Notification
   payload: kind=info, source=hyperagent, click-through URL → MC page (1.2 target; the URL is
   valid-but-plain until 1.2 lands — noted).
5. **Tests**: notify dedup (same id twice → one ledger line, second returns deduped);
   outbox atomicity (pending row ⇒ obligation row, same transaction — crash-window simulated by
   inspecting both after a throwing deliver); interrupt+retry×2 → one ledger event; concurrent
   drains → one identity (UNIQUE event_id + dedup).
6. **Runtime verify** (this node): scratch-DB reflection + proposal drained through the REAL
   notify() → exactly one ledger event each in the production ledger (source=hyperagent,
   click-through URL), retry drain → no new events; desktop popups fire once each (operator
   will see two popups — expected).

## Risks
Ledger scan cost grows with file size — bounded by log-rotate (bin/log-rotate exists); note for
3.3 retention if it ever matters.
