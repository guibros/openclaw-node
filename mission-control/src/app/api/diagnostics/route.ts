import { NextResponse } from "next/server";
import { getRawDb } from "@/lib/db";
import { getNats } from "@/lib/nats";
import fs from "fs";
import { ACTIVE_TASKS_MD, WORKSPACE_ROOT } from "@/lib/config";
import { parseTasksMarkdown, serializeTasksMarkdown } from "@/lib/parsers/task-markdown";

export const dynamic = "force-dynamic";

export async function GET() {
  const raw = getRawDb();

  // Task stats
  const tasksByStatus = raw
    .prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status ORDER BY count DESC")
    .all() as Array<{ status: string; count: number }>;

  const tasksByType = raw
    .prepare("SELECT type, COUNT(*) as count FROM tasks GROUP BY type ORDER BY count DESC")
    .all() as Array<{ type: string; count: number }>;

  const tasksByKanban = raw
    .prepare("SELECT kanban_column, COUNT(*) as count FROM tasks GROUP BY kanban_column ORDER BY count DESC")
    .all() as Array<{ kanban_column: string; count: number }>;

  const totalTasks = raw.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number };

  // Memory stats
  const memoryDocCount = (raw.prepare("SELECT COUNT(*) as count FROM memory_docs").get() as { count: number }).count;
  const memoryItemCount = (raw.prepare("SELECT COUNT(*) as count FROM memory_items WHERE status = 'active'").get() as { count: number }).count;
  const entityCount = (raw.prepare("SELECT COUNT(*) as count FROM memory_entities").get() as { count: number }).count;
  const relationCount = (raw.prepare("SELECT COUNT(*) as count FROM memory_relations WHERE valid_to IS NULL").get() as { count: number }).count;

  // Cluster stats
  const clusterCount = (raw.prepare("SELECT COUNT(*) as count FROM clusters WHERE status = 'active'").get() as { count: number }).count;
  const clusterMemberCount = (raw.prepare("SELECT COUNT(*) as count FROM cluster_members").get() as { count: number }).count;

  // Sync health
  let syncHealth: { exists: boolean; taskCount: number; roundTripOk: boolean; diffLines: number } = {
    exists: false,
    taskCount: 0,
    roundTripOk: false,
    diffLines: 0,
  };

  if (fs.existsSync(ACTIVE_TASKS_MD)) {
    const content = fs.readFileSync(ACTIVE_TASKS_MD, "utf-8");
    const parsed = parseTasksMarkdown(content);
    const reserialized = serializeTasksMarkdown(parsed);
    const reparsed = parseTasksMarkdown(reserialized);

    // Compare field-by-field (ignoring whitespace differences in serialization)
    const roundTripOk = parsed.length === reparsed.length &&
      parsed.every((t, i) => t.id === reparsed[i].id && t.title === reparsed[i].title && t.status === reparsed[i].status);

    syncHealth = {
      exists: true,
      taskCount: parsed.length,
      roundTripOk,
      diffLines: Math.abs(content.split("\n").length - reserialized.split("\n").length),
    };
  }

  // NATS status
  let natsStatus = "unavailable";
  try {
    const nc = await getNats();
    natsStatus = nc ? "connected" : "unavailable";
  } catch {
    natsStatus = "error";
  }

  // Workspace
  const workspaceExists = fs.existsSync(WORKSPACE_ROOT);

  return NextResponse.json({
    tasks: {
      total: totalTasks.count,
      byStatus: tasksByStatus,
      byType: tasksByType,
      byKanban: tasksByKanban,
    },
    memory: {
      docs: memoryDocCount,
      items: memoryItemCount,
      entities: entityCount,
      relations: relationCount,
    },
    cowork: {
      clusters: clusterCount,
      members: clusterMemberCount,
    },
    sync: syncHealth,
    nats: natsStatus,
    workspace: workspaceExists,
  });
}
