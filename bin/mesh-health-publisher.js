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

// ── Config ───────────────────────────────────────────────────────────────

const NODE_ID = process.env.OPENCLAW_NODE_ID || os.hostname();
const { NATS_URL } = require('../lib/nats-resolve');
const PUBLISH_INTERVAL_MS = 15_000; // 15 seconds
const HEALTH_BUCKET = "MESH_NODE_HEALTH";
const KV_TTL_MS = 120_000; // entries expire after 2 minutes if node dies

const sc = StringCodec();
const IS_MAC = os.platform() === "darwin";

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

function gatherHealth() {
  // Gather services once — used for both role detection and health report
  const services = getServices();
  const hasDaemon = services.some(
    (s) => s.name === "mesh-task-daemon" && s.status === "active"
  );

  return {
    nodeId: NODE_ID,
    platform: os.platform(),
    role: hasDaemon ? "lead" : "worker",
    tailscaleIp: getTailscaleIp(),
    diskPercent: getDiskPercent(),
    mem: getMemory(),
    uptimeSeconds: Math.round(os.uptime()),
    services,
    agent: getAgentStatus(),
    capabilities: [],
    stats: {
      tasksToday: 0,
      successRate: 1.0,
      tokenSpendTodayUsd: 0,
    },
    reportedAt: new Date().toISOString(),
  };
}

// ── Main Loop ────────────────────────────────────────────────────────────

async function main() {
  console.log(`[health-publisher] node=${NODE_ID} nats=${NATS_URL}`);
  console.log(`[health-publisher] publishing every ${PUBLISH_INTERVAL_MS / 1000}s`);

  const nc = await connect({
    servers: NATS_URL,
    name: `health-publisher-${NODE_ID}`,
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
  });

  console.log("[health-publisher] NATS connected");

  // Get or create the KV bucket
  const js = nc.jetstream();
  const kv = await js.views.kv(HEALTH_BUCKET, {
    history: 1,
    ttl: KV_TTL_MS,
  });

  console.log(`[health-publisher] KV bucket ${HEALTH_BUCKET} ready`);

  // Publish immediately, then every interval
  async function publish() {
    try {
      const health = gatherHealth();
      await kv.put(NODE_ID, sc.encode(JSON.stringify(health)));
    } catch (err) {
      console.error("[health-publisher] publish failed:", err.message);
    }
  }

  await publish();
  setInterval(publish, PUBLISH_INTERVAL_MS);

  // Keep process alive
  await nc.closed();
}

main().catch((err) => {
  console.error("[health-publisher] fatal:", err);
  process.exit(1);
});
