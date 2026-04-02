import { NextResponse } from "next/server";
import { schedulerTick } from "@/lib/scheduler";
import { withTrace } from "@/lib/tracer";

/**
 * POST /api/scheduler/tick
 * Triggers a scheduler evaluation cycle.
 * Called by: SWR polling, heartbeat system, or manual trigger.
 * Idempotent — safe to call frequently.
 */
export const POST = withTrace("scheduler", "POST /api/scheduler/tick", async () => {
  try {
    const result = schedulerTick();
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/scheduler/tick error:", err);
    return NextResponse.json(
      { error: "Scheduler tick failed" },
      { status: 500 }
    );
  }
});

/**
 * GET /api/scheduler/tick
 * Same as POST — allows easy triggering from browser or curl.
 */
export const GET = withTrace("scheduler", "GET /api/scheduler/tick", async () => {
  try {
    const result = schedulerTick();
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/scheduler/tick error:", err);
    return NextResponse.json(
      { error: "Scheduler tick failed" },
      { status: 500 }
    );
  }
});
