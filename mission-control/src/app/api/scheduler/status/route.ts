import { NextResponse } from "next/server";
import { schedulerStatus } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/**
 * GET /api/scheduler/status
 * READ-ONLY scheduler health (selects only — does NOT dispatch, unlike /tick).
 * Consumed by the node watcher's calendar/scheduler probe.
 */
export async function GET() {
  try {
    return NextResponse.json(schedulerStatus());
  } catch (err) {
    console.error("GET /api/scheduler/status error:", err);
    return NextResponse.json({ error: "scheduler status failed" }, { status: 500 });
  }
}
