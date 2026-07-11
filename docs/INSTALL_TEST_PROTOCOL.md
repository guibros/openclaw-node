# INSTALL_TEST_PROTOCOL — proving a fresh node actually works

**Status:** authoritative as of 2026-07-11. Companion to [NODE_SPEC.md](NODE_SPEC.md).
Purpose: nobody claims "deployable" again without observed evidence. Levels T0–T6 run on any
machine; **T7 (clean VM/machine) is the only level that proves the fresh-install claim** — everything
else is supporting evidence. The automated core of this protocol is `bin/node-acceptance.mjs`,
which install.sh itself runs as its final phase (exit non-zero on failure).

Honesty rules (MASTER_PLAN §5, NODE_WATCH_SPEC): a probe not run is UNKNOWN, not green. Record
evidence (command + output) for every level you claim.

---

## T0 — Pre-flight (before install)

| Check | Command | Pass |
|---|---|---|
| Node ≥18 | `node -v` | v18+ |
| nats-server | `command -v nats-server \|\| ls /opt/homebrew/bin/nats-server` | present (install.sh installs on Linux/brew-macOS) |
| ollama (unless --skip-llm) | `ollama --version` | present or install.sh installs it |
| Disk | `df -h ~` | ≥20 GB free |
| RAM tier | `node bin/check-llm-baseline.mjs` | prints a tier (exit 2 = below floor → extraction will degrade, expected and honest) |

## T1 — Install exit state (files + renders)

Run `bash install.sh` (no flags), then:

```bash
# 1. Env has the functional parameters (NODE_SPEC §3)
grep -E '^(OPENCLAW_NATS|OPENCLAW_NATS_TOKEN|MESH_LLM_PROVIDER|LLM_MODEL|LLM_BASE_URL)=' ~/.openclaw/openclaw.env
# PASS: all 5 present, token is 64 hex chars, provider=ollama

# 2. No unrendered placeholders anywhere (install aborts on unit placeholders; double-check)
grep -RoE '\$\{[A-Za-z_]+\}' ~/Library/LaunchAgents/ai.openclaw.*.plist ~/.openclaw/config/*.conf 2>/dev/null
# PASS: no output

# 3. The three memory-daemon import kills are closed
ls ~/.openclaw/workspace/lib/mcp-knowledge/core.mjs \
   ~/.openclaw/workspace/lib/mcp-knowledge/node_modules \
   ~/.openclaw/workspace/bin/obsidian-graph-cache.mjs \
   ~/.openclaw/workspace/node_modules/nats
# PASS: all exist

# 4. Repo deps + identity + bus config
ls "$REPO_DIR/node_modules/nats" ~/.openclaw/config/nats.conf ~/.openclaw/identity 2>/dev/null
# PASS: all exist (identity dir contains the ed25519 keypair)

# 5. Every manifest unit rendered (role-filtered count printed by install)
ls ~/Library/LaunchAgents/ai.openclaw.*.plist | wc -l   # macOS lead: 19 files
```

**PASS T1** = all five green. **Nothing is running yet — that is correct** (default install places, `--enable-services` starts).

## T2 — Service liveness

Run `bash install.sh --update --enable-services`, wait for the gate, then independently:

```bash
# Bus answers with auth
curl -s 127.0.0.1:8222/varz | head -3                          # monitor up
# Daemons alive and NOT crash-looping (PID stable across 30s)
launchctl list | grep ai.openclaw                              # or: systemctl --user list-units 'openclaw-*'
for i in 1 2; do ps -eo pid,etime,comm | grep -E 'mesh-task-daemon|memory-daemon|nats-server' | grep -v grep; sleep 30; done
# PASS: same PIDs both samples, etime increasing (a crash-looper resets etime)

# memory-daemon booted past its imports (the 2026-07-11 regression)
grep -c ERR_MODULE_NOT_FOUND ~/.openclaw/workspace/.tmp/memory-daemon.err 2>/dev/null
# PASS: 0 (or file absent)
```

## T3 — Functional memory path (end-to-end)

