# Multi-Node Deployment Guide

Deploy a 3-node OpenClaw council on real hardware. This guide covers single-machine dev setup and multi-machine (VM/bare-metal) deployment for macOS and Linux.

---

## Prerequisites

Each node machine needs:

| Dependency | Version | Install |
|-----------|---------|---------|
| Node.js | ≥18.0 | [nodejs.org](https://nodejs.org) or `nvm install 18` |
| nats-server | ≥2.6.0 (JetStream) | macOS: `brew install nats-server` · Linux: [nats.io/download](https://nats.io/download/) |
| nats CLI (optional) | any | `brew install nats-io/nats-tools/nats` or [github.com/nats-io/natscli](https://github.com/nats-io/natscli) |
| Ollama (optional) | ≥0.24 | [ollama.com](https://ollama.com) — needed for LLM extraction + concept summaries |

Verify:

```bash
node --version       # ≥ v18.0.0
nats-server --version # ≥ v2.6.0
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     NATS Cluster (R=3)                          │
│                                                                 │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐            │
│  │ nats-1     │◄──►│ nats-2     │◄──►│ nats-3     │            │
│  │ :4222/:6222│    │ :4223/:6223│    │ :4224/:6224│            │
│  └─────┬──────┘    └─────┬──────┘    └─────┬──────┘            │
│        │                 │                 │                    │
└────────┼─────────────────┼─────────────────┼────────────────────┘
         │                 │                 │
   ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐
   │  Node A   │    │  Node B   │    │  Node C   │
   │ (alpha)   │    │ (bravo)   │    │ (charlie) │
   │ daemon    │    │ daemon    │    │ daemon    │
   │ promoter  │    │ promoter  │    │ promoter  │
   │ subscriber│    │ subscriber│    │ subscriber│
   │ offerer   │    │ offerer   │    │ offerer   │
   │ acceptor  │    │ acceptor  │    │ acceptor  │
   └───────────┘    └───────────┘    └───────────┘
```

Each node runs independently with its own state database, identity keypair, and workspace. The NATS cluster provides R=3 JetStream replication for the `OPENCLAW_SHARED` stream that carries federation events (broadcasts, offers, acceptances, promoted concepts, kanban events).

---

## Part 1: Single-Machine Dev Setup

All 3 nodes run on one machine. Useful for development and testing.

### 1.1 Start the NATS cluster

> **Use the RENDERED configs, not the repo templates.** The files at
> `services/nats/nats-{1,2,3}.conf` are templates containing a literal
> `${OPENCLAW_NATS_TOKEN}` placeholder — starting them raw gives the server a
> garbage token while every installed client sends the real generated one
> (auth mismatch, nothing connects). `install.sh` renders them with the token
> to `~/.openclaw/config/nats-{1,2,3}.conf`. (A fresh single-node install runs
> `~/.openclaw/config/nats.conf` instead — the cluster is the upgrade path.)

```bash
# install.sh already created the data/log dirs and rendered the configs.
# Start all three NATS servers from the RENDERED configs:
nats-server -c ~/.openclaw/config/nats-1.conf &
nats-server -c ~/.openclaw/config/nats-2.conf &
nats-server -c ~/.openclaw/config/nats-3.conf &

# Or load the installed units: launchctl load ~/Library/LaunchAgents/ai.openclaw.nats-{1,2,3}.plist
```

Verify the cluster formed:

```bash
# Should show 2 routes (connections to the other 2 nodes)
curl -s http://localhost:8222/routez | python3 -c "
import sys, json; data = json.load(sys.stdin)
print(f'Routes: {len(data.get(\"routes\", []))} (expect 2)')
"

# JetStream enabled on all three
for port in 8222 8223 8224; do
  echo "--- Monitor :$port ---"
  curl -s http://localhost:$port/jsz | python3 -c "
import sys, json; d = json.load(sys.stdin)
print(f'  JetStream: {d.get(\"server_id\",\"?\")[:8]} store={d.get(\"config\",{}).get(\"store_dir\",\"?\")}')
"
done
```

### 1.2 Spawn node trees

Each node gets an isolated directory tree under `~/.openclaw-<nodeid>/`.

```bash
node bin/spawn-node.mjs --id alpha   --port 7900 --nats-url nats://localhost:4222
node bin/spawn-node.mjs --id bravo   --port 7901 --nats-url nats://localhost:4223
node bin/spawn-node.mjs --id charlie --port 7902 --nats-url nats://localhost:4224
```

This creates:

```
~/.openclaw-alpha/
  config/node.json       # { id, port, nats_url, created_at }
  workspace/             # MEMORY.md, .companion-state.md, etc.
  workspace/memory/      # daily memory files
  obsidian-local/        # concepts/, decisions/, sessions/, themes/, daily/
  artifacts/             # content-addressed artifact store
  logs/
  state/                 # state.db (SQLite)
```

### 1.3 Generate identity keypairs

Each node needs an ed25519 keypair for signing federation events.

```bash
# Generate identity for each node (idempotent — skips if key exists)
node -e "
import { getOrCreateIdentity } from './lib/node-identity.mjs';
const id = getOrCreateIdentity('$HOME/.openclaw-alpha');
console.log('alpha pubkey:', id.publicKeyBase64);
"

node -e "
import { getOrCreateIdentity } from './lib/node-identity.mjs';
const id = getOrCreateIdentity('$HOME/.openclaw-bravo');
console.log('bravo pubkey:', id.publicKeyBase64);
"

node -e "
import { getOrCreateIdentity } from './lib/node-identity.mjs';
const id = getOrCreateIdentity('$HOME/.openclaw-charlie');
console.log('charlie pubkey:', id.publicKeyBase64);
"
```

Each call creates `identity.key` (private, mode 0600) and `identity.pub` (public) in the node root. The public key (base64) is embedded in signed events as `signer_pubkey`.

**Security:** `identity.key` is the node's signing key. Protect it — anyone with this file can forge events as this node. Verification is STRICT: events with invalid signatures are silently dropped.

### 1.4 Verify the shared stream

The memory daemon creates the `OPENCLAW_SHARED` JetStream stream (R=3) on startup. You can verify manually:

```bash
# Run ensureSharedStream against the cluster
node -e "
import { connect } from 'nats';
import { ensureSharedStream, inspectSharedStream, verifySharedStreamConfig }
  from './lib/shared-event-stream.mjs';

const nc = await connect({ servers: 'nats://localhost:4222' });
const info = await ensureSharedStream(nc);
console.log('Stream created/verified:', info.config.name);

const status = await inspectSharedStream(nc);
const check = verifySharedStreamConfig(status);
console.log('R=3 valid:', check.valid, check.reasons.length ? check.reasons : '');

await nc.drain();
"
```

Expected output:
```
Stream created/verified: OPENCLAW_SHARED
R=3 valid: true
```

If `R=3 valid: false`, ensure all 3 NATS nodes are clustered before creating the stream.

### 1.5 Start the daemons

Start each node's memory daemon with the appropriate environment:

```bash
# Node alpha
OPENCLAW_NODE_ID=alpha \
OPENCLAW_HOME=$HOME/.openclaw-alpha \
NATS_URL=nats://localhost:4222 \
node workspace-bin/memory-daemon.mjs &

# Node bravo
OPENCLAW_NODE_ID=bravo \
OPENCLAW_HOME=$HOME/.openclaw-bravo \
NATS_URL=nats://localhost:4223 \
node workspace-bin/memory-daemon.mjs &

# Node charlie
OPENCLAW_NODE_ID=charlie \
OPENCLAW_HOME=$HOME/.openclaw-charlie \
NATS_URL=nats://localhost:4224 \
node workspace-bin/memory-daemon.mjs &
```

The daemon will:
1. Connect to NATS with auto-reconnect (infinite retries, 2s wait, 1s jitter)
2. Ensure `OPENCLAW_SHARED` stream exists with R=3
3. Refuse to start if the shared stream exists with wrong config
4. Log reconnect/disconnect/error events to stdout

### 1.6 End-to-end round-trip test

Verify the council pattern works: node A broadcasts, nodes B and C offer, A accepts.

```bash
# Run the 3-node integration test (requires nats-server on PATH)
npm test -- --test-name-pattern="federation-3node"
```

Or manually trigger a broadcast and observe:

```bash
# Publish a test broadcast from alpha
node -e "
import { connect } from 'nats';
import { StringCodec } from 'nats';
const nc = await connect({ servers: 'nats://localhost:4222' });
const sc = StringCodec();
const js = nc.jetstream();
const broadcast = {
  event_type: 'context.broadcast',
  event_id: 'test-' + Date.now(),
  node_id: 'alpha',
  timestamp: new Date().toISOString(),
  data: {
    themes: ['deployment', 'federation', 'testing'],
    entities: ['NATS', 'OpenClaw'],
    problem_class: 'debugging',
    intensity: 'actively_seeking',
    dedup_key: 'test-dedup-' + Date.now(),
    ttl_seconds: 300
  }
};
await js.publish('context.broadcast.alpha', sc.encode(JSON.stringify(broadcast)));
console.log('Broadcast published. Check bravo/charlie logs for offer activity.');
await nc.drain();
"
```

---

## Part 2: Multi-Machine Deployment

Each machine runs one NATS node and one OpenClaw node.

### 2.1 Machine preparation

On each machine:

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs   # Debian/Ubuntu
# or: brew install node           # macOS

# Install nats-server
# Linux:
curl -L https://github.com/nats-io/nats-server/releases/latest/download/nats-server-v2.10.24-linux-amd64.tar.gz | \
  sudo tar -xz -C /usr/local/bin --strip-components=1 --wildcards '*/nats-server'
# macOS:
brew install nats-server

# Clone the repo
git clone <repo-url> ~/openclaw-nodedev
cd ~/openclaw-nodedev
npm install
```

### 2.2 NATS cluster config

**Automated (recommended).** On each machine, point the installer at the OTHER machines'
addresses — it renders that machine's `~/.openclaw/config/nats.conf` (binds `0.0.0.0`, routes
to the peers) and records the R=3 replica target (`OPENCLAW_KV_REPLICAS`) in `openclaw.env`:

```bash
# Machine A (100.64.0.1) — peers are B and C:
bash install.sh --cluster-peers=100.64.0.2,100.64.0.3
# Machine B (100.64.0.2):
bash install.sh --cluster-peers=100.64.0.1,100.64.0.3
# Machine C (100.64.0.3):
bash install.sh --cluster-peers=100.64.0.1,100.64.0.2
```

This replaces the single-node `nats.conf` with the cross-machine cluster config from
`services/nats/nats-cluster-node.conf`. **Order of operations matters:** start `nats-server` on
ALL machines first (so the cluster forms and can hold 3 replicas), THEN start the daemons — a
stream can't be created at R=3 until ≥3 cluster members are up.

**Manual (what the automated path produces).** Each machine's config, routes → peer IPs:

**Machine A** (e.g., `10.0.1.10`):
```
# /etc/openclaw/nats.conf
server_name: openclaw-nats-1
listen: 0.0.0.0:4222
http_port: 8222

jetstream {
  store_dir: /var/lib/openclaw/nats/jetstream
  max_mem: 256MB
  max_file: 1GB
}

cluster {
  name: openclaw-cluster
  listen: 0.0.0.0:6222
  routes = [
    nats-route://10.0.1.11:6222
    nats-route://10.0.1.12:6222
  ]
}
```

**Machine B** (`10.0.1.11`): same, but routes point to A and C.
**Machine C** (`10.0.1.12`): same, but routes point to A and B.

All machines use port 4222 (client), 6222 (cluster), 8222 (monitor) since they are on separate hosts.

### 2.3 Firewall rules

Open between all three machines:

| Port | Protocol | Purpose |
|------|----------|---------|
| 4222 | TCP | NATS client connections |
| 6222 | TCP | NATS cluster gossip + replication |
| 8222 | TCP | HTTP monitoring (restrict to admin network) |

```bash
# UFW (Ubuntu/Debian)
sudo ufw allow from 10.0.1.0/24 to any port 4222,6222,8222 proto tcp

# firewalld (RHEL/CentOS)
sudo firewall-cmd --permanent --add-rich-rule='
  rule family="ipv4" source address="10.0.1.0/24"
  port port="4222" protocol="tcp" accept'
sudo firewall-cmd --permanent --add-rich-rule='
  rule family="ipv4" source address="10.0.1.0/24"
  port port="6222" protocol="tcp" accept'
sudo firewall-cmd --permanent --add-rich-rule='
  rule family="ipv4" source address="10.0.1.0/24"
  port port="8222" protocol="tcp" accept'
sudo firewall-cmd --reload
```

### 2.4 Tailscale deployment

If machines are on a [Tailscale](https://tailscale.com) network, use Tailscale IPs (100.x.y.z) in the NATS routes. No firewall changes needed — Tailscale handles the mesh.

```bash
# Get each machine's Tailscale IP
tailscale ip -4
# e.g., Machine A: 100.64.0.1, B: 100.64.0.2, C: 100.64.0.3
```

Machine A's `cluster.routes`:
```
routes = [
  nats-route://100.64.0.2:6222
  nats-route://100.64.0.3:6222
]
```

### 2.5 Start NATS (systemd)

On each machine:

```ini
# /etc/systemd/system/openclaw-nats.service
[Unit]
Description=OpenClaw NATS Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/nats-server --config /etc/openclaw/nats.conf
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable openclaw-nats
sudo systemctl start openclaw-nats

# Verify
sudo systemctl status openclaw-nats
curl -s http://localhost:8222/routez | python3 -m json.tool
```

### 2.6 Per-node setup

On each machine, spawn and configure the openclaw node:

```bash
cd ~/openclaw-nodedev

# Machine A
node bin/spawn-node.mjs --id alpha --nats-url nats://localhost:4222
# Machine B
node bin/spawn-node.mjs --id bravo --nats-url nats://localhost:4222
# Machine C
node bin/spawn-node.mjs --id charlie --nats-url nats://localhost:4222
```

Note: each machine connects to its local NATS instance (`localhost:4222`). NATS cluster routing handles cross-machine communication.

Generate the identity keypair:

```bash
node -e "
import { getOrCreateIdentity } from './lib/node-identity.mjs';
const id = getOrCreateIdentity('$HOME/.openclaw-\$(hostname)');
console.log('Public key:', id.publicKeyBase64);
"
```

### 2.7 Start the daemon (systemd)

```ini
# /etc/systemd/system/openclaw-daemon.service
[Unit]
Description=OpenClaw Memory Daemon
After=openclaw-nats.service
Requires=openclaw-nats.service

[Service]
Type=simple
Environment=OPENCLAW_NODE_ID=%H
Environment=OPENCLAW_HOME=%h/.openclaw-%H
Environment=NATS_URL=nats://localhost:4222
ExecStart=/usr/bin/node /home/user/openclaw-nodedev/workspace-bin/memory-daemon.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable openclaw-daemon
sudo systemctl start openclaw-daemon
```

---

## Part 3: Verification

### 3.1 Cluster health

```bash
# All three NATS nodes see each other
for host in 10.0.1.10 10.0.1.11 10.0.1.12; do
  echo "--- $host ---"
  curl -s http://$host:8222/routez | python3 -c "
import sys, json; d = json.load(sys.stdin)
print(f'  Routes: {len(d.get(\"routes\", []))} (expect 2)')
"
done
```

### 3.2 Shared stream R=3

```bash
# Check from any node
nats stream info OPENCLAW_SHARED --server nats://localhost:4222
# Expect: Replicas: 3, Storage: File
# Expect: 7 subjects (kanban.events.>, lessons.shared.>, concepts.shared.>,
#          context.broadcast.>, context.offer.>, context.accepted.>, artifacts.shared.>)
```

### 3.3 Identity verification

```bash
# Verify each node can sign and verify
node -e "
import { getOrCreateIdentity, signEvent, verifyEvent } from './lib/node-identity.mjs';
const id = getOrCreateIdentity('$HOME/.openclaw-alpha');
const event = { event_type: 'test', event_id: 'verify-1', node_id: 'alpha',
                timestamp: new Date().toISOString(), data: {} };
const signed = signEvent(event, id.privateKey);
console.log('Signed:', !!signed.signature);
console.log('Verified:', verifyEvent(signed));

// Tamper test
const tampered = { ...signed, data: { injected: true } };
console.log('Tampered rejected:', !verifyEvent(tampered));
"
```

### 3.4 End-to-end broadcast round-trip

The integration tests validate the full council pattern:

```bash
# Two-node test (broadcast → offer → accept)
npm test -- --test-name-pattern="federation-2node"

# Three-node council (A broadcasts, B+C offer, A picks best)
npm test -- --test-name-pattern="federation-3node"

# Network resilience (peer offline, reconnect, dead-peer detection)
npm test -- --test-name-pattern="federation-resilience"
```

All three require `nats-server` on PATH. Tests auto-skip if not available.

---

## Part 4: Environment Variables Reference

### Node identity

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_NODE_ID` | `os.hostname()` | Node identifier for event attribution |
| `OPENCLAW_HOME` | `~/.openclaw` | Root directory for node state |

### NATS connection

| Variable | Default | Description |
|----------|---------|-------------|
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |

The daemon uses auto-reconnect with infinite retries, 2-second base wait, and 1-second jitter (`NATS_RECONNECT_OPTS` from `lib/federation-resilience.mjs`).

### Federation resilience

| Variable | Default | Description |
|----------|---------|-------------|
| `DEAD_PEER_TIMEOUT_MIN` | `10` | Minutes of silence before a peer is considered dead |

Dead peers are tracked by the offerer and acceptor. A dead peer's offers are filtered from injection. When a dead peer comes back online, it is automatically welcomed (not penalized).

### LLM extraction (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_MODEL` | `qwen3:8b` | Ollama model tag for extraction |
| `LLM_TIMEOUT` | `600000` (10 min) | Per-extraction timeout in ms |
| `LLM_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `USE_LLM_EXTRACTION` | `true` | Set `false` to use regex extraction |

### Memory injection

| Variable | Default | Description |
|----------|---------|-------------|
| `INJECTION_TOKEN_BUDGET` | `750` | Max tokens for ambient memory injection |
| `ANALYSIS_MODE` | (auto) | `embedding` or `llm` for query analysis |
| `EXTRACTION_IDLE_THRESHOLD_SEC` | `2700` | Seconds of idle before auto-extraction |

### Health monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_ALERT_TARGETS` | `file,nats,banner` | CSV of alert destinations |

---

## Part 5: Troubleshooting

### NATS cluster won't form (0 routes)

1. Check all processes running: `pgrep -la nats-server`
2. Check logs: `journalctl -u openclaw-nats -f` (systemd) or `tail ~/.openclaw/logs/nats-*.err` (launchd)
3. Verify cluster ports reachable: `nc -zv <peer-ip> 6222`
4. Ensure `cluster.name` matches across all configs (`openclaw-cluster`)
5. Check for IP/hostname resolution issues in route definitions

### JetStream not available

1. Check data directory exists and is writable
2. Check disk space — JetStream needs `max_file` worth of free space
3. Look for `JetStream` lines in logs: `journalctl -u openclaw-nats | grep JetStream`

### R=3 stream creation fails

1. All 3 NATS nodes must be clustered BEFORE creating the R=3 stream
2. Check meta leader: `curl -s http://localhost:8222/jsz | python3 -c "import sys,json; print(json.load(sys.stdin).get('meta_leader','none'))"`
3. If a node was added late, wait a few seconds for leader election
4. Delete and recreate if config is wrong: `nats stream rm OPENCLAW_SHARED && node -e "import {ensureSharedStream} from './lib/shared-event-stream.mjs'; ..."`

### Signature verification failures

Events with invalid signatures are silently dropped (STRICT mode). To debug:

1. Check that `identity.key` exists in the node's root directory
2. Verify the key is valid: `node -e "import {getOrCreateIdentity} from './lib/node-identity.mjs'; console.log(getOrCreateIdentity('$HOME/.openclaw-alpha'))"`
3. Check that `signer_pubkey` in received events matches the sender's `identity.pub`
4. If keys were regenerated, all peers need to re-learn the new public key (automatic via event headers)
5. Clock skew does NOT affect signature verification (signatures are content-based, not time-based)

### Dead peer not detected / detected too early

Adjust `DEAD_PEER_TIMEOUT_MIN` (default 10 minutes). Lower values detect failures faster but may false-positive on slow networks.

### Port conflicts

```bash
# Check what's using NATS ports
lsof -i :4222 -i :4223 -i :4224
lsof -i :6222 -i :6223 -i :6224

# If standalone NATS is already running
# macOS:
launchctl unload ~/Library/LaunchAgents/nats.plist
# Linux:
sudo systemctl stop nats-server
```

### Daemon won't start (shared stream config mismatch)

The daemon refuses to start if `OPENCLAW_SHARED` exists with wrong config (e.g., R=1 instead of R=3). Fix:

```bash
# Delete the stream and let the daemon recreate it
nats stream rm OPENCLAW_SHARED --server nats://localhost:4222 --force
# Restart the daemon — it will create R=3 stream
```

---

## Part 6: Rollback

### Remove a node from the council

1. Stop the daemon: `systemctl stop openclaw-daemon` (or kill the process)
2. The remaining nodes continue operating. Broadcasts from the removed node stop; existing offers expire via TTL.
3. The NATS cluster continues with 2 nodes (R=3 stream becomes read-only until the 3rd node returns or is replaced).

### Revert to single-node operation

1. Stop all daemons except one
2. Stop the NATS cluster
3. Start the remaining daemon with `NATS_URL` unset or pointing to a single NATS instance
4. The daemon gracefully continues without federation — shared stream unavailable, local operation works fully

### Clean up spawned node trees

```bash
# Remove a specific node
rm -rf ~/.openclaw-alpha

# Remove all spawned nodes (careful!)
rm -rf ~/.openclaw-alpha ~/.openclaw-bravo ~/.openclaw-charlie

# Remove NATS data
rm -rf ~/.openclaw/nats/jetstream-{1,2,3}
```

---

## Quick Reference: Startup Order

1. **NATS cluster** — start all 3 nats-server instances, verify 2 routes each
2. **Shared stream** — first daemon to start creates `OPENCLAW_SHARED` (R=3)
3. **Node trees** — `spawn-node.mjs` for each node (idempotent)
4. **Identity keys** — generated on first use (idempotent)
5. **Daemons** — start each node's `memory-daemon.mjs` with correct env vars
6. **Verify** — run integration tests or manual broadcast round-trip
