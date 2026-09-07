import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_ROOT } from "@/lib/config";
import { withTrace } from "@/lib/tracer";
import { isSensitiveRelPath, resolveWithinRoot } from "@/lib/safe-path";
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

    // Jail + symlink resolution + secret-shape refusal live in one helper (lib/safe-path).
    // A workspace read must never return .env.local, an Obsidian API key, a DB,
    // or anything under node_modules — regardless of how the path was spelled.
    const hit = resolveWithinRoot(WORKSPACE_ROOT, relPath);
    if (!hit) {
      console.warn(`[SECURITY] workspace/read: path refused: ${relPath}`);
      return NextResponse.json({ error: "Path traversal denied" }, { status: 403 });
    }
    if (isSensitiveRelPath(hit.rel)) {
      console.warn(`[SECURITY] workspace/read: secret path refused: ${relPath}`);
      return NextResponse.json({ error: "Secret path denied" }, { status: 403 });
    }
    const absPath = hit.real;

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
