import { NextRequest, NextResponse } from "next/server";
import { getHealthKv, sc } from "@/lib/nats";
import { getDb, getRawDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withTrace } from "@/lib/tracer";
import { NODE_ID, NODE_PLATFORM, NODE_ROLE } from "@/lib/config";
import { execSync } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

// ── Types ────────────────────────────────────────────────────────────────

interface TailscalePeer {
  nodeId: string;
  ip: string;
  online: boolean;
  latencyMs: number | null;
  relay: boolean;
}

interface NodeHealth {
  nodeId: string;
  platform: string;
  role: string;
  tailscaleIp: string;
  diskPercent: number;
  mem: { total: number; free: number };
  uptimeSeconds: number;
  cpuLoadPercent?: number;
  services: Array<{ name: string; status: string; pid?: number }>;
  agent: {
    status: string;
    currentTask: string | null;
    llm: string | null;
    model: string | null;
    budgetRemainingSeconds?: number;
  };
  capabilities: string[];
  stats: {
    tasksToday: number;
    successRate: number;
    tokenSpendTodayUsd: number;
  };
  tailscale?: {
    peers: TailscalePeer[];
    selfIp: string;
    natType: string;
  };
  nats?: {
    serverUrl: string;
    connected: boolean;
    serverVersion: string;
    isHost: boolean;
  };
  deployVersion?: string;
  // Timestamp set by the node when it wrote this health blob
  reportedAt?: string;
}

interface MeshNode {
  nodeId: string;
  status: "online" | "degraded" | "offline";
  health: NodeHealth | null;
  activeTasks: Array<{
    id: string;
    title: string;
    status: string;
    meshTaskId: string | null;
  }>;
  lastSeen: string | null;
  staleSeconds: number | null;
  // New enriched fields (derived from health data)
  tailscale: NodeHealth["tailscale"] | null;
  nats: NodeHealth["nats"] | null;
  cpuLoadPercent: number | null;
  isNatsHost: boolean;
  peerConnectivity: "all_direct" | "some_relay" | "degraded" | "unknown";
}

// ── Local Cache ──────────────────────────────────────────────────────────
// Survives NATS blips. If KV read fails, we serve stale data with a
// staleness indicator rather than flipping nodes to "offline".

interface CachedNode {
  health: NodeHealth;
  fetchedAt: number; // Date.now() when we last got fresh data
}

const nodeCache = new Map<string, CachedNode>();

// Thresholds for staleness (in seconds)
const STALE_DEGRADED = 45; // >45s since last health report → degraded
const STALE_OFFLINE = 120; // >120s → offline (matches KV TTL)

/** Derive peer connectivity summary from tailscale peer data */
function derivePeerConnectivity(
  health: NodeHealth | null
): "all_direct" | "some_relay" | "degraded" | "unknown" {
  const peers = health?.tailscale?.peers;
  if (!peers || peers.length === 0) return "unknown";
  const onlinePeers = peers.filter((p) => p.online);
  if (onlinePeers.length === 0) return "degraded";
  const relayCount = onlinePeers.filter((p) => p.relay).length;
  if (relayCount === 0) return "all_direct";
  if (relayCount < onlinePeers.length) return "some_relay";
  return "degraded";
}

// ── Dynamic Node Discovery ──────────────────────────────────────────────
// Nodes are discovered from 3 sources (no hardcoded list):
//   1. NATS KV keys — any node that has published health
//   2. Tailscale peers — all machines on the VPN
//   3. Local node — always include self
// Plus mesh-aliases.json as a fallback for known names.

