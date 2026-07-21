/**
 * HyperAgent per-run evidence report — READ-ONLY (hyperagent-evidence 1.2).
 *
 * GET /api/hyperagent/report?run=<run_id>
 */

import { NextRequest, NextResponse } from "next/server";
import { runReport } from "@/lib/hyperagent-read";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const run = request.nextUrl.searchParams.get("run");
  if (!run) return NextResponse.json({ error: "missing run parameter" }, { status: 400 });
  return NextResponse.json(runReport(run));
}
