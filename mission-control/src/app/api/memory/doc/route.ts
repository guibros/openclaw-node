import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_ROOT } from "@/lib/config";
import { withTrace } from "@/lib/tracer";
import { isSensitiveRelPath, resolveWithinRoot } from "@/lib/safe-path";

/**
 * GET /api/memory/doc?path=memory/2026-02-18.md
 * Reads a single document fresh from disk.
 * Path is relative to the workspace root.
 * Validates the resolved path stays within WORKSPACE_ROOT (path traversal protection).
 */
export const GET = withTrace("memory", "GET /api/memory/doc", async (request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;
    const relPath = searchParams.get("path");

    if (!relPath) {
      return NextResponse.json(
        { error: "Query parameter 'path' is required" },
        { status: 400 }
      );
    }

    // Jail + symlink resolution + secret-shape refusal (lib/safe-path). This
    // route previously skipped realpath (a symlink inside the workspace
    // escaped the jail) and had no size cap (a 400 MB DB read per request).
    const hit = resolveWithinRoot(WORKSPACE_ROOT, relPath);
    if (!hit) {
      console.warn(`[SECURITY] memory/doc: path refused`);
      return NextResponse.json(
        { error: "Path must be within the workspace root" },
        { status: 400 }
      );
    }
    if (isSensitiveRelPath(hit.rel)) {
      console.warn(`[SECURITY] memory/doc: secret path refused`);
      return NextResponse.json({ error: "Secret path denied" }, { status: 403 });
    }
    const resolved = hit.real;

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return NextResponse.json(
        { error: "Path is not a file" },
        { status: 400 }
      );
    }
    if (stat.size > 500_000) {
      return NextResponse.json({ error: "File too large (>500KB)", size: stat.size }, { status: 413 });
    }

    const content = fs.readFileSync(resolved, "utf-8");

    // Derive metadata from the file
    const basename = path.basename(resolved, path.extname(resolved));
    const parentDir = path.basename(path.dirname(resolved));

    // Detect source type
    let source = "unknown";
    let category: string | null = null;
    let date: string | null = null;

    if (resolved.includes("/memory/") && /^\d{4}-\d{2}-\d{2}$/.test(basename)) {
      source = "daily_log";
      date = basename;
    } else if (resolved.endsWith("MEMORY.md")) {
      source = "long_term_memory";
    } else if (resolved.includes("/memory-vault/") || resolved.includes("/clawvault/")) {
      source = "clawvault";
      category = parentDir;
    }

    // Extract title from first markdown heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : basename;

    return NextResponse.json({
      title,
      source,
      category,
      date,
      content,
      filePath: relPath,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (err) {
    console.error("GET /api/memory/doc error:", err);
    return NextResponse.json(
      { error: "Failed to read document" },
      { status: 500 }
    );
  }
});
