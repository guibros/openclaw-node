# Discord Delivery Runbook

## Quick checks
1. `openclaw status --deep`
2. `openclaw logs --limit 300 --plain`
3. Confirm:
   - channel ON/OK
   - bot account detected
   - no unresolved channel mapping

## Signature -> Action

### `discord channels unresolved: <guild>/<name>`
- Cause: configured channel label does not map to real channel.
- Action: add correct channel name or switch to channel ID allowlist.

### Deep probe OK but no replies
- Cause: allowlist/policy mismatch.
- Action: verify `dm.policy`, `dm.allowFrom`, guild `users`, guild `channels`.

### Bot appears offline/grey intermittently
- Cause: reconnect/restart churn.
- Action: restart gateway once, avoid repeated config churn, retest after stable PID.

## Safe patching
- Prefer narrow `config.patch` updates.
- Re-check effective config after patch.
- Re-run deep status after restart.
