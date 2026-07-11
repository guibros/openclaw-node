# CONTINUATION_BLOCKED — 2026-07-11 Montreal

**Step**: 2.4 (`v2.4-pre`)
**Phase you were in**: Phase 4 (implement)
**Trigger**: Cannot produce runtime evidence headless — the Claude Code sandbox blocks background process launch (`&`, `nohup`) and file redirection required to start mesh-task-daemon + mesh-bridge + mesh-agents. The services must be started from a real terminal.
**External action:** Run the mesh stack + circling session manually from a terminal using the script in §How to resume below. The session takes ~15–35 minutes (qwen3:8b, 18 inferences max). After session completes, review the artifacts (this IS the `visual:` gate from 2.4's Verify contract). If artifacts are acceptable, record the evidence in `audits/step24_real-adversarial-run/AUDIT_PRE.md §5` and delete this file. The next tick closes the step.

## What failed

The Claude Code sandbox blocked every approach to start background processes:
- `command &` → rejected (shell operators)
- `nohup ... &` → rejected (shell operators)
- `cmd > /tmp/file` → rejected (output redirection)

Mesh-task-daemon, mesh-bridge, and 3 mesh-agents need to run as concurrent background processes while the NATS session progresses. Without these processes the NATS `mesh.tasks.submit` request has no responder.

## What's needed from the user

1. A terminal with `cd /Users/moltymac/openclaw-nodedev`
2. ~15–35 minutes of free GPU time (qwen3:8b fully serialized; other LLM workloads will stall)
3. Ollama running with qwen3:8b (confirmed: `curl localhost:11434/api/tags` → qwen3:8b present)

## How to resume

Run these commands from a terminal at `/Users/moltymac/openclaw-nodedev`:

### Step A — Start the mesh stack

```bash
# Start mesh-task-daemon
OPENCLAW_NODE_ID=alpha nohup node bin/mesh-task-daemon.js > /tmp/mesh-daemon-24.log 2>&1 &
echo "daemon PID: $!"
sleep 2

# Start mesh-bridge
OPENCLAW_NODE_ID=alpha nohup node bin/mesh-bridge.js > /tmp/mesh-bridge-24.log 2>&1 &
echo "bridge PID: $!"
sleep 2

# Start 3 mesh-agents (real LLM — qwen3:8b via ollama)
OPENCLAW_NODE_ID=alpha MESH_LLM_PROVIDER=ollama LLM_MODEL=qwen3:8b \
  nohup node bin/mesh-agent.js > /tmp/mesh-agent-alpha-24.log 2>&1 &
echo "agent alpha PID: $!"

OPENCLAW_NODE_ID=bravo MESH_LLM_PROVIDER=ollama LLM_MODEL=qwen3:8b \
  nohup node bin/mesh-agent.js > /tmp/mesh-agent-bravo-24.log 2>&1 &
echo "agent bravo PID: $!"

OPENCLAW_NODE_ID=charlie MESH_LLM_PROVIDER=ollama LLM_MODEL=qwen3:8b \
  nohup node bin/mesh-agent.js > /tmp/mesh-agent-charlie-24.log 2>&1 &
echo "agent charlie PID: $!"

sleep 3
echo "Services started. Verifying..."
ps aux | grep "mesh-task-daemon\|mesh-bridge\|mesh-agent" | grep -v grep
```

### Step B — Submit the task

```javascript
// Save as /tmp/fed-submit.js and run: node /tmp/fed-submit.js
// (from /Users/moltymac/openclaw-nodedev/)

const { connect, StringCodec } = require('nats');
const { NATS_URL, natsConnectOpts } = require('./lib/nats-resolve');
const sc = StringCodec();

const TASK_ID = 'fed-2.4-spec-harden-' + Date.now();
const TASK_DESC = [
  'Fix three documented defects in docs/FEDERATION_SPEC.md.',
  'Do NOT change any section not listed. For each defect, produce the corrected text block',
  'and a one-line rationale citing the real interface at file:line.',
  '',
  '--- DEFECT F1 --- Timestamp field mismatch + false event_id attribution ---',
  '',
  'Current spec SS5.1 (line 338), SS5.2 (line 365), SS5.3 (line 404) use: issued_at: "<ISO timestamp>"',
  'WRONG: lib/node-identity.mjs:419-432 checkEventFreshness reads event.timestamp, not issued_at.',
  'Any envelope with issued_at fails freshness verification (reason: missing-timestamp).',
  '',
  'Current spec SS5.1 line 343 and SS5.2 line 369 attribute event_id to signEvent.',
  'WRONG: lib/node-identity.mjs:374-404 signEvent returns {signature, signer_pubkey} only.',
  'event_id is caller-injected BEFORE signEvent is called.',
  '',
  'Fix F1:',
  '- Change issued_at to timestamp in SS5.1, SS5.2, SS5.3 envelope schemas.',
  '- Correct event_id note: "caller-injected before signEvent is called" (not from signEvent).',
  '',
  '--- DEFECT F2 --- Missing signer_node_id field ---',
  '',
  'Current spec: envelopes carry signer_pubkey but no signer_node_id.',
  'lib/node-identity.mjs verifyEvent accepts opts.expectedNodeId for registry impersonation defense.',
  'Without signer_node_id on the envelope, receivers cannot run this check.',
  '',
  'Fix F2: Add signer_node_id: "<node id>" alongside signer_pubkey in SS5.1, SS5.2, SS5.3.',
  '',
  '--- DEFECT F4 --- Wrong session mode discriminator ---',
  '',
  'Current spec SS3 prose + SS3.1/SS3.2/SS3.3 anchors: session.architecture = "adversarial" etc.',
  'Current spec SS4.1: session.type = "management"',
  'WRONG: lib/mesh-collab.js:54-59 createSession uses: mode: collabSpec.mode || COLLAB_MODE.PARALLEL',
  'lib/mesh-collab.js:34: CIRCLING_STRATEGY = "circling_strategy"',
  'The real discriminator is session.mode. session.architecture and session.type do not exist.',
  '',
  'Fix F4:',
  '- SS3 prose: replace "session architecture field" with "session.mode field".',
  '- SS3.1/SS3.2/SS3.3 anchors: session.architecture = X -> session.mode = circling_strategy / cooperative / collaborative.',
  '- SS4.1: session.type = "management" -> session.mode = "management".',
  '',
  '--- ACCEPTANCE ---',
  'For each of F1/F2/F4: corrected schema/text block + one-line rationale citing file:line.',
  'No changes outside these three defects.',
].join('\n');

async function main() {
  const nc = await connect({ ...natsConnectOpts(), servers: NATS_URL });
  const payload = JSON.stringify({
    task_id: TASK_ID,
    title: 'Harden FEDERATION_SPEC envelope + session schemas (audit F1/F2/F4)',
    description: TASK_DESC,
    budget_minutes: 90,
    metric: 'Quality of spec corrections for F1/F2/F4 with file:line rationale',
    collaboration: { mode: 'circling_strategy', max_subrounds: 2, automation_tier: 1 },
  });
  const resp = await nc.request('mesh.tasks.submit', sc.encode(payload), { timeout: 15000 });
  const result = JSON.parse(sc.decode(resp.data));
  if (result.error) { console.error('SUBMIT_ERROR:', result.error); await nc.close(); process.exit(1); }
  const task = result.task || result;
  const sessionId = task.session_id || result.session_id || '(check daemon log)';
  console.log('TASK_ID:', TASK_ID);
  console.log('SESSION_ID:', sessionId);
  console.log('START_MS:', Date.now());
  await nc.close();
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
```

### Step C — Monitor until complete

```bash
# Replace SESSION_ID with the value from Step B output
SESSION_ID="<from step B>"
while true; do
  STATUS=$(nats kv get MESH_COLLAB "$SESSION_ID" 2>/dev/null | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null)
  echo "[$(date '+%H:%M:%S')] session status: $STATUS"
  [ "$STATUS" = "completed" ] && echo "SESSION COMPLETE" && break
  [ "$STATUS" = "aborted" ] && echo "SESSION ABORTED — check daemon log" && break
  sleep 30
done

# Capture final KV state
nats kv get MESH_COLLAB "$SESSION_ID"
```

### Step D — Retrieve and review the artifacts

```bash
# Get the session object (contains result.artifact_key and result.summary)
nats kv get MESH_COLLAB "$SESSION_ID" | python3 -m json.tool

# For each artifact key in result.artifact_key (or circling.artifacts), retrieve:
# nats kv get MESH_COLLAB "$SESSION_ID.result" 2>/dev/null || true
```

**Review the worker's final workArtifact.** Verify it addresses F1 (issued_at→timestamp + event_id correction), F2 (signer_node_id added), and F4 (session.mode instead of session.architecture). Judge quality: ACCEPT / REJECT / NEEDS_WORK.

### Step E — Record evidence and resume

1. **Fill in `audits/step24_real-adversarial-run/AUDIT_PRE.md §5`** with the session_id, wall-clock, inference count, convergence round, and your ACCEPT/REJECT verdict.

2. **Write `v2.4-mid` to `memory-plan/plans/federation/VERSION`:**
   ```bash
   echo v2.4-mid > memory-plan/plans/federation/VERSION
   ```

3. **Delete this file:**
   ```bash
   rm memory-plan/plans/federation/BLOCKED.md
   ```

4. The next tick will pick up at Phase 7 (AUDIT_POST → Phase 8 → commit → close).

### Step F — Stop the services when done

```bash
# Find and stop background processes
pkill -f "mesh-task-daemon.js" || true
pkill -f "mesh-bridge.js" || true
pkill -f "mesh-agent.js" || true
```

## State at block

- `memory-plan/plans/federation/VERSION`: `v2.4-pre`
- Working tree (`git status -s`): `?? .codex/` (only untracked .codex dir)
- Last successful commit: `8e3dd65` `federation: D8 — record the first real adversarial task (harden FEDERATION_SPEC F1/F2/F4)`
- Last completed step: `2.3` (`v2.3`)
- Currently-attempted step: `2.4` (`v2.4-pre`)
