# AUDIT_POST — step 1.1 CLOSED: durable idempotent notifications (2026-07-21)

## Delivered
- **notify() stable-id dedup** (lib/notify.mjs): caller-supplied `input.id` makes the event
  idempotent — ledger already carries it ⇒ `{deduped:true}`, no dispatch, no append. Random-UUID
  path untouched for all existing callers.
- **ha_notify_outbox** (state.db): obligation enqueued INSIDE putReflection's and putProposal's
  transactions (creation and operator-signal obligation atomic by construction); UNIQUE event_id
  `hyperagent-reflection:<id>` / `hyperagent-proposal:<id>`.
- **drainNotifyOutbox(deliver)**: mark-after-deliver; any crash/retry interleaving lands exactly
  one ledger identity (outbox retry + ledger dedup compose).
- **Hooks**: daemon HyperAgent maintenance block (own try/catch — a drain failure can't skip
  other maintenance and blocks throttle persistence for retry); CLI fires immediately after
  write-synthesis (daemon's later drain dedups to no-op). Click-through URL → /hyperagent (page
  is 1.2; DECISIONS D2 records the outbox choice).

## Evidence (all observed)
- Unit: notify same-id twice → one ledger line + deduped return; outbox atomicity via
  interrupted-deliver (obligation attempted, retried to exactly one identity); synthesis creates
  proposal+obligation atomically. Suites 74/0 (store + integration + notify).
- Runtime (isolated OPENCLAW_NOTIFY_HOME, REAL terminal-notifier dispatch): drain1 delivered 2
  (two real popups observed); forced FULL redelivery (delivered_at reset — the worst crash
  window) re-delivered both → ledger still EXACTLY 2 events with stable ids; methods
  terminal-notifier.
- Deployed: daemon + CLI copies updated, kickstarted (PID 20743), suites green post-deploy.

## Confessed en route
First runtime attempt keyed isolation on OPENCLAW_HOME — notifyPaths actually keys on
OPENCLAW_NOTIFY_HOME — so two test events landed in the PRODUCTION ledger, burning the exact
reflection:1/proposal:1 id-space hazard the PRE had flagged. Ledger backed up, the two artifacts
surgically removed (verified: remaining hyperagent-substring matches are the workplan viewer's
legit step-close events), retest fully isolated.
