import { NextRequest, NextResponse } from "next/server";
import { askNode, AskTimeout, ModelUnreachable } from "@/lib/agent-ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/ask — { q } → { answer, trace, rounds }.
 *
 * The trace ships with the answer rather than behind a debug flag: it is the
 * record of which tools the answer was built from, and an answer about live
 * state with no tool call behind it is one the operator should distrust.
 *
 * Auth is the middleware's — it refuses every /api method without the session
 * token, this one included.
 */
export async function POST(request: NextRequest) {
  let body: { q?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (typeof body.q !== "string" || !body.q.trim()) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  try {
    const result = await askNode(body.q);
    // A run that used up its rounds without answering is not a server error —
    // the trace is real and worth returning; it just has no answer on the end.
    return NextResponse.json(result, { status: result.answer === null ? 504 : 200 });
  } catch (err) {
    if (err instanceof AskTimeout) {
      return NextResponse.json({ error: err.message }, { status: 504 });
    }
    // The model being down is a dependency outage, not a fault in this route.
    if (err instanceof ModelUnreachable) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("POST /api/agent/ask error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent failed" },
      { status: 500 },
    );
  }
}
