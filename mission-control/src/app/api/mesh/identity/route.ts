import { NextRequest, NextResponse } from "next/server";
import { NODE_ID, NODE_ROLE, NODE_PLATFORM } from "@/lib/config";
import { withTrace } from "@/lib/tracer";

export const dynamic = "force-dynamic";

export const GET = withTrace("mesh", "GET /api/mesh/identity", async () => {
  try {
    return NextResponse.json({
      nodeId: NODE_ID,
      role: NODE_ROLE,
      platform: NODE_PLATFORM,
    });
  } catch (err) {
    console.error("[mesh/identity] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
});