```bash
# 1. Generate a transcript: run any short Claude Code session in any project
# 2. Watch ingestion
tail -20 ~/.openclaw/workspace/.tmp/memory-daemon.log      # expect: session detected → flush → extraction
# 3. Extraction is LLM-mode, not silently regex
grep -E "mode.*(llm|regex)" ~/.openclaw/workspace/.tmp/memory-daemon.log | tail -3
# PASS: llm (regex acceptable ONLY if --skip-llm or below RAM floor — then it must ALSO show in node-watch)
# 4. Inject answers
curl -s -X POST 127.0.0.1:7893/memory/inject -H 'Content-Type: application/json' \
  -d '{"prompt":"what did we work on"}' | head -c 400
# PASS: JSON with memories/analysisMode (embedding-fallback is a FAIL unless ollama was skipped)
```

## T4 — Functional federation path (one mock circling session)

No cloud auth needed — `MESH_LLM_PROVIDER=shell` mocks the LLM (proven in federation step 2.1):

```bash
export OPENCLAW_NATS=nats://127.0.0.1:4222
export OPENCLAW_NATS_TOKEN=$(sed -n 's/^OPENCLAW_NATS_TOKEN=//p' ~/.openclaw/openclaw.env)
for n in alpha bravo charlie; do
  OPENCLAW_NODE_ID=$n MESH_LLM_PROVIDER=shell node bin/mesh-agent.js >/tmp/agent-$n.log 2>&1 &
done
node bin/openclaw-grappe.mjs form --id wg-test --mode adversarial --members alpha,bravo,charlie
cat > /tmp/circ-test.yaml <<'Y'
task_id: install-test-001
title: install-protocol mock circling
description: echo "mock circling work output"
collaboration:
  mode: circling_strategy
  automation_tier: 1
  max_subrounds: 1
Y
node bin/mesh.js submit /tmp/circ-test.yaml
# Watch the task daemon log for: COLLAB SESSION auto-created → roles assigned (1 worker + 2 reviewers)
# → barriers 3/3 → finalization → status=completed
node bin/mesh.js tasks show install-test-001
pkill -f "mesh-agent.js"    # cleanup
```

**PASS T4** = session reaches `completed` with a converged vote. This closes Gap B empirically.
(Real-LLM variant: drop `MESH_LLM_PROVIDER=shell` — agents inherit `ollama` from the env; budget
15–35 min GPU per session.)

## T5 — The honest map

```bash
node ~/.openclaw/workspace/bin/node-acceptance.mjs            # exit 0 = ACCEPTED
node ~/.openclaw/workspace/bin/node-watch.mjs --once          # WORKING/BROKEN/OFF/UNKNOWN table
```
**PASS T5** = acceptance exit 0 AND node-watch shows no BROKEN on core axes (mem.*, net.*, llm.*
— MC may honestly read BROKEN until its build is fixed; that must be a *known named* exception,
never an unexplained one).

## T6 — Idempotency + update safety

```bash
bash install.sh --update                       # NO --enable-services
launchctl list | grep ai.openclaw              # PASS: everything still RUNNING
# (regression guard: the old installer bare-unloaded every unit here — downed live nodes)
bash install.sh --update --enable-services     # PASS: ends ACCEPTED again
```

## T7 — Clean-machine gate (the only real proof)

On a VM or spare machine with nothing but the OS (+ macOS: brew & node):

1. `git clone <repo> && cd openclaw-node`
2. `bash install.sh --enable-services --role=lead`
3. Everything above: T1 → T5 in order, recording output.
4. Reboot. Re-run T2 + T5 (units must survive a reboot).
5. Sign-off: date, OS/arch, RAM tier, gate report file, and the T4 session id, recorded in the
   plan's audit dir. **Only after a signed T7 may anyone write "fresh install works" anywhere.**

## Failure triage map

| Symptom | First place to look |
|---|---|
| gate REJECTED, net axis | `~/.openclaw/logs/nats.err` (store_dir? token?); `launchctl list \| grep nats` |
| memory-daemon crash-loop | `.tmp/memory-daemon.err` — ERR_MODULE_NOT_FOUND means copy/symlink rules regressed (T1.3) |
| extraction says regex | ollama down or model missing: `curl :11434/api/tags`; `ollama pull $LLM_MODEL` |
| mesh daemons crash-loop | `Cannot find module 'nats'` → repo `npm install` regressed; CONNECTION_REFUSED → bus (net axis) |
| MC BROKEN | `.next` build missing/failed — known queued tsc errors; `npm run dev` interim |
| agents release every task | provider: check `MESH_LLM_PROVIDER` in the *rendered* unit/env, not the template |
