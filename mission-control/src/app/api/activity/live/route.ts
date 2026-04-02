import { NextRequest, NextResponse } from "next/server";
import { getRecentTranscriptActivity } from "@/lib/parsers/transcript";

/**
 * GET /api/activity/live
 * Returns recent activity extracted from the Claude JSONL transcript.
 * This is a read-only, pull-based endpoint — no database writes.
 * (SSE-like polling endpoint — withTrace skipped, manual log instead)
 */
export async function GET(request: NextRequest) {
  console.log("[trace] GET /api/activity/live");
  try {
    const { searchParams } = request.nextUrl;
    const limit = parseInt(searchParams.get("limit") || "30", 10);

    const events = getRecentTranscriptActivity(Math.min(limit, 100));

    return NextResponse.json({
      events,
      count: events.length,
    });
  } catch (err) {
    console.error("GET /api/activity/live error:", err);
    return NextResponse.json(
      { error: "Failed to read transcript activity" },
      { status: 500 }
    );
  }
}
