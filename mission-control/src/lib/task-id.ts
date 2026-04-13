import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";

/**
 * Generate a task ID in the format T-YYYYMMDD-NNN.
 * NNN is a zero-padded sequence number based on existing tasks for that date.
 */
export function generateTaskId(
  db: ReturnType<typeof getDb>,
  date: Date
): string {
  const dateStr =
    date.getFullYear().toString() +
    (date.getMonth() + 1).toString().padStart(2, "0") +
    date.getDate().toString().padStart(2, "0");

  const prefix = `T-${dateStr}-`;

  // Find highest existing sequence number for this date prefix
  const existing = db
    .select({ id: tasks.id })
    .from(tasks)
    .all()
    .filter((t) => t.id.startsWith(prefix))
    .map((t) => {
      const seq = parseInt(t.id.slice(prefix.length), 10);
      return isNaN(seq) ? 0 : seq;
    });

  const nextSeq = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}${nextSeq.toString().padStart(3, "0")}`;
}
