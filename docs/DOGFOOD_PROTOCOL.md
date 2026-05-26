# Dogfood Protocol — OpenClaw Federation Council

This document describes how to run the dogfood harness for a 3-node OpenClaw federation council, how to interpret the metrics it captures, and what "healthy federation" looks like.

The dogfood harness (`bin/dogfood-council.mjs`) is the observability layer for live federation testing. It does not implement federation itself — it subscribes to the same NATS subjects as the federation components and records what happens.

---

## Prerequisites

- **Node.js >= 18** (same as the rest of OpenClaw)
- **NATS cluster running** — see [docs/MULTI_NODE_DEPLOY.md](MULTI_NODE_DEPLOY.md) for setup
- **3 openclaw node trees** — spawned via `bin/spawn-node.mjs` or configured manually
- **Memory daemon running** on at least one node (to produce broadcasts)

---

## Quick Start

### 1. Spawn nodes (if not already done)

```bash
node bin/spawn-node.mjs --id alpha
node bin/spawn-node.mjs --id bravo
node bin/spawn-node.mjs --id charlie
```

### 2. Start the NATS cluster

See [docs/NATS_CLUSTER.md](NATS_CLUSTER.md) or [docs/MULTI_NODE_DEPLOY.md](MULTI_NODE_DEPLOY.md).

### 3. Start node daemons

```bash
OPENCLAW_HOME=~/.openclaw-alpha OPENCLAW_NODE_ID=alpha node workspace-bin/memory-daemon.mjs &
OPENCLAW_HOME=~/.openclaw-bravo OPENCLAW_NODE_ID=bravo node workspace-bin/memory-daemon.mjs &
OPENCLAW_HOME=~/.openclaw-charlie OPENCLAW_NODE_ID=charlie node workspace-bin/memory-daemon.mjs &
```

### 4. Run the dogfood harness

```bash
# Run until SIGINT (Ctrl+C)
node bin/dogfood-council.mjs --node-ids alpha,bravo,charlie

# Run for 24 hours
node bin/dogfood-council.mjs --node-ids alpha,bravo,charlie --duration 86400

# View stats from existing metrics file
node bin/dogfood-council.mjs --stats
```

---

## Metrics Reference

The harness writes one JSON object per line to `~/.openclaw/dogfood-metrics.jsonl`. Each line has:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | ISO 8601 string | When the metric was recorded |
| `type` | string | Event type (see below) |
| `node_id` | string | Source node identifier |
| `data` | object | Type-specific payload |

### Event Types

| Type | Trigger | Data Fields |
|------|---------|-------------|
| `harness_start` | Harness boots | `node_ids`, `metrics_path` |
| `harness_stop` | Harness shuts down | `total_lines` |
| `broadcast` | `context.broadcast.>` observed | `event_id`, `themes`, `entities`, `intensity`, `dedup_key` |
| `offer` | `context.offer.>` observed | `event_id`, `responding_to`, `artifact_count` |
| `accepted` | `context.accepted.>` observed | `event_id`, `responding_to_broadcast`, `accepted_artifacts` |
| `signature_failure` | Bad signature on incoming event | `event_id`, `reason` |
| `dead_peer` | Dead-peer detection in health alert | `alert` |

### Example JSONL

```jsonl
{"ts":"2026-05-26T14:00:00.000Z","type":"harness_start","data":{"node_ids":["alpha","bravo","charlie"],"metrics_path":"~/.openclaw/dogfood-metrics.jsonl"}}
{"ts":"2026-05-26T14:01:23.456Z","type":"broadcast","node_id":"alpha","data":{"event_id":"abc-123","themes":["memory","federation"],"entities":["NATS"],"intensity":"interested","dedup_key":"sha256..."}}
{"ts":"2026-05-26T14:01:24.789Z","type":"offer","node_id":"bravo","data":{"event_id":"def-456","responding_to":"abc-123","artifact_count":2}}
{"ts":"2026-05-26T14:01:30.012Z","type":"accepted","node_id":"alpha","data":{"event_id":"ghi-789","responding_to_broadcast":"abc-123","accepted_artifacts":1}}
```

---

## Aggregated Stats

Run `node bin/dogfood-council.mjs --stats` to see a summary:

| Metric | Description |
|--------|-------------|
| Broadcasts emitted | Total `context.broadcast` events observed |
| Offers received | Total `context.offer` events observed |
| Accepted | Total `context.accepted` events observed |
| Offer-to-acceptance ratio | `accepted / broadcasts` (0.0 - 1.0; higher = more useful offers) |
| Avg round-trip (ms) | Mean time from broadcast to corresponding accepted event |
| Round-trip samples | How many broadcast→accepted pairs contributed to the average |
| Signature failures | Events with bad or tampered ed25519 signatures |
| Dead-peer events | Peer-offline detections from health alerts |
| Duration (sec) | Total harness observation window |

A per-node breakdown shows the same metrics split by `node_id`.

---

## What "Healthy Federation" Looks Like

These thresholds define a well-functioning 3-node council during a 24-hour dogfood run:

