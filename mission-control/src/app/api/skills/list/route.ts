import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { WORKSPACE_ROOT } from "@/lib/config";
import { withTrace } from "@/lib/tracer";

const execFileAsync = promisify(execFile);

const SKILL_AUDIT = path.join(WORKSPACE_ROOT, "bin", "skill-audit");

let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 60_000; // 60 seconds

/**
 * GET /api/skills/list
 * Returns all skills with quality grades. Cached for 60s.
 */
export const GET = withTrace("skills", "GET /api/skills/list", async () => {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const { stdout } = await execFileAsync("python3", [SKILL_AUDIT, "--json"], {
      timeout: 15_000,
      cwd: WORKSPACE_ROOT,
    });

    const data = JSON.parse(stdout);
    cache = { data, ts: now };

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "skill-audit failed", detail: message },
      { status: 500 }
    );
  }
});
