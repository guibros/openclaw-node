/**
 * HyperAgent evidence API — READ-ONLY (hyperagent-evidence 1.2).
 *
 * GET /api/hyperagent — overview + reflections + proposals.
 * No mutation route exists for hyperagent by design: approval is CLI-only.
 */

import { NextResponse } from "next/server";
import { getOverview, listReflections, listProposals } from "@/lib/hyperagent-read";

export const dynamic = "force-dynamic";

export async function GET() {
  const overview = getOverview();
  return NextResponse.json({
    ...overview,
    reflections_list: overview.available ? listReflections(20) : [],
    proposals_list: overview.available ? listProposals(20) : [],
  });
}
