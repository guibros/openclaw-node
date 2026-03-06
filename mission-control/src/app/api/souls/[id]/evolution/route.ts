import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { soulEvolutionLog } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const SOULS_DIR = path.join(os.homedir(), ".openclaw/souls");

interface EvolutionEvent {
  eventId: string;
  soulId: string;
  category: string;
  trigger: string;
  summary: string;
  proposedChange: {
    target: string;
    action: string;
    content?: any;
  };
  reviewStatus: string;
}

// GET /api/souls/:id/evolution - Get evolution events for a soul
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: soulId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";

    const db = getDb();

    const events = await db
      .select()
      .from(soulEvolutionLog)
      .where(eq(soulEvolutionLog.soulId, soulId))
      .orderBy(desc(soulEvolutionLog.timestamp));

    // If status filter requested
    const filtered =
      status === "all"
        ? events
        : events.filter((e) => e.reviewStatus === status);

    // Load full event details from events.jsonl
    const eventsPath = path.join(
      SOULS_DIR,
      soulId,
      "evolution",
      "events.jsonl"
    );

    let fullEvents: EvolutionEvent[] = [];
    try {
      const content = await fs.readFile(eventsPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      fullEvents = lines.map((line) => JSON.parse(line));
    } catch (error) {
      // events.jsonl might be empty or not exist yet
    }

    // Merge DB records with full event details
    const merged = filtered.map((dbEvent) => {
      const fullEvent = fullEvents.find((e) => e.eventId === dbEvent.eventId);
      return {
        ...dbEvent,
        proposedChange: fullEvent?.proposedChange,
        category: fullEvent?.category,
        trigger: fullEvent?.trigger,
      };
    });

    return NextResponse.json(merged);
  } catch (error) {
    console.error("Failed to load evolution events:", error);
    return NextResponse.json(
      { error: "Failed to load evolution events" },
      { status: 500 }
    );
  }
}

// POST /api/souls/:id/evolution - Create new evolution event (used by souls)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: soulId } = await params;
    const event: EvolutionEvent = await request.json();

    const db = getDb();

    // Append to events.jsonl
    const eventsPath = path.join(
      SOULS_DIR,
      soulId,
      "evolution",
      "events.jsonl"
    );
    await fs.mkdir(path.dirname(eventsPath), { recursive: true });
    await fs.appendFile(eventsPath, JSON.stringify(event) + "\n");

    // Log in database
    await db.insert(soulEvolutionLog).values({
      soulId,
      eventId: event.eventId,
      eventType: event.category,
      description: event.summary,
      reviewStatus: event.reviewStatus || "pending",
    });

    return NextResponse.json({ success: true, eventId: event.eventId });
  } catch (error) {
    console.error("Failed to create evolution event:", error);
    return NextResponse.json(
      { error: "Failed to create evolution event" },
      { status: 500 }
    );
  }
}

// PATCH /api/souls/:id/evolution/:eventId - Approve/reject evolution
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: soulId } = await params;
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");

    if (!eventId) {
      return NextResponse.json(
        { error: "Event ID required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { action, reviewedBy } = body; // action: "approve" | "reject"

    const db = getDb();

    if (action === "approve") {
      // Load full event from events.jsonl
      const eventsPath = path.join(
        SOULS_DIR,
        soulId,
        "evolution",
        "events.jsonl"
      );
      const content = await fs.readFile(eventsPath, "utf-8");
      const events = content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const event = events.find((e: EvolutionEvent) => e.eventId === eventId);

      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      // Apply change (e.g., update genes.json)
      const targetPath = path.join(
        SOULS_DIR,
        soulId,
        "evolution",
        event.proposedChange.target
      );

      if (event.proposedChange.action === "add") {
        const existing = JSON.parse(await fs.readFile(targetPath, "utf-8"));
        if (event.proposedChange.target === "genes.json") {
          existing.genes.push(event.proposedChange.content);
        }
        await fs.writeFile(targetPath, JSON.stringify(existing, null, 2));
      }

      // Git commit
      const branchName = `evolution/${eventId}`;
      const commitMessage = `evolution(${eventId}): ${event.summary}\n\nEvent-ID: ${eventId}\nSoul-ID: ${soulId}\nReviewer: ${reviewedBy}`;

      try {
        await execAsync(`git checkout -b ${branchName}`, {
          cwd: SOULS_DIR,
        });
        await execAsync(`git add ${soulId}/evolution/${event.proposedChange.target}`, {
          cwd: SOULS_DIR,
        });
        await execAsync(`git commit -m "${commitMessage}"`, {
          cwd: SOULS_DIR,
        });
        await execAsync(`git checkout main && git merge ${branchName}`, {
          cwd: SOULS_DIR,
        });

        const { stdout } = await execAsync(`git rev-parse HEAD`, {
          cwd: SOULS_DIR,
        });
        const commitHash = stdout.trim();

        // Update DB
        await db
          .update(soulEvolutionLog)
          .set({
            reviewStatus: "approved",
            commitHash,
            reviewedBy,
            reviewedAt: new Date().toISOString(),
          })
          .where(eq(soulEvolutionLog.eventId, eventId));

        return NextResponse.json({ success: true, commitHash });
      } catch (gitError) {
        console.error("Git operation failed:", gitError);
        return NextResponse.json(
          { error: "Git operation failed" },
          { status: 500 }
        );
      }
    } else if (action === "reject") {
      await db
        .update(soulEvolutionLog)
        .set({
          reviewStatus: "rejected",
          reviewedBy,
          reviewedAt: new Date().toISOString(),
        })
        .where(eq(soulEvolutionLog.eventId, eventId));

      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Failed to review evolution:", error);
    return NextResponse.json(
      { error: "Failed to review evolution" },
      { status: 500 }
    );
  }
}