function normalizeNodeId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\.local$/, "")     // strip .local DNS suffix
    .replace(/['''`\u2018\u2019\u201B]/g, "")  // strip all apostrophe variants
    .replace(/[\s.]+/g, "-")     // spaces and dots → dashes
    .replace(/-local$/, "")      // strip trailing -local (mesh-agent convention)
    .replace(/-+/g, "-")         // collapse multiple dashes
    .replace(/^-|-$/g, "");      // trim leading/trailing dashes
}

const localNormalized = normalizeNodeId(NODE_ID);

/** Discover all node IDs from available sources */
async function discoverNodes(kv: any): Promise<string[]> {
  const discovered = new Set<string>();

  // Source 1: NATS KV keys — most authoritative
  if (kv) {
    try {
      const keys = await kv.keys();
      for await (const key of keys) {
        discovered.add(key);
      }
    } catch {
      // KV not available
    }
  }

  // Source 2: Tailscale peers
  try {
    const raw = execSafe("tailscale status --json");
    if (raw) {
      const status = JSON.parse(raw);
      // Add self
      if (status.Self?.HostName) discovered.add(status.Self.HostName);
      // Add peers
      if (status.Peer) {
        for (const peer of Object.values(status.Peer) as any[]) {
          if (peer.HostName) discovered.add(peer.HostName);
        }
      }
    }
  } catch {}

  // Source 3: mesh-aliases.json (maps shortnames → full IDs)
  try {
    const aliasPath = path.join(os.homedir(), ".openclaw", "mesh-aliases.json");
    if (fs.existsSync(aliasPath)) {
      const aliases = JSON.parse(fs.readFileSync(aliasPath, "utf-8"));
      for (const fullId of Object.values(aliases) as string[]) {
        if (fullId && fullId !== "self") discovered.add(fullId);
      }
    }
  } catch {}

  // Source 4: Local node always included
  discovered.add(NODE_ID);

  // Source 5: Nodes we've seen before (from cache)
  for (const cachedId of nodeCache.keys()) {
    discovered.add(cachedId);
  }

  // Deduplicate by normalized name.
  // Priority: KV keys > aliases > local NODE_ID > Tailscale hostnames
  // (KV and aliases have stable, daemon-assigned names; Tailscale names can be weird)
  const seen = new Map<string, string>();
  for (const id of discovered) {
    const norm = normalizeNodeId(id);
    const existing = seen.get(norm);
    if (!existing) {
      seen.set(norm, id);
    } else {
      // Prefer the version that looks like a stable daemon ID (lowercase, dashes, no spaces/apostrophes)
      const existingIsClean = /^[a-z0-9][a-z0-9-]*$/.test(existing);
      const newIsClean = /^[a-z0-9][a-z0-9-]*$/.test(id);
      if (!existingIsClean && newIsClean) {
        seen.set(norm, id);
      } else if (existingIsClean && newIsClean && id.length > existing.length) {
        // Both clean — prefer the longer/more specific one (e.g. with -local suffix)
        seen.set(norm, id);
      }
    }
  }

  return Array.from(seen.values());
}

// ── Local Health Fallback ────────────────────────────────────────────────
// When NATS is down, gather local system info directly so the THIS node
// still shows real data instead of "offline".

function execSafe(cmd: string): string {
  try { return execSync(cmd, { timeout: 5000, encoding: "utf-8" }).trim(); } catch { return ""; }
}

function gatherLocalHealth(): NodeHealth {
  const mem = { total: Math.round(os.totalmem() / 1024 / 1024), free: Math.round(os.freemem() / 1024 / 1024) };
  const cpuLoad = Math.round((os.loadavg()[0] / os.cpus().length) * 100);

  let diskPercent = 0;
  try {
    const df = execSafe("df -h /");
    const match = df.match(/(\d+)%/);
    if (match) diskPercent = parseInt(match[1], 10);
  } catch {}

  let tailscaleIp = "unknown";
  let tailscaleData: any = null;
  try {
    tailscaleIp = execSafe("tailscale ip -4") || "unknown";
    const raw = execSafe("tailscale status --json");
    if (raw) {
      const status = JSON.parse(raw);
      const peers: any[] = [];
      if (status.Peer) {
        for (const [, peer] of Object.entries(status.Peer) as [string, any][]) {
          const peerIp = (peer.TailscaleIPs || []).find((ip: string) => !ip.includes(":")) || "";
          peers.push({
            hostname: peer.HostName || "unknown",
            ip: peerIp,
            online: peer.Online || false,
            os: peer.OS || "unknown",
            lastSeen: peer.LastSeen || null,
            direct: !!peer.CurAddr && !peer.Relay,
            relay: peer.Relay || null,
            latency: null,
          });
        }
      }
      const dnsName = status.Self?.DNSName || "";
      tailscaleData = { peers, selfIp: tailscaleIp, natType: status.Self?.CapMap?.natType || "unknown", dnsName };
    }
  } catch {}

  // Check services via launchctl/systemctl
  const services: Array<{ name: string; status: string; pid?: number }> = [];
  if (process.platform === "darwin") {
    try {
      const raw = execSafe("launchctl list");
      for (const line of raw.split("\n")) {
        if (!line.includes("openclaw")) continue;
        const parts = line.split("\t");
        const pid = parts[0] === "-" ? undefined : parseInt(parts[0], 10);
        const exitCode = parseInt(parts[1], 10);
        const label = parts[2]?.trim();
        if (label) {
          const name = label.replace("ai.openclaw.", "");
          services.push({ name, status: pid ? "active" : exitCode === 0 ? "stopped" : "error", pid: pid || undefined });
        }
      }
    } catch {}
  }

  const natsUrl = process.env.OPENCLAW_NATS || (() => {
    try {
      const envPath = path.join(os.homedir(), ".openclaw", "openclaw.env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/^\s*OPENCLAW_NATS\s*=\s*(.+)/m);
        if (match) return match[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {}
    return "unknown";
  })();

  return {
    nodeId: NODE_ID,
    platform: NODE_PLATFORM === "macOS" ? "darwin" : "linux",
    role: NODE_ROLE,
    tailscaleIp,
    diskPercent,
    mem,
    uptimeSeconds: os.uptime(),
    cpuLoadPercent: cpuLoad,
    services,
    agent: (() => {
      try {
        const statePath = path.join(os.homedir(), ".openclaw", ".tmp", "agent-state.json");
        if (fs.existsSync(statePath)) {
          const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
          return {
            status: state.status || "idle",
            currentTask: state.taskId || null,
            llm: state.llm || null,
            model: state.model || null,
          };
        }
      } catch {}
      // No agent state file — check if mesh-agent service is running
      const agentSvc = services.find((s: any) => s.name.includes("agent") && !s.name.includes("audit"));
      return {
        status: agentSvc?.status === "active" ? "idle" : agentSvc ? "stopped" : "not installed",
        currentTask: null, llm: null, model: null,
      };
    })(),
    capabilities: [],
    stats: { tasksToday: 0, successRate: 1.0, tokenSpendTodayUsd: 0 },
    tailscale: tailscaleData,
    nats: { serverUrl: natsUrl, connected: false, serverVersion: "unknown", isHost: false },
    deployVersion: execSafe("cd ~/openclaw && git rev-parse --short HEAD 2>/dev/null") || "unknown",
    reportedAt: new Date().toISOString(),
  } as any;
}

// ── Route Handler ────────────────────────────────────────────────────────

/**
 * GET /api/mesh/nodes
 *
 * Architecture (v2 — KV-based, no request-reply):
 *
 *   Each node runs a health publisher (every 15s):
 *     gatherHealth() → NATS KV put("MESH_NODE_HEALTH", nodeId, JSON)
 *
 *   This route just reads from the KV bucket:
 *     KV get(nodeId) → parse JSON → check reportedAt timestamp → derive status
 *
 *   No synchronous round-trips to nodes. No timeout races. No flickering.
 */
export const GET = withTrace("mesh", "GET /api/mesh/nodes", async () => {
  try {
  const kv = await getHealthKv();
  const db = getDb();
  const now = Date.now();

  const discoveredNodeIds = await discoverNodes(kv);
  const nodes: MeshNode[] = [];

  for (const nodeId of discoveredNodeIds) {
    let health: NodeHealth | null = null;
    let staleSeconds: number | null = null;

    // ── Try reading from KV ────────────────────────────────────────────
    if (kv) {
      try {
        const entry = await kv.get(nodeId);
        if (entry && entry.value) {
          health = JSON.parse(sc.decode(entry.value));
          if (health) {
            // Update local cache with fresh data
            nodeCache.set(nodeId, { health, fetchedAt: now });
          }
        }
      } catch {
        // KV read failed — fall through to cache
      }
    }

    // ── Fall back to local cache if KV missed ──────────────────────────
    if (!health) {
      const cached = nodeCache.get(nodeId);
      if (cached) {
        health = cached.health;
      }
    }

    // ── Fall back to local system data for THIS node ──────────────────
    // When NATS is completely down, at least show real data for the local node.
    // Always regenerate for local node if data is stale (>30s) or missing.
    const nn = normalizeNodeId(nodeId);
    const isLocal = nn === localNormalized || nn.startsWith(localNormalized) || localNormalized.startsWith(nn);
    const localCacheAge = nodeCache.has(nodeId) ? (now - nodeCache.get(nodeId)!.fetchedAt) / 1000 : Infinity;
    if (isLocal && (!health || localCacheAge > 30)) {
      health = gatherLocalHealth();
      nodeCache.set(nodeId, { health, fetchedAt: now });
    }

    // ── Derive status from staleness ───────────────────────────────────
    let status: "online" | "degraded" | "offline" = "offline";
    let lastSeen: string | null = null;

    if (health) {
      // Use the node's self-reported timestamp if available,
      // otherwise use when we last fetched it
      const reportedAt = health.reportedAt
        ? new Date(health.reportedAt).getTime()
        : nodeCache.get(nodeId)?.fetchedAt ?? now;

      staleSeconds = Math.round((now - reportedAt) / 1000);
      lastSeen = new Date(reportedAt).toISOString();

      if (staleSeconds < STALE_DEGRADED) {
        // Fresh data — check for service-level degradation
        const hasDownService = health.services.some(
          (s) => s.status === "down" || s.status === "error"
        );
        const highDisk = health.diskPercent > 85;
        status = hasDownService || highDisk ? "degraded" : "online";
      } else if (staleSeconds < STALE_OFFLINE) {
        // Stale but within TTL — degraded, show last-known data
        status = "degraded";
      } else {
        // Truly stale — offline, but still show last-known health
        status = "offline";
      }
    }

    // ── Get active mesh tasks assigned to this node from DB ────────────
    let activeTasks: Array<{
      id: string;
      title: string;
      status: string;
      meshTaskId: string | null;
    }> = [];

    try {
      activeTasks = db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          meshTaskId: tasks.meshTaskId,
        })
        .from(tasks)
        .where(eq(tasks.meshNode, nodeId))
        .all()
        .filter((t) => t.status === "running" || t.status === "submitted");
    } catch {
      // meshNode column may not exist yet (pre-Phase-A migration)
    }

    nodes.push({
      nodeId,
      status,
      health,
      activeTasks,
      lastSeen,
      staleSeconds,
      tailscale: health?.tailscale ?? null,
      nats: health?.nats ?? null,
      cpuLoadPercent: health?.cpuLoadPercent ?? null,
      isNatsHost: health?.nats?.isHost ?? false,
      peerConnectivity: derivePeerConnectivity(health),
    });
  }

  // ── Token usage stats (optional table) ─────────────────────────────
  const raw = getRawDb();
  let tokenStats: Record<
    string,
    { tasks: number; cost: number; success: number; total: number }
  > = {};
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = raw
      .prepare(
        `
      SELECT node_id, COUNT(*) as task_count, SUM(cost_usd) as total_cost
      FROM token_usage
      WHERE timestamp >= ?
      GROUP BY node_id
    `
      )
      .all(`${today}T00:00:00`) as Array<{
      node_id: string;
      task_count: number;
      total_cost: number;
    }>;
    for (const row of rows) {
      tokenStats[row.node_id] = {
        tasks: row.task_count,
        cost: row.total_cost || 0,
        success: 0,
        total: row.task_count,
      };
    }
  } catch {
    // token_usage table may not exist yet
  }

  // Add mesh-wide status
  const natsConnected = kv !== null;
  const natsUrl = process.env.OPENCLAW_NATS || (() => {
    try {
      const envPath = path.join(os.homedir(), ".openclaw", "openclaw.env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/^\s*OPENCLAW_NATS\s*=\s*(.+)/m);
        if (match) return match[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {}
    return "unknown";
  })();
  const meshStatus = {
    natsConnected,
    natsUrl,
    localNodeId: NODE_ID,
    nodesOnline: nodes.filter(n => n.status === "online").length,
    nodesTotal: nodes.length,
  };

  return NextResponse.json({ nodes, tokenStats, meshStatus });
  } catch (err) {
    console.error("[mesh/nodes] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: err instanceof SyntaxError ? 400 : 500 }
    );
  }
});
