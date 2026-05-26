# NATS Cluster Setup — OpenClaw Federation

This document covers setting up the 3-node NATS cluster required for OpenClaw federation (R=3 JetStream replication). Two deployment modes are described: **local dev** (all 3 nodes on one machine) and **multi-machine** (real VMs or bare metal).

## Prerequisites

- **nats-server** installed. macOS: `brew install nats-server`. Linux: download from [nats.io/download](https://nats.io/download/).
- JetStream-capable version (≥2.6.0).
- Ports 4222–4224 (client), 6222–6224 (cluster), 8222–8224 (monitoring) available.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  nats-1      │     │  nats-2      │     │  nats-3      │
│  client:4222 │◄───►│  client:4223 │◄───►│  client:4224 │
│  cluster:6222│     │  cluster:6223│     │  cluster:6224│
│  monitor:8222│     │  monitor:8223│     │  monitor:8224│
└──────────────┘     └──────────────┘     └──────────────┘
       ▲                                         ▲
       └─────────────────────────────────────────┘
                    cluster mesh
```

All three nodes form a full-mesh cluster named `openclaw-cluster`. JetStream streams with R=3 replicate across all three nodes.

## Local Dev Setup (macOS, launchd)

Config files and plists live in `services/nats/` in the repo.

### 1. Create data directories

```bash
mkdir -p ~/.openclaw/nats/jetstream-{1,2,3}
mkdir -p ~/.openclaw/logs
```

### 2. Install the plists

Before installing, replace `${OPENCLAW_REPO}` and `${HOME}` placeholders in each plist with absolute paths:

```bash
REPO="$(cd "$(dirname "$0")/../.." && pwd)"  # or set manually
for n in 1 2 3; do
  sed "s|\${OPENCLAW_REPO}|$REPO|g; s|\${HOME}|$HOME|g" \
    "$REPO/services/nats/ai.openclaw.nats-$n.plist" \
    > ~/Library/LaunchAgents/ai.openclaw.nats-$n.plist
done
```

### 3. Start the cluster

```bash
# Load all three (order doesn't matter — NATS auto-discovers routes)
for n in 1 2 3; do
  launchctl load ~/Library/LaunchAgents/ai.openclaw.nats-$n.plist
done
```

### 4. Verify

```bash
# Check all three are running
pgrep -la nats-server

# Verify cluster formed (any node's monitor works)
curl -s http://localhost:8222/routez | python3 -m json.tool
# Expect: 2 routes (to the other two nodes)

# Verify JetStream enabled
curl -s http://localhost:8222/jsz | python3 -m json.tool
# Expect: JetStream info with store_dir

# Verify all three nodes see each other
curl -s http://localhost:8222/routez | python3 -c "
import sys, json
data = json.load(sys.stdin)
routes = data.get('routes', [])
print(f'Routes: {len(routes)} (expect 2)')
for r in routes:
    print(f'  → {r.get(\"remote_id\", \"?\")} at {r.get(\"ip\", \"?\")}:{r.get(\"port\", \"?\")}')
"
```

### 5. Stop the cluster

```bash
for n in 1 2 3; do
  launchctl unload ~/Library/LaunchAgents/ai.openclaw.nats-$n.plist
done
```

## Multi-Machine Setup (Real VMs)

For deploying across real machines, each machine runs one NATS node. The config files need two changes from the local dev versions:

### 1. Per-node config

Copy `services/nats/nats-1.conf` to each machine and modify:

**Machine A** (e.g., `10.0.1.10`):
```
server_name: openclaw-nats-1
listen: 0.0.0.0:4222
http_port: 8222

jetstream {
  store_dir: ~/.openclaw/nats/jetstream
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

**Machine B** (`10.0.1.11`) and **Machine C** (`10.0.1.12`): same structure, routes point to the other two machines. All use the same ports (4222/6222/8222) since they're on separate hosts.

### 2. Firewall rules

Open the following ports between all three machines:

| Port | Protocol | Purpose |
|------|----------|---------|
| 4222 | TCP | NATS client connections |
| 6222 | TCP | NATS cluster gossip + replication |
| 8222 | TCP | HTTP monitoring (optional, restrict to admin network) |

### 3. systemd service (Linux)

```ini
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

### 4. Tailscale deployment

If nodes are on a Tailscale network, replace IPs in the `routes` array with Tailscale IPs (100.x.y.z). No firewall changes needed — Tailscale handles the mesh. The existing `bin/openclaw-node-init.js` auto-discovers NATS peers via Tailscale IP scanning on port 4222.

## Connecting OpenClaw Nodes

Once the cluster is running, each openclaw node connects via the `NATS_URL` environment variable or `config/node.json`:

```bash
# Node on machine A (or local dev node 1)
NATS_URL=nats://localhost:4222 node workspace-bin/memory-daemon.mjs

# Node on machine B
NATS_URL=nats://10.0.1.11:4222 node workspace-bin/memory-daemon.mjs
```

For spawned dev nodes (Step 10.1):

```bash
node bin/spawn-node.mjs --id alpha --port 7900 --nats-url nats://localhost:4222
node bin/spawn-node.mjs --id bravo --port 7901 --nats-url nats://localhost:4223
node bin/spawn-node.mjs --id charlie --port 7902 --nats-url nats://localhost:4224
```

Each node can connect to any cluster member — NATS handles routing internally.

## Verifying R=3 Replication

After the cluster is running and `ensureSharedStream` has been called (Step 10.3):

```bash
# Check shared stream exists with R=3
nats stream info OPENCLAW_SHARED --server nats://localhost:4222
# Expect: Replicas: 3, Storage: File

# Check stream is visible from all nodes
for port in 4222 4223 4224; do
  echo "--- Node on port $port ---"
  nats stream info OPENCLAW_SHARED --server nats://localhost:$port 2>&1 | head -5
done
```

## Troubleshooting

**Cluster won't form (0 routes):**
- Check all three processes are running: `pgrep -la nats-server`
- Check logs: `tail ~/.openclaw/logs/nats-*.err`
- Verify cluster ports (6222–6224) are not blocked by firewall
- Ensure `cluster.name` matches across all configs (`openclaw-cluster`)

**JetStream not available:**
- Check data directory exists and is writable: `ls -la ~/.openclaw/nats/`
- Check disk space: JetStream requires `max_file` free space
- Check logs for `JetStream` lines: `grep JetStream ~/.openclaw/logs/nats-1.log`

**R=3 stream create fails:**
- Need all 3 nodes online and clustered before creating R=3 streams
- Run `curl -s http://localhost:8222/jsz` — `meta_leader` should be set
- If a node was added late, the leader may need a few seconds to recognize it

**Port conflicts:**
- If standalone NATS is already running on 4222: `launchctl unload ~/Library/LaunchAgents/nats.plist` (or however it was started)
- Check: `lsof -i :4222 -i :4223 -i :4224`
