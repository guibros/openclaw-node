import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validatePathParam } from "@/lib/config";
import { tasks, soulHandoffs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withTrace } from "@/lib/tracer";
import fs from "fs/promises";
import path from "path";
import os from "os";

const HANDOFFS_DIR = path.join(
  os.homedir(),
  ".openclaw/workspace/memory-vault/handoffs"
);

interface HandoffRequest {
  toSoul: string;
  reason: string;
  context?: {
    files?: string[];
    focusAreas?: string[];
    previousWork?: string[];
  };
}

// POST /api/tasks/:id/handoff - Hand off task to another soul
export const POST = withTrace("tasks", "POST /api/tasks/:id/handoff", async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    let taskId: string;
    try {
      taskId = validatePathParam((await params).id);
    } catch {
      return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
    }
    const body: HandoffRequest = await request.json();

    const db = getDb();

    // Get current task
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const fromSoul = task.soulId || "main-agent";

    // Create handoff document in ClawVault
    await fs.mkdir(HANDOFFS_DIR, { recursive: true });
    const handoffDocPath = path.join(HANDOFFS_DIR, `${taskId}-handoff.md`);

    const handoffDoc = `# Task Handoff: ${taskId}
From: ${fromSoul} → ${body.toSoul}
Reason: ${body.reason}
Date: ${new Date().toISOString()}

## Task Context
**Title:** ${task.title}
**Status:** ${task.status}
**Owner:** ${task.owner}

## Success Criteria
${
  task.successCriteria
    ? JSON.parse(task.successCriteria)
        .map((c: string) => `- ${c}`)
        .join("\n")
    : "- Complete the task successfully"
}

## Previous Work
${body.context?.previousWork?.map((w) => `- ${w}`).join("\n") || "- Initial handoff"}

## Focus Areas
${body.context?.focusAreas?.map((a) => `- ${a}`).join("\n") || "- Follow task description"}

## Resources
${body.context?.files?.map((f) => `- ${f}`).join("\n") || "- See task artifacts"}

## Next Steps
${task.nextAction || "Begin work on this task"}
`;

    await fs.writeFile(handoffDocPath, handoffDoc);

    // Update task with new soul
    await db
      .update(tasks)
      .set({
        soulId: body.toSoul,
        handoffSource: fromSoul,
        handoffReason: body.reason,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, taskId));

    // Log handoff in soulHandoffs table
    await db.insert(soulHandoffs).values({
      taskId,
      fromSoul,
      toSoul: body.toSoul,
      reason: body.reason,
      contextPath: handoffDocPath,
    });

    return NextResponse.json({
      success: true,
      handoffDocPath,
      fromSoul,
      toSoul: body.toSoul,
    });
  } catch (error) {
    console.error("Failed to hand off task:", error);
    return NextResponse.json(
      { error: "Failed to hand off task" },
      { status: 500 }
    );
  }
});
