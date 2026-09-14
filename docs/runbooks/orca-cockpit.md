# Runbook — Orca as the mesh cockpit

**For:** integrations plan step 5.1. This runbook is the *procedure*; 5.1 closes on the probes at the
bottom, run on the design box.
**Status:** not yet performed. Orca is not installed.

Orca is a desktop app for driving agent worktrees. The point here is narrow: **see and drive the
worktrees `bin/mesh-task-daemon.js` already creates**, without adding a second daemon or a second
source of truth. Orca observes; the mesh daemon still owns task lifecycle.

`openclaw` is a **built-in agent** in Orca — `src/shared/tui-agent-config.ts` has an `openclaw` entry
with `detectCmd: 'openclaw'` and the display name "OpenClaw". No custom-agent plumbing needed.

## No `orcad`

Orca can run a headless daemon. **Do not install it** (operator decision, no-new-daemons). Orca is
opened when you want the cockpit and closed when you do not — exactly like VoiceStudio and God's Eye
View. Remote machines are reached through SSH worktrees instead, which Orca supports natively.

## 1. Telemetry off before first launch

Orca's consent resolver (`src/main/telemetry/consent.ts`) checks, in order:

```sh
export DO_NOT_TRACK=1          # → { effective: 'disabled', reason: 'do_not_track' }
```

`ORCA_TELEMETRY_DISABLED` also works (`reason: 'orca_disabled'`), as does opting out in-app
(`reason: 'user_opt_out'`). `DO_NOT_TRACK` is the one to prefer: it is the cross-tool convention and
it is read before the app can send anything. Put it in the launch environment, not just a shell
profile — the app must inherit it.

## 2. Global settings to change

Defaults read from `src/shared/default-global-settings.ts`. Three of them are wrong for this node:

| Setting | Default | Set to | Why |
|---|---|---|---|
| `worktreeVisibilityDefaults.external` | `'hide'` | `'show'` | **The important one.** Worktrees the mesh daemon created are "external" to Orca — it did not make them. Left at `hide`, you open Orca, see nothing, and conclude the integration does not work. |
| `nestWorkspaces` | `true` | `false` | Worktrees live at `~/.openclaw/worktrees/<taskId>`, a flat directory the daemon owns. Nesting would have Orca place new ones inside the repo. |
| `branchPrefix` | `'git-username'` | `'custom'` | With `branchPrefixCustom: 'mesh/'`, so a branch Orca creates is named like one the daemon creates. |

Then the agent launch settings:

- `agentCmdOverrides.openclaw` — the command if `openclaw` is not plainly on PATH.
- `agentDefaultEnv` — the `MESH_*` variables a worker needs. Note this defaults to
  `DEFAULT_TUI_AGENT_ENV`, which is `YOLO_TUI_AGENT_ENV`: **permission-skipping defaults**. Read what
  is there before adding to it, and decide deliberately whether you want an agent Orca launches to
  run with permissions skipped. This node's mesh workers get their guardrails from
  `config/harness-rules.json` and `lib/exec-safety.js`, not from the TUI's prompt.

Per-project, not global: `worktreeBasePath` → `~/.openclaw/worktrees` (it lives in the project host
setup, so it is set once per repo you add).

## 3. Add the repo

Add `openclaw-node` as a project with `worktreeBasePath = ~/.openclaw/worktrees`. Do not let Orca
create the directory scheme — the daemon's layout is the one that exists.

## 4. Automations panel — read-only

Orca's automations panel reads the gateway's `~/.openclaw/cron/jobs.json`. **Nothing in this repo
writes that file.** Anything you schedule there is Orca's and the gateway's, not the mesh daemon's;
do not expect a job created in Orca to show up as a mesh task, and do not schedule mesh work there.

## 5. Coexistence with step 5.2's hook listener

5.2 gives `bin/mesh-agent.js` its own hook endpoint for agent state, launched with a `--settings`
JSON handed to that Claude process. Orca registers its own hooks for agents **it** launches
(`agentStatusHooksEnabled`, default `true`).

These do not collide: each applies to the process that launched it. The rule that keeps it that way
is that **neither writes the user's global `~/.claude/settings.json`** — the mesh agent passes
`--settings` per launch, and Orca configures per agent. If you ever find yourself editing the global
file to make one of them work, stop: that is the collision, and it will break the other.

## Probes that close 5.1

1. Let `bin/mesh-task-daemon.js` create a worktree — a real task, not a hand-made directory. It lands
   at `~/.openclaw/worktrees/<taskId>` on branch `mesh/<taskId>`.
2. `visual:` that worktree appears as a row in Orca. If it does not, check
   `worktreeVisibilityDefaults.external` first — it is `hide` by default and this is the failure it
   produces.
3. `runtime:` `orca worktree list --json` includes the path.

## What this does not do

Orca does not become the task queue. Tasks are created, claimed, leased and reaped by
`bin/mesh-task-daemon.js` against NATS KV; step 5.3's stall window and step 5.4's worktree hygiene
are the daemon's, and Orca showing a worktree does not mean Orca owns it. If the two ever disagree
about what a task is doing, the daemon's KV entry is the truth.
