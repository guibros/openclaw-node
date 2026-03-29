import { NODE_ID, NODE_ROLE, NODE_PLATFORM } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({
      nodeId: NODE_ID,
      role: NODE_ROLE,
      platform: NODE_PLATFORM,
    });
  } catch (err) {
    console.error("[mesh/identity] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
