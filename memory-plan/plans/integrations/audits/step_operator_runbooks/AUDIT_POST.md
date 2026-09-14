# AUDIT_POST — the three operator runbooks

**Written:** 2026-09-14, Montreal · Not a plan step: the documentation half of 2.1, 4.1 and 5.1,
whose `Needs` each name a runbook. **No INVENTORY row flips.** Those steps close on runtime probes on
the design box, and this changes nothing about that.

## What shipped

- `docs/runbooks/codebase-memory-mcp.md` (2.1, 2.2)
- `docs/runbooks/gods-eye-view.md` (4.1, 4.3, 4.4)
- `docs/runbooks/orca-cockpit.md` (5.1)

Each ends with the exact probes that close its step, so the operator's remaining work is running
commands rather than re-deriving them from three upstream sources.

## Three things reading the source produced that memory would not have

**God's Eye View can serve perfectly and still read `CLOSED`.** `bin/openclaw-stack.mjs`'s
`probePort` connects to `127.0.0.1` specifically (line 92), while GEV's `vite.config.js` defaults
`host: env.HOST || 'localhost'`. On a Mac with IPv6, `localhost` can bind `::1` only — and then the
status row from step 4.2 says CLOSED next to a working globe. That is why the launch command passes
`--host 127.0.0.1`, and the runbook says so at the point of use rather than leaving it as a magic
flag. The port argument, by contrast, genuinely is redundant: the same config already defaults to
4173, which is worth knowing before someone "fixes" it.

**`watcher_enabled false` does nothing on its own.** Upstream: it "is read once when the background
daemon starts, so run `codebase-memory-mcp daemon stop` after changing it; reconnecting your MCP
client alone will not restart the daemon." Without that line, step 2.1's third probe — no
`codebase-memory-mcp` process after a session — would fail for a reason that looks like the setting
not working.

**Orca's `agentDefaultEnv` default is the YOLO set.** `DEFAULT_TUI_AGENT_ENV` is literally
`YOLO_TUI_AGENT_ENV` — permission-skipping defaults. The original plan said only "`agentDefaultEnv`
with `MESH_*`", which would have had the operator add variables to a set they had not been told the
contents of. The runbook says read it first and decide deliberately.

Also worth having found: `openclaw` is a **built-in** Orca agent (`tui-agent-config.ts:264`,
`detectCmd: 'openclaw'`), so no custom-agent plumbing is needed; and `worktreeVisibilityDefaults`
defaults to `'hide'`, which is the single most likely reason 5.1's probe would appear to fail — the
mesh daemon's worktrees are "external" to Orca, and hidden by default. That is called out as the
first thing to check.

## Evidence

These are documents; the claim is that every factual assertion came from the source rather than from
recollection. Checked mechanically, each printing the cited line:

| Claim | Source |
|---|---|
| `probePort` dials `127.0.0.1` | `bin/openclaw-stack.mjs:92` |
| GEV dev defaults `localhost` / 4173 | `vite.config.js:7764-7766` |
| GEV engines `>=24.14.0 <25 \|\| >=26 <27` | its `package.json` |
| `openclaw` is a built-in agent | `orca/src/shared/tui-agent-config.ts:264` |
| `external: 'hide'`, `nestWorkspaces: true`, `branchPrefix: 'git-username'` | `orca/src/shared/default-global-settings.ts:34,35,41` |
| `agentDefaultEnv` = `YOLO_TUI_AGENT_ENV` | `orca/src/shared/tui-agent-launch-defaults.ts:12-13` |
| `DO_NOT_TRACK` checked before `ORCA_TELEMETRY_DISABLED` | Orca `telemetry/consent.ts:78,82` |
| GEV default dir matches `OPENCLAW_GEV_DIR`'s | `bin/openclaw-stack.mjs:39` |
| `watcher_enabled` read once; `daemon stop` required | upstream README §Auto-Index |
| 14 tools in two tables, badge says 15 | upstream README §Indexing, §Querying |

The last row is recorded as a discrepancy rather than resolved: the runbook lists the 14 it can name
and tells the operator to enumerate from the installed binary when writing 2.2's wrapper skill,
because the binary is the authority and the README is not.

No code changed, so no suite run is claimed. `plan-lint.sh integrations` stays CONFORMANT and
`BLOCKED.md` remains in force — the plan is still blocked, with less reading in front of the
operator than it had.
