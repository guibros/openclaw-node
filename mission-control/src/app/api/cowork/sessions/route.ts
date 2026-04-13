import { NextRequest, NextResponse } from "next/server";
import { getCollabKv, sc } from "@/lib/nats";

export const dynamic = "force-dynamic";

/**
 * GET /api/cowork/sessions
 *
 * Read all collab sessions from NATS MESH_COLLAB KV.
 * Optional ?status= filter (e.g., "active", "recruiting", "completed").
 * Returns { sessions[], natsAvailable }.
 */
export async function GET(request: NextRequest) {
  const kv = await getCollabKv();
  if (!kv) {
    return NextResponse.json({ sessions: [], natsAvailable: false });
  }

  // Supports single status (?status=active) or comma-separated (?status=active,recruiting)
  const statusParam = request.nextUrl.searchParams.get("status");
  const statusFilter = statusParam ? new Set(statusParam.split(",")) : null;

  const sessions: unknown[] = [];
  try {
    const keys: string[] = [];
    const keyIter = await kv.keys();
    for await (const key of keyIter) keys.push(key);

    for (const key of keys) {
      try {
        const entry = await kv.get(key);
        if (!entry || !entry.value) continue;
        const session = JSON.parse(sc.decode(entry.value));
        if (statusFilter && !statusFilter.has(session.status)) continue;
        sessions.push(session);
      } catch {
        // Skip malformed entries
      }
    }
  } catch (err) {
    console.error("[cowork/sessions] KV scan error:", (err as Error).message);
  }

  // Sort: active/recruiting first, then by created_at desc
  const statusOrder: Record<string, number> = {
    active: 0,
    recruiting: 1,
    converged: 2,
    completed: 3,
    aborted: 4,
  };

  sessions.sort((a: any, b: any) => {
    const aOrder = statusOrder[a.status] ?? 5;
    const bOrder = statusOrder[b.status] ?? 5;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (
      new Date(b.created_at || 0).getTime() -
      new Date(a.created_at || 0).getTime()
    );
  });

  return NextResponse.json({ sessions, natsAvailable: true });
}
