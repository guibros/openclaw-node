#!/usr/bin/env node

/**
 * mesh-health-publisher.js
 *
 * Runs on each mesh node. Every PUBLISH_INTERVAL_MS, gathers local system
 * health and writes it to the MESH_NODE_HEALTH KV bucket in NATS JetStream.
 *
 * MC reads from this bucket — no synchronous request-reply, no timeout races.
 *
 * Usage:
 *   OPENCLAW_NODE_ID=moltymac NATS_URL=nats://calos:4222 node mesh-health-publisher.js
 *
 * As a launchd/systemd service:
 *   ai.openclaw.mesh-health-publisher
 */

const { connect, StringCodec } = require("nats");
const { execSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { createTracer, setNatsConnection } = require('../lib/tracer');
const tracer = createTracer('mesh-health-publisher');

// ── Config ───────────────────────────────────────────────────────────────

const NODE_ID = process.env.OPENCLAW_NODE_ID || os.hostname();
const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
const PUBLISH_INTERVAL_MS = 15_000; // 15 seconds
const HEALTH_BUCKET = "MESH_NODE_HEALTH";
const KV_TTL_MS = 120_000; // entries expire after 2 minutes if node dies

const REPO_DIR = process.env.OPENCLAW_REPO_DIR ||
  path.join(os.homedir(), 'openclaw');

const sc = StringCodec();
const IS_MAC = os.platform() === "darwin";

const { ROLE_COMPONENTS } = require('../lib/mesh-roles');

// ── Circuit Breaker State ───────────────────────────────────────────────
let consecutiveFailures = 0;
let skipTicksRemaining = 0;
let lastErrorMsg = '';
let lastErrorRepeatCount = 0;

// ── Health Gathering ─────────────────────────────────────────────────────
// All the expensive execSync calls happen here, on our own schedule.
// No request timeout to race against.

function execSafe(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

function getDiskPercent() {
  const raw = execSafe("df -h / | tail -1");
  if (!raw) return 0;
  const match = raw.match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : 0;
}

function getMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    total: Math.round(total / 1024 / 1024),
    free: Math.round(free / 1024 / 1024),
  };
}

function getTailscaleIp() {
  const raw = execSafe("tailscale ip -4");
  return raw || "unknown";
}

function getServices() {
  const services = [];

  if (IS_MAC) {
    const serviceNames = [
      "ai.openclaw.mesh-task-daemon",
      "ai.openclaw.mesh-bridge",
      "ai.openclaw.mesh-agent",
      "ai.openclaw.gateway",
      "ai.openclaw.memory-daemon",
      "ai.openclaw.mission-control",
      "ai.openclaw.mesh-health-publisher",
      "ai.openclaw.mesh-deploy-listener",
    ];
    for (const name of serviceNames) {
      const raw = execSafe(`launchctl list ${name} 2>/dev/null`);
      if (raw) {
        const pidMatch = raw.match(/"PID"\s*=\s*(\d+)/);
        const pid = pidMatch ? parseInt(pidMatch[1], 10) : undefined;
        services.push({
          name: name.replace("ai.openclaw.", ""),
          status: pid ? "active" : "idle",
          pid,
        });
      } else {
        services.push({
          name: name.replace("ai.openclaw.", ""),
          status: "not-found",
        });
      }
    }
  } else {
    // Linux: check both system-level and user-level services
    const systemServices = [
      "openclaw-agent",
    ];
    // Only check services that belong on this node.
    // Lead-only services (task-daemon, bridge, mission-control, memory-daemon)
    // are not expected on worker nodes.
    const userServices = [
      "openclaw-gateway",
      "openclaw-mesh-health-publisher",
      "openclaw-mesh-deploy-listener",
    ];
    for (const name of systemServices) {
      const raw = execSafe(`systemctl is-active ${name} 2>/dev/null`);
      const pidRaw = execSafe(
        `systemctl show ${name} --property=MainPID --value 2>/dev/null`
      );
      const pid = pidRaw ? parseInt(pidRaw, 10) || undefined : undefined;
      services.push({
        name: name.replace("openclaw-", ""),
        status: raw || "unknown",
        pid: pid && pid > 0 ? pid : undefined,
      });
    }
    for (const name of userServices) {
      const raw = execSafe(`systemctl --user is-active ${name} 2>/dev/null`);
      const pidRaw = execSafe(
        `systemctl --user show ${name} --property=MainPID --value 2>/dev/null`
      );
      const pid = pidRaw ? parseInt(pidRaw, 10) || undefined : undefined;
      services.push({
        name: name.replace("openclaw-", ""),
        status: raw || "unknown",
        pid: pid && pid > 0 ? pid : undefined,
      });
    }
  }

  return services;
}

