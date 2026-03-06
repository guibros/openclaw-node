import { NextResponse } from "next/server";
import { schedulerTick } from "@/lib/scheduler";

/**
 * POST /api/scheduler/tick
 * Triggers a scheduler evaluation cycle.
 * Called by: SWR polling, heartbeat system, or manual trigger.
 * Idempotent — safe to call frequently.
 */
export async function POST() {
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
}

/**
 * GET /api/scheduler/tick
 * Same as POST — allows easy triggering from browser or curl.
 */
export async function GET() {
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
}
