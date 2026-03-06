import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { soulEvolutionLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import os from "os";

const SOULS_DIR = path.join(os.homedir(), ".openclaw/souls");

interface PropagateRequest {
  sourceEventId: string;
  targetSoulId: string;
}

// POST /api/souls/:id/propagate — Propagate an approved gene to another soul
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sourceSoulId } = await params;
    const body: PropagateRequest = await request.json();
    const { sourceEventId, targetSoulId } = body;

    // Validate target soul exists
    const targetSoulDir = path.join(SOULS_DIR, targetSoulId);
    try {
      await fs.access(targetSoulDir);
    } catch {
      return NextResponse.json(
        { error: `Target soul '${targetSoulId}' not found` },
        { status: 404 }
      );
    }

    // Load source event from source soul's events.jsonl
    const sourceEventsPath = path.join(
      SOULS_DIR,
      sourceSoulId,
      "evolution",
      "events.jsonl"
    );

    let sourceEvent: any = null;
    try {
      const content = await fs.readFile(sourceEventsPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const events = lines.map((line) => JSON.parse(line));
      sourceEvent = events.find((e: any) => e.eventId === sourceEventId);
    } catch {
      return NextResponse.json(
        { error: "Source events file not found" },
        { status: 404 }
      );
    }

    if (!sourceEvent) {
      return NextResponse.json(
        { error: `Source event '${sourceEventId}' not found` },
        { status: 404 }
      );
    }

    // Check gene's transferRule if scope exists
    const geneContent = sourceEvent.proposedChange?.content;
    if (geneContent?.scope?.transferRule === "never") {
      return NextResponse.json(
        { error: "This gene is marked as non-transferable (transferRule: never)" },
        { status: 403 }
      );
    }

    // Create propagation event for target soul
    const propagationEventId = `${sourceEventId}-propagate-${targetSoulId}`;
    const propagationEvent = {
      eventId: propagationEventId,
      soulId: targetSoulId,
      category: sourceEvent.category,
      trigger: "cross_soul_propagation",
      summary: `Inherited: ${sourceEvent.summary}`,
      proposedChange: {
        ...sourceEvent.proposedChange,
        metadata: {
          sourceSoul: sourceSoulId,
          sourceEvent: sourceEventId,
        },
      },
      reviewStatus: "pending",
    };

    // Append to target soul's events.jsonl
    const targetEventsPath = path.join(
      SOULS_DIR,
      targetSoulId,
      "evolution",
      "events.jsonl"
    );
    await fs.mkdir(path.dirname(targetEventsPath), { recursive: true });
    await fs.appendFile(
      targetEventsPath,
      JSON.stringify(propagationEvent) + "\n"
    );

    // Log in DB with source tracking
    const db = getDb();
    await db.insert(soulEvolutionLog).values({
      soulId: targetSoulId,
      eventId: propagationEventId,
      eventType: sourceEvent.category,
      description: `Inherited: ${sourceEvent.summary}`,
      reviewStatus: "pending",
      sourceSoulId: sourceSoulId,
      sourceEventId: sourceEventId,
    });

    return NextResponse.json({
      success: true,
      propagationEventId,
      sourceSoulId,
      targetSoulId,
    });
  } catch (error) {
    console.error("Failed to propagate gene:", error);
    return NextResponse.json(
      { error: "Failed to propagate gene" },
      { status: 500 }
    );
  }
}
