import { NextRequest, NextResponse } from "next/server";
import { getNats, sc } from "@/lib/nats";
import { NODE_ID } from "@/lib/config";
import { withTrace } from "@/lib/tracer";

export const dynamic = "force-dynamic";

// Module-level state — survives across requests within the same process
let traceMode: "dev" | "smart" = "dev";

/**
 * GET /api/observability/config
 *
 * Returns current observability configuration.
 */
export const GET = withTrace("observability", "GET /api/observability/config", async () => {
  try {
    return NextResponse.json({ mode: traceMode, nodeId: NODE_ID });
  } catch (err) {
    console.error("[observability/config] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/observability/config
 *
 * Accepts { mode: "dev" | "smart" }.
 * Updates local state and publishes openclaw.trace.config via NATS
 * so all mesh nodes can switch mode.
 */
export const PATCH = withTrace("observability", "PATCH /api/observability/config", async (request: NextRequest) => {
  try {
    const body = await request.json();
    const newMode = body?.mode;

    if (newMode !== "dev" && newMode !== "smart") {
      return NextResponse.json(
        { error: 'Invalid mode — must be "dev" or "smart"' },
        { status: 400 }
      );
    }

    traceMode = newMode;

    // Publish config change to all nodes via NATS
    try {
      const nc = await getNats();
      if (nc) {
        const payload = JSON.stringify({
          mode: traceMode,
          changedBy: NODE_ID,
          timestamp: Date.now(),
        });
        nc.publish("openclaw.trace.config", sc.encode(payload));
      }
    } catch {
      // NATS publish failed — local state still updated
    }

    return NextResponse.json({ mode: traceMode, nodeId: NODE_ID });
  } catch (err) {
    console.error("[observability/config] PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
});
