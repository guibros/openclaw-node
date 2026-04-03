import { getDb } from "./db";
import { activityLog } from "./db/schema";
import { desc } from "drizzle-orm";
import { traceCall } from "./tracer";

export function logActivity(
  eventType: string,
  description: string,
  taskId?: string
) {
  const _start = Date.now();
  try {
    const db = getDb();
    db.insert(activityLog)
      .values({
        eventType,
        taskId: taskId ?? null,
        description,
        timestamp: new Date().toISOString(),
      })
      .run();
  } catch (err) {
    console.error(`[activity] logActivity failed: ${(err as Error).message}`);
  }
  traceCall("activity", "logActivity", _start, eventType);
}

export function getRecentActivity(limit = 50) {
  const _start = Date.now();
  try {
    const db = getDb();
    const result = db
      .select()
      .from(activityLog)
      .orderBy(desc(activityLog.timestamp))
      .limit(limit)
      .all();
    traceCall("activity", "getRecentActivity", _start, `${result.length} items`);
    return result;
  } catch (err) {
    console.error(`[activity] getRecentActivity failed: ${(err as Error).message}`);
    traceCall("activity", "getRecentActivity", _start, "0 items (error)");
    return [];
  }
}
