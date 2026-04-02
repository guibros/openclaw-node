import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validatePathParam } from "@/lib/config";
import { soulSpawns } from "@/lib/db/schema";
import { withTrace } from "@/lib/tracer";
import fs from "fs/promises";
import path from "path";
import os from "os";

const SOULS_DIR = path.join(os.homedir(), ".openclaw/souls");
const HANDOFFS_DIR = path.join(
  os.homedir(),
  ".openclaw/workspace/memory-vault/handoffs"
);

interface PromptRequest {
  taskId?: string;
  extraContext?: string;
}

interface Gene {
  id: string;
  category: string;
  signal: string;
  preconditions?: string[];
  strategy?: string[];
}

function determineSubagentType(tools: string[]): string {
  const writableTools = ["Write", "Edit", "Bash"];
  if (tools.some((t) => writableTools.includes(t))) {
    return "general-purpose";
  }
  return "Explore";
}

// POST /api/souls/:id/prompt — Generate soul-enriched preamble for Task tool
export const POST = withTrace("souls", "POST /api/souls/:id/prompt", async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    let soulId: string;
    try {
      soulId = validatePathParam((await params).id);
    } catch {
      return NextResponse.json({ error: "Invalid soul ID" }, { status: 400 });
    }
    const body: PromptRequest = await request.json();

    const soulDir = path.join(SOULS_DIR, soulId);

    // Verify soul exists
    try {
      await fs.access(soulDir);
    } catch {
      return NextResponse.json({ error: "Soul not found" }, { status: 404 });
    }

    const sections: string[] = [];

    // 1. Identity (SOUL.md)
    try {
      const soulMd = await fs.readFile(
        path.join(soulDir, "SOUL.md"),
        "utf-8"
      );
      sections.push("# Soul Identity\n\n" + soulMd);
    } catch {
      // No SOUL.md
    }

    // 2. Principles (PRINCIPLES.md)
    try {
      const principles = await fs.readFile(
        path.join(soulDir, "PRINCIPLES.md"),
        "utf-8"
      );
      sections.push("# Decision Principles\n\n" + principles);
    } catch {
      // No PRINCIPLES.md
    }

    // 3. Learned genes (evolution/genes.json)
    interface SoulPermissions {
      memory?: Record<string, boolean | string>;
      restrictedActions?: string[];
    }
    let capabilities: { tools: string[]; permissions?: SoulPermissions } = { tools: [] };
    try {
      const genesRaw = await fs.readFile(
        path.join(soulDir, "evolution", "genes.json"),
        "utf-8"
      );
      const genesData = JSON.parse(genesRaw);
      const genes: Gene[] = genesData.genes || [];

      if (genes.length > 0) {
        let genesSection = "# Learned Patterns (apply these during analysis)\n\n";
        for (const gene of genes) {
          genesSection += `## ${gene.id}\n`;
          genesSection += `**Category:** ${gene.category}\n`;
          genesSection += `**Signal:** ${gene.signal}\n`;
          if (gene.preconditions?.length) {
            genesSection += "**Preconditions:**\n";
            for (const p of gene.preconditions) {
              genesSection += `  - ${p}\n`;
            }
          }
          if (gene.strategy?.length) {
            genesSection += "**Strategy:**\n";
            for (const s of gene.strategy) {
              genesSection += `  1. ${s}\n`;
            }
          }
          genesSection += "\n";
        }
        sections.push(genesSection);
      }
    } catch {
      // No genes
    }

    // 4. Capabilities & constraints
    try {
      const capsRaw = await fs.readFile(
        path.join(soulDir, "capabilities.json"),
        "utf-8"
      );
      capabilities = JSON.parse(capsRaw);
      const perms = capabilities.permissions || {};
      const memory = perms.memory || {};
      const restricted = perms.restrictedActions || [];

      let constraintSection = "# Operational Constraints\n\n";

      if (Object.keys(memory).length > 0) {
        constraintSection += "## Memory Access\n";
        for (const [k, v] of Object.entries(memory)) {
          constraintSection += `- **${k}:** ${JSON.stringify(v)}\n`;
        }
        constraintSection += "\n";
      }

      if (restricted.length > 0) {
        constraintSection += "## Restricted Actions (DO NOT execute these)\n";
        for (const r of restricted) {
          constraintSection += `- ${r}\n`;
        }
        constraintSection += "\n";
      }

      constraintSection += "## Available Tools\n";
      constraintSection += (capabilities.tools || []).join(", ") + "\n";

      sections.push(constraintSection);
    } catch {
      // No capabilities.json
    }

    // 5. Handoff context
    if (body.taskId) {
      try {
        const handoffDoc = await fs.readFile(
          path.join(HANDOFFS_DIR, `${body.taskId}-handoff.md`),
          "utf-8"
        );
        sections.push("# Task Handoff Context\n\n" + handoffDoc);
      } catch {
        // No handoff doc for this task
      }
    }

    // 6. Extra context
    if (body.extraContext) {
      sections.push("# Additional Context\n\n" + body.extraContext);
    }

    // 7. Completion protocol
    sections.push(
      "# Completion Protocol\n\n" +
        "- When done: report what was accomplished concisely\n" +
        "- If blocked: surface the blocker immediately — do not spiral or guess\n" +
        "- Do not add scope beyond what was asked\n" +
        "- Prefer editing existing files over creating new ones\n" +
        "- Security-first: no secrets in output, no destructive commands without confirmation"
    );

    const preamble = sections.join("\n\n---\n\n");
    const subagentType = determineSubagentType(capabilities.tools || []);

    // Log spawn event
    const db = getDb();
    await db.insert(soulSpawns).values({
      soulId,
      taskId: body.taskId || null,
      subagentType,
    });

    return NextResponse.json({
      preamble,
      subagentType,
      soulId,
    });
  } catch (error) {
    console.error("Failed to generate soul prompt:", error);
    return NextResponse.json(
      { error: "Failed to generate soul prompt" },
      { status: 500 }
    );
  }
});
