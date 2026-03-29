import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validatePathParam } from "@/lib/config";
import { soulEvolutionLog } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
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
    content?: Record<string, unknown>;
  };
  reviewStatus: string;
}

// GET /api/souls/:id/evolution - Get evolution events for a soul
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let soulId: string;
    try {
      soulId = validatePathParam((await params).id);
    } catch {
      return NextResponse.json({ error: "Invalid soul ID" }, { status: 400 });
    }
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
      // events.jsonl might be empty, not exist yet, or contain malformed lines
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Failed to parse events.jsonl:", error);
      }
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
    let soulId: string;
    try {
      soulId = validatePathParam((await params).id);
    } catch {
      return NextResponse.json({ error: "Invalid soul ID" }, { status: 400 });
    }
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
    let soulId: string;
    try {
      soulId = validatePathParam((await params).id);
    } catch {
      return NextResponse.json({ error: "Invalid soul ID" }, { status: 400 });
    }
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
      let events: EvolutionEvent[];
      try {
        events = content
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (parseErr) {
        console.error("Malformed JSONL in events.jsonl:", parseErr);
        return NextResponse.json(
          { error: "Failed to parse evolution events file (malformed JSONL)" },
          { status: 500 }
        );
      }
      const event = events.find((e: EvolutionEvent) => e.eventId === eventId);

      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      // Apply change (e.g., update genes.json)
      const safeTarget = validatePathParam(event.proposedChange.target);
      const targetPath = path.join(
        SOULS_DIR,
        soulId,
        "evolution",
        safeTarget
      );

      if (event.proposedChange.action === "add") {
        let existing;
        try {
          existing = JSON.parse(await fs.readFile(targetPath, "utf-8"));
        } catch (parseErr) {
          console.error(`Malformed JSON in ${targetPath}:`, parseErr);
          return NextResponse.json(
            { error: `Failed to parse ${event.proposedChange.target} (malformed JSON)` },
            { status: 500 }
          );
        }
        if (event.proposedChange.target === "genes.json") {
          existing.genes.push(event.proposedChange.content);
        }
        await fs.writeFile(targetPath, JSON.stringify(existing, null, 2));
      }

      // Git commit — use execFile with argument arrays to prevent command injection.
      // Sanitize all user-derived inputs: eventId, soulId, reviewedBy, event.summary
      // could all contain shell metacharacters if crafted maliciously.
      const safeBranch = `evolution/${eventId.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const commitMessage = [
        `evolution(${eventId}): ${event.summary}`,
        "",
        `Event-ID: ${eventId}`,
        `Soul-ID: ${soulId}`,
        `Reviewer: ${reviewedBy}`,
      ].join("\n");
      const gitOpts = { cwd: SOULS_DIR };

      try {
        await execFileAsync("git", ["checkout", "-b", safeBranch], gitOpts);
        await execFileAsync("git", ["add", `${soulId}/evolution/${safeTarget}`], gitOpts);
        await execFileAsync("git", ["commit", "-m", commitMessage], gitOpts);
        // Merge back to main (two separate commands — execFile doesn't support &&)
        await execFileAsync("git", ["checkout", "main"], gitOpts);
        await execFileAsync("git", ["merge", safeBranch], gitOpts);

        const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], gitOpts);
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
