import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { WORKSPACE_ROOT } from "@/lib/config";
import { withTrace } from "@/lib/tracer";

const execFileAsync = promisify(execFile);

const SKILL_AUDIT = path.join(WORKSPACE_ROOT, "bin", "skill-audit");

/**
 * GET /api/skills/:id/health
 * Returns quality health data for a single skill.
 */
export const GET = withTrace("skills", "GET /api/skills/:id/health", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  if (!id || /[^a-zA-Z0-9_\-]/.test(id)) {
    return NextResponse.json({ error: "Invalid skill ID" }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync(
      "python3",
      [SKILL_AUDIT, "--skill", id, "--json"],
      { timeout: 10_000, cwd: WORKSPACE_ROOT }
    );

    const data = JSON.parse(stdout);

    if (data.skills && data.skills.length > 0) {
      return NextResponse.json(data.skills[0]);
    }

    return NextResponse.json(
      { error: "Skill not found", skill: id },
      { status: 404 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message.includes("not found")) {
      return NextResponse.json(
        { error: "Skill not found", skill: id },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "skill-audit failed", detail: message },
      { status: 500 }
    );
  }
});
