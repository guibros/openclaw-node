import { getDb } from "./db";
import { activityLog } from "./db/schema";
import { desc } from "drizzle-orm";

export function logActivity(
  eventType: string,
  description: string,
  taskId?: string
) {
  const db = getDb();
  db.insert(activityLog)
    .values({
      eventType,
      taskId: taskId ?? null,
      description,
      timestamp: new Date().toISOString(),
    })
    .run();
}

export function getRecentActivity(limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.timestamp))
    .limit(limit)
    .all();
}