### Green (healthy)

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| Broadcasts emitted | >= 10 per active hour | At least some conversations are producing themes |
| Offer-to-acceptance ratio | >= 0.1 (10%) | At least 1 in 10 broadcasts produces a useful offer that gets accepted |
| Avg round-trip | < 30,000 ms (30 sec) | Broadcast → offer → acceptance should complete within 30 seconds |
| Signature failures | 0 | Any non-zero count means key mismatch or tampering — investigate |
| Dead-peer events | < 5 per 24h | Occasional network blips are normal; persistent dead peers indicate connectivity issues |

### Yellow (degraded)

| Metric | Threshold | Action |
|--------|-----------|--------|
| Broadcasts emitted | < 5 per active hour | Check if daemons are running and producing themes |
| Offer-to-acceptance ratio | 0.01 - 0.1 | Retrieval thresholds may be too aggressive; tune `OFFERER_RELEVANCE_THRESHOLD` |
| Avg round-trip | 30,000 - 120,000 ms | Check NATS cluster latency and Ollama response times |
| Dead-peer events | 5-20 per 24h | Check network stability between nodes |

### Red (unhealthy)

| Metric | Threshold | Action |
|--------|-----------|--------|
| Broadcasts emitted | 0 | Daemons are not running or NATS is down |
| Offer-to-acceptance ratio | 0 | No offers are being accepted — check offerer and acceptor logs |
| Avg round-trip | > 120,000 ms (2 min) | Severe latency — check system load and NATS cluster health |
| Signature failures | > 0 | Identity key mismatch — regenerate keys or check for node ID collisions |
| Dead-peer events | > 20 per 24h | Network is unreliable — check firewall rules and NATS cluster routing |

---

## Interpreting Results

### Broadcast Rate

The broadcast rate reflects how actively the council's agents are working. Expect variation by time of day — active coding sessions produce more themes than idle periods. A 24-hour run should show clear active/idle cycles.

Low broadcast rate with active sessions means the broadcaster's theme detection threshold (MIN_THEMES_FOR_BROADCAST = 3) may be too strict for the content being discussed.

### Offer-to-Acceptance Ratio

This is the federation's signal-to-noise ratio. A ratio of 0.0 means peer nodes never had relevant content to offer (or the relevance threshold was too strict). A ratio approaching 1.0 would mean every broadcast produced useful cross-node knowledge — unlikely but ideal.

Expect 0.05-0.30 in practice. The ratio depends on how much overlapping work the council nodes are doing. Nodes working on completely disjoint topics will naturally have a low ratio.

### Round-Trip Time

The round-trip measures broadcast → offer → acceptance latency. This includes:
- NATS message propagation (~1-10ms within a cluster)
- Offerer retrieval pipeline (~100-500ms)
- LLM relevance summary generation (~1-5s if Ollama is available)
- Acceptor token-overlap check (~1ms)

Expected: 2-15 seconds. If consistently above 30 seconds, the bottleneck is likely Ollama/LLM latency on the offerer side.

### Signature Failures

Any non-zero signature failure count warrants investigation. Common causes:
1. **Node identity.key was regenerated** after initial federation setup — peers still have the old public key cached
2. **Node ID collision** — two nodes with the same `OPENCLAW_NODE_ID` but different keypairs
3. **Tampered events** — unlikely in a local dev setup, but the whole point of verification

### Dead-Peer Events

These fire when a node has been silent for longer than `DEAD_PEER_TIMEOUT_MIN` (default: 10 minutes). A few per day is normal (nodes restart, operator pauses work). Persistent dead-peer events for the same node suggest it's down.

---

## Troubleshooting

### No metrics being written

1. Check NATS is running: `nats-server --version` or `curl http://localhost:8222/healthz`
2. Check the harness connected: look for `[dogfood] connected to NATS` in output
3. Check daemons are running: `pgrep -f memory-daemon`

### All zeros in stats

The harness only records events it observes. If no daemons are broadcasting, there are no metrics. Start at least one daemon and have an active Claude Code or other LLM frontend session to generate broadcasts.

### Metrics file grows very large

At ~200 bytes per line, a 24h run with 1 broadcast/minute produces ~280 KB. With 3 active nodes at high cadence, expect 1-5 MB per day. Rotate or archive metrics files between runs.

### NATS connection refused

The harness expects NATS at `nats://localhost:4222` by default. Override with `--nats-url` or `DOGFOOD_NATS_URL` env var if your cluster is on different ports.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOGFOOD_METRICS_PATH` | `~/.openclaw/dogfood-metrics.jsonl` | Metrics output path |
| `DOGFOOD_NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `OPENCLAW_SPAWN_BASE` | `~/.openclaw-` | Base prefix for spawned node trees |

---

## Rollback

The dogfood harness is read-only with respect to federation state — it only observes NATS traffic and writes a local JSONL file. Removing the harness has zero impact on federation operation.

To clean up:
```bash
# Remove metrics file
rm ~/.openclaw/dogfood-metrics.jsonl

# Remove spawned node trees (if desired)
rm -rf ~/.openclaw-alpha ~/.openclaw-bravo ~/.openclaw-charlie
```

---

*Reference: [docs/MULTI_NODE_DEPLOY.md](MULTI_NODE_DEPLOY.md) for full council setup. Step 10.9 of the OpenClaw Memory Plan.*
