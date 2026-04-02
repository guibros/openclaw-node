import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "@/lib/config";
import { withTrace } from "@/lib/tracer";

export const runtime = "nodejs";

const SCREENSHOT_DIR = path.join(WORKSPACE_ROOT, ".tmp", "screenshots");
const SCREENSHOT_BIN = path.join(WORKSPACE_ROOT, "bin", "screenshot");

/**
 * POST /api/screenshot — Capture a desktop screenshot
 * Body (optional): { display?: number, delay?: number }
 * Returns: { path, filename, timestamp }
 */
export const POST = withTrace("screenshot", "POST /api/screenshot", async (request: NextRequest) => {
  try {
    let display: number | undefined;
    let delay: number | undefined;

    try {
      const body = await request.json();
      display = body.display;
      delay = body.delay;
    } catch {
      // No body is fine — use defaults
    }

    // Validate inputs to prevent injection
    if (display !== undefined && (!Number.isInteger(display) || display < 1 || display > 16)) {
      return NextResponse.json({ error: "Invalid display number" }, { status: 400 });
    }
    if (delay !== undefined && (!Number.isInteger(delay) || delay < 0 || delay > 30)) {
      return NextResponse.json({ error: "Invalid delay value" }, { status: 400 });
    }

    const args: string[] = [];
    if (display) args.push("--display", String(display));
    if (delay) args.push("--delay", String(delay));

    // Use execFileSync (no shell) instead of execSync to prevent injection
    const result = execFileSync(SCREENSHOT_BIN, args, {
      encoding: "utf-8",
      timeout: 15000,
    }).trim();

    if (!result || !existsSync(result)) {
      return NextResponse.json(
        { error: "Screenshot capture failed — no file produced" },
        { status: 500 }
      );
    }

    const filename = path.basename(result);
    return NextResponse.json({
      success: true,
      path: result,
      filename,
      timestamp: new Date().toISOString(),
    }, { status: 201 });
  } catch (err) {
    console.error("POST /api/screenshot error:", err);
    return NextResponse.json(
      { error: "Screenshot capture failed. Check screen recording permissions." },
      { status: 500 }
    );
  }
});

/**
 * GET /api/screenshot — List recent screenshots or serve one
 * Query: ?latest=true — return the most recent screenshot metadata
 * Query: ?file=<filename> — serve the image binary
 * Query: (none) — list last 20 screenshots
 */
export const GET = withTrace("screenshot", "GET /api/screenshot", async (request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;
    const latest = searchParams.get("latest");
    const file = searchParams.get("file");

    if (!existsSync(SCREENSHOT_DIR)) {
      return NextResponse.json({ screenshots: [] });
    }

    // Serve a specific file as image
    if (file) {
      const safeName = path.basename(file); // prevent path traversal
      const filePath = path.join(SCREENSHOT_DIR, safeName);
      if (!existsSync(filePath)) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      const buffer = readFileSync(filePath);
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `inline; filename="${safeName}"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    // List screenshots sorted by mtime (newest first)
    const files = readdirSync(SCREENSHOT_DIR)
      .filter(f => f.endsWith(".png"))
      .map(f => {
        const fp = path.join(SCREENSHOT_DIR, f);
        const stat = statSync(fp);
        return { filename: f, path: fp, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));

    if (latest === "true") {
      if (files.length === 0) {
        return NextResponse.json({ error: "No screenshots found" }, { status: 404 });
      }
      return NextResponse.json(files[0]);
    }

    return NextResponse.json({ screenshots: files.slice(0, 20) });
  } catch (err) {
    console.error("GET /api/screenshot error:", err);
    return NextResponse.json({ error: "Failed to list screenshots" }, { status: 500 });
  }
});