function getAgentStatus() {
  const status = { status: "idle", currentTask: null, llm: null, model: null };
  try {
    const statePath = `${os.homedir()}/.openclaw/.tmp/agent-state.json`;
    const raw = execSafe(`cat ${statePath} 2>/dev/null`);
    if (raw) {
      const state = JSON.parse(raw);
      status.status = state.status || "idle";
      status.currentTask = state.taskId || null;
      status.llm = state.llm || "claude";
      status.model = state.model || null;
    }
  } catch {
    // No state file = idle
  }
  return status;
}

function getDeployVersion() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: REPO_DIR, encoding: 'utf-8', timeout: 5000,
    }).trim();
  } catch {
    return 'unknown';
  }
}

function getTailscalePeers() {
  try {
    const raw = execSafe('tailscale status --json');
    if (!raw) return { peers: [], selfIp: 'unknown', natType: 'unknown' };
    const status = JSON.parse(raw);

    const selfIps = status.Self?.TailscaleIPs || [];
    const selfIp = selfIps.find(ip => !ip.includes(':')) || selfIps[0] || 'unknown';

    const peers = [];
    if (status.Peer) {
      for (const [key, peer] of Object.entries(status.Peer)) {
        const peerIp = (peer.TailscaleIPs || []).find(ip => !ip.includes(':')) || '';
        peers.push({
          hostname: peer.HostName || key,
          ip: peerIp,
          online: peer.Online || false,
          os: peer.OS || 'unknown',
          lastSeen: peer.LastSeen || null,
          curAddr: peer.CurAddr || null,
          relay: peer.Relay || null,
          direct: !!peer.CurAddr && !peer.Relay,
        });
      }
    }

    return { peers, selfIp, natType: status.Self?.CapMap?.['natType'] || 'unknown' };
  } catch { return { peers: [], selfIp: 'unknown', natType: 'unknown' }; }
}

function getTailscaleLatency(peerIp) {
  try {
    const raw = execSafe(`tailscale ping -c 1 --timeout 3s ${peerIp}`);
    if (!raw) return null;
    const match = raw.match(/in (\d+(?:\.\d+)?)ms/);
    const viaMatch = raw.match(/via (DERP\([^)]+\)|[\d.]+:\d+)/);
    return {
      latencyMs: match ? parseFloat(match[1]) : null,
      via: viaMatch ? viaMatch[1] : 'unknown',
      isDirect: viaMatch ? !viaMatch[1].startsWith('DERP') : null,
    };
  } catch { return null; }
}

function getCpuLoad() {
  const load1m = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  return Math.round((load1m / cpuCount) * 100);
}

function getNatsInfo(nc, natsUrl) {
  try {
    const info = nc.info;
    return {
      serverUrl: natsUrl || 'unknown',
      connected: !nc.isClosed(),
      serverVersion: info?.version || 'unknown',
      isHost: false,
    };
  } catch { return { serverUrl: 'unknown', connected: false, serverVersion: 'unknown', isHost: false }; }
}

function getNodeStats() {
  try {
    const perfPath = path.join(os.homedir(), '.openclaw', 'workspace', 'memory', 'performance.jsonl');
    if (!fs.existsSync(perfPath)) return { tasksToday: 0, successRate: 1.0, tokenSpendTodayUsd: 0 };

    const today = new Date().toISOString().slice(0, 10);
    const lines = fs.readFileSync(perfPath, 'utf-8').split('\n').filter(Boolean);

    let completed = 0, failed = 0, tokens = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry.completed_at || !entry.completed_at.startsWith(today)) continue;
        if (entry.node_id && entry.node_id !== NODE_ID) continue;
        if (entry.outcome === 'completed' || entry.outcome === 'success') completed++;
        else if (entry.outcome === 'failed' || entry.outcome === 'error') failed++;
        if (entry.token_cost_usd) tokens += entry.token_cost_usd;
      } catch { continue; }
    }

    const total = completed + failed;
    return {
      tasksToday: total,
      successRate: total > 0 ? completed / total : 1.0,
      tokenSpendTodayUsd: Math.round(tokens * 100) / 100,
    };
  } catch { return { tasksToday: 0, successRate: 1.0, tokenSpendTodayUsd: 0 }; }
}

let publishCount = 0;

