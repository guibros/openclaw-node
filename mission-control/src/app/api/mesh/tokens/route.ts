import { NextRequest, NextResponse } from "next/server";
import { getRawDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/mesh/tokens?period=today|week|month
 * Returns token usage summary with breakdowns by model and node.
 */
export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") || "today";
  const raw = getRawDb();

  const now = new Date();
  let since: string;
  switch (period) {
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      since = d.toISOString();
      break;
    }
    case "month": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      since = d.toISOString();
      break;
    }
    default: // today
      since = `${now.toISOString().slice(0, 10)}T00:00:00`;
      break;
  }

  try {
    // Totals
    const totals = raw
      .prepare(
        `SELECT
          COUNT(*) as task_count,
          COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output,
          COALESCE(SUM(cost_usd), 0) as total_cost
        FROM token_usage
        WHERE timestamp >= ?`
      )
      .get(since) as {
      task_count: number;
      total_input: number;
      total_output: number;
      total_cost: number;
    };

    // By model
    const byModel = raw
      .prepare(
        `SELECT model, SUM(cost_usd) as cost, COUNT(*) as count
        FROM token_usage
        WHERE timestamp >= ?
        GROUP BY model
        ORDER BY cost DESC`
      )
      .all(since) as Array<{ model: string; cost: number; count: number }>;

    // By node
    const byNode = raw
      .prepare(
        `SELECT node_id, SUM(cost_usd) as cost, COUNT(*) as count
        FROM token_usage
        WHERE timestamp >= ? AND node_id IS NOT NULL
        GROUP BY node_id
        ORDER BY cost DESC`
      )
      .all(since) as Array<{ node_id: string; cost: number; count: number }>;

    // Recent entries
    const recent = raw
      .prepare(
        `SELECT * FROM token_usage
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
        LIMIT 50`
      )
      .all(since);

    return NextResponse.json({
      totalCost: totals.total_cost,
      totalInputTokens: totals.total_input,
      totalOutputTokens: totals.total_output,
      taskCount: totals.task_count,
      byModel,
      byNode,
      recent,
    });
  } catch {
    // Table may not exist yet
    return NextResponse.json({
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      taskCount: 0,
      byModel: [],
      byNode: [],
      recent: [],
    });
  }
}

/**
 * POST /api/mesh/tokens — record a token usage entry
 * Body: { task_id, node_id, model, input_tokens, output_tokens, cost_usd }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const raw = getRawDb();

  const { task_id, node_id, model, input_tokens, output_tokens, cost_usd } = body;

  if (!model || input_tokens == null || output_tokens == null || cost_usd == null) {
    return NextResponse.json(
      { error: "Missing required fields: model, input_tokens, output_tokens, cost_usd" },
      { status: 400 }
    );
  }

  raw
    .prepare(
      `INSERT INTO token_usage (task_id, node_id, model, input_tokens, output_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(task_id || null, node_id || null, model, input_tokens, output_tokens, cost_usd);

  return NextResponse.json({ ok: true });
}
