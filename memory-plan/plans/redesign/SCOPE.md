# SCOPE — redesign plan

**Status:** active
**Goal:** Re-enable the autonomous tick chain. Baseline is now green (commit a113596:
`kv.update` mock gap + federation signing identities — `npm test` 1366 pass / 0 fail).
Next: give the headless tick (`workspace-bin/redesign-tick.sh`) an `--allowedTools`
allow-list for the verification commands it needs to produce runtime evidence
(nats, curl, lsof, npm, git, jq, launchctl) — under `--print` + `acceptEdits`,
non-allowlisted Bash auto-denies, so runtime-evidence steps (e.g. 1.1's live NATS
round-trip) can never close. Operator chose "Allowlist specific cmds".
**Set at:** 2026-05-29
**Expires:** 2026-05-30T23:59:00Z

```files
workspace-bin/redesign-tick.sh
/Users/moltymac/.claude/projects/-Users-moltymac-openclaw-nodedev/memory/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
