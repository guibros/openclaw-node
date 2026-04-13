import { NextRequest, NextResponse } from "next/server";
import { getCollabKv, sc } from "@/lib/nats";

export const dynamic = "force-dynamic";

/**
 * GET /api/cowork/sessions/[id]
 *
 * Single session detail from NATS MESH_COLLAB KV.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const kv = await getCollabKv();
  if (!kv) {
    return NextResponse.json({ error: "NATS unavailable" }, { status: 503 });
  }

  try {
    const entry = await kv.get(id);
    if (!entry || !entry.value) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }
    const session = JSON.parse(sc.decode(entry.value));
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
