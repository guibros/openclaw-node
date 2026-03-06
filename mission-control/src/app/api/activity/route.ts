import { NextRequest, NextResponse } from "next/server";
import { logActivity, getRecentActivity } from "@/lib/activity";

/**
 * GET /api/activity?limit=50
 * Returns recent activity log entries, newest first.
 */
export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(
      request.nextUrl.searchParams.get("limit") || "50",
      10
    );
    const entries = getRecentActivity(Math.min(limit, 200));
    return NextResponse.json(entries);
  } catch (err) {
    console.error("GET /api/activity error:", err);
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/activity
 * Log a custom activity event. Body: { event_type, description, task_id? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.event_type || !body.description) {
      return NextResponse.json(
        { error: "event_type and description are required" },
        { status: 400 }
      );
    }
    logActivity(body.event_type, body.description, body.task_id);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/activity error:", err);
    return NextResponse.json(
      { error: "Failed to log activity" },
      { status: 500 }
    );
  }
}