function gatherHealth(nc) {
  // Gather services once — used for both role detection and health report
  const services = getServices();
  const hasDaemon = services.some(
    (s) => s.name === "mesh-task-daemon" && s.status === "active"
  );
  const role = hasDaemon ? "lead" : "worker";

  publishCount++;
  const tsData = getTailscalePeers();

  // Only ping peers every 5th cycle (every 75 seconds)
  if (publishCount % 5 === 0) {
    for (const peer of tsData.peers) {
      if (peer.ip && peer.online) {
        peer.latency = getTailscaleLatency(peer.ip);
      }
    }
  }

  const natsInfo = getNatsInfo(nc, NATS_URL);
  const natsHost = new URL(NATS_URL).hostname;
  natsInfo.isHost = (natsHost === tsData.selfIp || natsHost === '127.0.0.1' || natsHost === 'localhost');

  return {
    nodeId: NODE_ID,
    platform: os.platform(),
    role,
    deployVersion: getDeployVersion(),
    components: ROLE_COMPONENTS[role] || ROLE_COMPONENTS.worker,
    tailscaleIp: tsData.selfIp,
    diskPercent: getDiskPercent(),
    mem: getMemory(),
    uptimeSeconds: Math.round(os.uptime()),
    services,
    agent: getAgentStatus(),
    capabilities: [],
    tailscale: tsData,
    nats: natsInfo,
    cpuLoadPercent: getCpuLoad(),
    stats: getNodeStats(),
    reportedAt: new Date().toISOString(),
  };
}

// ── Tracer Instrumentation ───────────────────────────────────────────────
gatherHealth = tracer.wrap('gatherHealth', gatherHealth, { tier: 3 });

// ── Main Loop ────────────────────────────────────────────────────────────

async function main() {
  console.log(`[health-publisher] node=${NODE_ID} nats=${NATS_URL}`);
  console.log(`[health-publisher] publishing every ${PUBLISH_INTERVAL_MS / 1000}s`);

  const nc = await connect(natsConnectOpts({
    name: `health-publisher-${NODE_ID}`,
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
  }));

  console.log("[health-publisher] NATS connected");
  setNatsConnection(nc, sc);

  // Get or create the KV bucket
  const js = nc.jetstream();
  const kv = await js.views.kv(HEALTH_BUCKET, {
    history: 1,
    ttl: KV_TTL_MS,
  });

  console.log(`[health-publisher] KV bucket ${HEALTH_BUCKET} ready`);

  // Publish immediately, then every interval
  async function publish() {
    // Circuit breaker: skip ticks during backoff
    if (skipTicksRemaining > 0) {
      skipTicksRemaining--;
      return;
    }

    try {
      const health = gatherHealth(nc);
      await kv.put(NODE_ID, sc.encode(JSON.stringify(health)));
      // Reset on success
      if (consecutiveFailures > 0) {
        console.log(`[health-publisher] recovered after ${consecutiveFailures} consecutive failures`);
      }
      consecutiveFailures = 0;
      lastErrorMsg = '';
      lastErrorRepeatCount = 0;
    } catch (err) {
      consecutiveFailures++;
      const msg = err.message;

      // Log dedup: after 3 identical consecutive errors, log every 10th
      if (msg === lastErrorMsg) {
        lastErrorRepeatCount++;
        if (lastErrorRepeatCount === 3) {
          console.error(`[health-publisher] suppressing repeated errors (${lastErrorRepeatCount} occurrences): ${msg}`);
        } else if (lastErrorRepeatCount > 3 && lastErrorRepeatCount % 10 === 0) {
          console.error(`[health-publisher] suppressing repeated errors (${lastErrorRepeatCount} occurrences): ${msg}`);
        }
        // Silently skip logs between dedup thresholds
      } else {
        lastErrorMsg = msg;
        lastErrorRepeatCount = 1;
        console.error("[health-publisher] publish failed:", msg);
      }

      // Exponential backoff: skip 2^min(N,6) ticks (max ~64 ticks / ~16 min at 15s)
      const backoffTicks = Math.pow(2, Math.min(consecutiveFailures, 6));
      skipTicksRemaining = backoffTicks;
      console.error(`[health-publisher] backoff: skipping next ${backoffTicks} ticks (failures=${consecutiveFailures})`);
    }
  }

  publish = tracer.wrapAsync('publish', publish, { tier: 3 });
  await publish();
  setInterval(publish, PUBLISH_INTERVAL_MS);

  // Keep process alive
  await nc.closed();
}

main().catch((err) => {
  console.error("[health-publisher] fatal:", err);
  process.exit(1);
});
