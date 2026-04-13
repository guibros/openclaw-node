import { NextResponse } from "next/server";
import { getHealthKv, sc } from "@/lib/nats";

export const dynamic = "force-dynamic";

/**
 * GET /api/observability/nodes
 *
 * Returns node topology from NATS KV bucket MESH_NODE_HEALTH.
 * Includes which daemons/services are running per node.
 * Follows the same KV read pattern as /api/mesh/nodes.
 */
export async function GET() {
  try {
    const kv = await getHealthKv();

    if (!kv) {
      return NextResponse.json(
        { nodes: [], error: "NATS KV unavailable — cannot read node health" },
        { status: 200 }
      );
    }

    const nodes: Array<{
      nodeId: string;
      status: "online" | "degraded" | "offline";
      platform: string | null;
      role: string | null;
      services: Array<{ name: string; status: string; pid?: number }>;
      capabilities: string[];
      uptimeSeconds: number | null;
      lastSeen: string | null;
      staleSeconds: number | null;
    }> = [];

    // Iterate all keys in the health KV bucket
    try {
      const keys = await kv.keys();
      for await (const key of keys) {
        try {
          const entry = await kv.get(key);
          if (!entry || !entry.value) continue;

          const health = JSON.parse(sc.decode(entry.value));
          const now = Date.now();
          const reportedAt = health.reportedAt
            ? new Date(health.reportedAt).getTime()
            : now;
          const staleSeconds = Math.round((now - reportedAt) / 1000);

          let status: "online" | "degraded" | "offline" = "offline";
          if (staleSeconds < 45) {
            const hasDownService = (health.services || []).some(
              (s: any) => s.status === "down" || s.status === "error"
            );
            status = hasDownService ? "degraded" : "online";
          } else if (staleSeconds < 120) {
            status = "degraded";
          }

          nodes.push({
            nodeId: health.nodeId || key,
            status,
            platform: health.platform || null,
            role: health.role || null,
            services: health.services || [],
            capabilities: health.capabilities || [],
            uptimeSeconds: health.uptimeSeconds ?? null,
            lastSeen: health.reportedAt || null,
            staleSeconds,
          });
        } catch {
          // Skip malformed entries
        }
      }
    } catch {
      // keys() iteration failed — return empty
    }

    return NextResponse.json({ nodes });
  } catch (err) {
    console.error("[observability/nodes] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
