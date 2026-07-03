import { NextResponse } from "next/server";
import { schedulerTick, schedulerStatus } from "@/lib/scheduler";

/**
 * POST /api/scheduler/tick
 * Triggers a scheduler evaluation cycle (dispatches due tasks — a mutation).
 * Called by: the Task Board's poll, an external heartbeat, or a manual trigger.
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
 * Read-only. A GET must be safe/idempotent, but ticking dispatches tasks and
 * fires notifications — a side effect any prefetcher or crawler would trigger.
 * GET now returns scheduler status only; use POST to actually tick.
 */
export async function GET() {
  try {
    return NextResponse.json(schedulerStatus());
  } catch (err) {
    console.error("GET /api/scheduler/tick error:", err);
    return NextResponse.json(
      { error: "Scheduler status failed" },
      { status: 500 }
    );
  }
}
