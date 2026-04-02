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
  const db = getDb();
  db.insert(activityLog)
    .values({
      eventType,
      taskId: taskId ?? null,
      description,
      timestamp: new Date().toISOString(),
    })
    .run();
  traceCall("activity", "logActivity", _start, eventType);
}

export function getRecentActivity(limit = 50) {
  const _start = Date.now();
  const db = getDb();
  const result = db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.timestamp))
    .limit(limit)
    .all();
  traceCall("activity", "getRecentActivity", _start, `${result.length} items`);
  return result;
}
