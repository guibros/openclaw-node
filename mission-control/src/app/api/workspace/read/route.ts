import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_ROOT } from "@/lib/config";
import { withTrace } from "@/lib/tracer";
import fs from "fs";
import path from "path";

/**
 * GET /api/workspace/read?path=SOUL.md
 * Read any file from the workspace (relative path).
 * Returns raw content + metadata. Only allows files under WORKSPACE_ROOT.
 */
export const GET = withTrace("workspace", "GET /api/workspace/read", async (request: NextRequest) => {
  try {
    const relPath = request.nextUrl.searchParams.get("path");
    if (!relPath) {
      return NextResponse.json({ error: "Missing path" }, { status: 400 });
    }

    const absPath = path.resolve(WORKSPACE_ROOT, relPath);
    // Security: ensure path is within workspace
    if (!absPath.startsWith(WORKSPACE_ROOT + path.sep) && absPath !== WORKSPACE_ROOT) {
      return NextResponse.json({ error: "Path traversal denied" }, { status: 403 });
    }

    if (!fs.existsSync(absPath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Defeat symlink traversal: resolve the real path and re-check prefix
    const realPath = fs.realpathSync(absPath);
    const realRoot = fs.realpathSync(WORKSPACE_ROOT);
    if (!realPath.startsWith(realRoot + path.sep) && realPath !== realRoot) {
      return NextResponse.json({ error: "Path traversal denied" }, { status: 403 });
    }

    if (!fs.existsSync(realPath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: "Path is a directory" }, { status: 400 });
    }

    // Don't read huge files
    if (stat.size > 500_000) {
      return NextResponse.json(
        { error: "File too large (>500KB)", size: stat.size },
        { status: 413 }
      );
    }

    const content = fs.readFileSync(absPath, "utf-8");
    const ext = path.extname(relPath).toLowerCase();
    const title = content.match(/^#\s+(.+)/m)?.[1] || path.basename(relPath);

    // Detect source type
    let source = "workspace";
    if (relPath.startsWith("memory/") && /\d{4}-\d{2}-\d{2}/.test(relPath)) {
      source = "daily_log";
    } else if (relPath === "MEMORY.md") {
      source = "long_term_memory";
    } else if (relPath.startsWith("memory-vault/")) {
      source = "clawvault";
    } else if (relPath.includes("/lore/")) {
      source = "lore";
    }

    return NextResponse.json({
      filePath: relPath,
      title,
      content,
      source,
      ext,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (err) {
    console.error("GET /api/workspace/read error:", err);
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 500 }
    );
  }
});
