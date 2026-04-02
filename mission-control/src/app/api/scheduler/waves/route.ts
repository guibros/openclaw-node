import { NextResponse } from "next/server";
import { eq, and, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tasks, dependencies } from "@/lib/db/schema";
import { computeWaves } from "@/lib/scheduler";
import { withTrace } from "@/lib/tracer";

/**
 * GET /api/scheduler/waves
 * Returns the current wave structure without dispatching.
 * Useful for visualization and debugging.
 */
export const GET = withTrace("scheduler", "GET /api/scheduler/waves", async () => {
  const db = getDb();

  const dispatchable = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.needsApproval, 0),
        or(
          eq(tasks.status, "ready"),
          and(eq(tasks.status, "queued"), eq(tasks.triggerKind, "none"))
        )
      )
    )
    .all();

  const allDeps = db.select().from(dependencies).all();
  const depTargetMap = new Map<string, string[]>();
  for (const dep of allDeps) {
    const existing = depTargetMap.get(dep.targetId) || [];
    existing.push(dep.sourceId);
    depTargetMap.set(dep.targetId, existing);
  }
  const taskStatusLookup = new Map(
    db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .all()
      .map((t) => [t.id, t.status] as const)
  );

  const waves = computeWaves(
    dispatchable.map((t) => t.id),
    depTargetMap,
    taskStatusLookup
  );

  return NextResponse.json({
    waves,
    totalDispatchable: dispatchable.length,
  });
});
