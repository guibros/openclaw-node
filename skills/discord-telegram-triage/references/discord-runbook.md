# Discord Delivery Runbook

## Optional mesh history tool

The separate `ai.openclaw.mesh-tool-discord` service respects
`channels.discord.enabled === false`: it exits successfully without loading
the registry/tracer, connecting to NATS or opening application state. A
present token does not override explicit disabling. Missing-enabled configs
retain legacy token behavior; missing/malformed config or enabled failures
exit unsuccessfully.

With the conditional restart policy, disabled is healthy **loaded, not
running, last exit0**, with one RunAtLoad start after loading. Increasing runs
and exit1 indicate failure. An enabled service should be running. Record these
states separately when taking maintenance baselines and refresh the plist
identity after an approved entry/policy deployment.

A successful planned stop stays down. To restart the loaded Mac tool, use
`launchctl kickstart -k gui/$(id -u)/ai.openclaw.mesh-tool-discord`; on Linux use
`systemctl --user restart openclaw-mesh-tool-discord`. Restarting a disabled
tool does not enable it: it returns to successful inactivity. Mac restarts on
unsuccessful exit; the Linux unit specifies `Restart=on-failure`.

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
