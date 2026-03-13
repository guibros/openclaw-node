import { NextResponse } from "next/server";
import { getHealthKv, sc } from "@/lib/nats";
import { getDb, getRawDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ── Types ────────────────────────────────────────────────────────────────

interface NodeHealth {
  nodeId: string;
  platform: string;
  role: string;
  tailscaleIp: string;
  diskPercent: number;
  mem: { total: number; free: number };
  uptimeSeconds: number;
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

// Known nodes — extend this list or discover from KV keys
const KNOWN_NODES = [
  "moltymacs-virtual-machine-local",
  "calos-vmware-virtual-platform",
];

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
export async function GET() {
  const kv = await getHealthKv();
  const db = getDb();
  const now = Date.now();

  const nodes: MeshNode[] = [];

  for (const nodeId of KNOWN_NODES) {
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

  return NextResponse.json({ nodes, tokenStats });
}
