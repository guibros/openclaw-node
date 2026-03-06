---
name: discord-telegram-triage
description: "Diagnose and fix OpenClaw Discord/Telegram delivery issues: missed replies, allowlist mismatches, unresolved channels, DM policy problems, gateway reconnects. Use when bot appears offline, messages go missing, or channel routing is broken."
triggers:
  - "my discord bot is not responding"
  - "telegram messages are not going through"
  - "fix the channel routing"
  - "bot shows offline in discord"
  - "messages are getting dropped"
negative_triggers:
  - "set up a new discord bot"
  - "create a telegram channel"
  - "post a message to discord"
---

# Discord + Telegram Triage

Use this for channel reliability debugging with fast user feedback.

## Workflow

1. Establish live status
   - Run `openclaw status --deep`.
   - Confirm channel enabled/state plus deep probe timing.

2. Verify routing config
   - Inspect effective config (`gateway config.get`).
   - Check allowlist/policy paths for channel + user + guild.
   - For Discord, prefer stable identifiers (user IDs, channel IDs) over fragile names.

3. Inspect logs for root cause
   - Look for unresolved channel mappings, permission denials, reconnect loops, or restart churn.
   - Separate transport health from routing/authorization issues.

4. Apply minimal config patch
   - Patch only required keys.
   - Keep secure defaults (avoid broad open policies unless user requests temporary bypass).
   - Restart and immediately verify post-change status/logs.

5. Close the loop with user
   - Give one concrete test message format.
   - Confirm receipt path (DM vs guild/channel).
   - If still failing, switch to channel ID pinning and re-test.

## Common pitfalls

- Channel name mismatch (accent/case differences).
- Healthy probe but blocked by allowlist.
- Restart race causing brief offline/grey state in UI.

## Scripts

- `scripts/triage_snapshot.sh`
  - Collects deep status + focused Discord/Telegram log evidence quickly.

## References

- Use `references/discord-runbook.md` for fast diagnosis patterns.
- Use `references/validation-cases.md` for trigger/behavior smoke tests.
