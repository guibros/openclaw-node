import { NextRequest, NextResponse } from "next/server";
import { getRecentTranscriptActivity } from "@/lib/parsers/transcript";
import { withTrace } from "@/lib/tracer";

/**
 * GET /api/activity/live
 * Returns recent activity extracted from the Claude JSONL transcript.
 * This is a read-only, pull-based endpoint — no database writes.
 */
export const GET = withTrace("activity", "GET /api/activity/live", async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const limit = parseInt(searchParams.get("limit") || "30", 10);

  const events = getRecentTranscriptActivity(Math.min(limit, 100));

  return NextResponse.json({
    events,
    count: events.length,
  });
});
