import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "@/lib/config";
import { withTrace } from "@/lib/tracer";

const HOME = process.env.HOME || "/Users/moltymac";

const SEARCH_DIRS = [
  WORKSPACE_ROOT,
  path.join(HOME, "Desktop"),
  path.join(HOME, "Downloads"),
  path.join(HOME, "Documents"),
  path.join(HOME, "Pictures"),
];

const MAX_DEPTH = 5;

/**
 * Normalize a string for fuzzy filename matching:
 * - NFC Unicode normalization (macOS APFS uses NFD, browsers send NFC)
 * - Replace curly quotes with straight quotes (macOS uses curly, browsers normalize to straight)
 */
function normalizeForMatch(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

/**
 * Recursively search for a file by basename using Node fs (preserves Unicode normalization).
 */
function findFile(dir: string, target: string, depth: number): string | null {
  if (depth <= 0) return null;
  const normTarget = normalizeForMatch(target);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      if (entry.name === target || normalizeForMatch(entry.name) === normTarget) {
        return path.join(dir, entry.name);
      }
    }
  }
  // Recurse into subdirectories
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const found = findFile(path.join(dir, entry.name), target, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * POST /api/resolve-path
 * Given a basename (filename), search workspace + home dirs to find the full path.
 * Uses Node fs directly to preserve Unicode normalization (macOS NFD/NFC).
 * Body: { name: "somefile.md" }
 * Returns: { path: "/full/path/to/somefile.md" } or { path: null }
 */
export const POST = withTrace("workspace", "POST /api/resolve-path", async (request: NextRequest) => {
  try {
    const { name } = await request.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Sanitize: strip path separators to prevent traversal
    const basename = name.replace(/[/\\]/g, "").trim();
    if (!basename) {
      return NextResponse.json({ path: null });
    }

    for (const dir of SEARCH_DIRS) {
      const found = findFile(dir, basename, MAX_DEPTH);
      if (found) {
        return NextResponse.json({ path: found });
      }
    }

    return NextResponse.json({ path: null });
  } catch (err) {
    console.error("POST /api/resolve-path error:", err);
    return NextResponse.json({ error: "Failed to resolve path" }, { status: 500 });
  }
});
