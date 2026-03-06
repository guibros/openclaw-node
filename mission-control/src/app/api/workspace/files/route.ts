import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_ROOT } from "@/lib/config";
import fs from "fs";
import path from "path";

interface FileNode {
  name: string;
  path: string; // relative to workspace
  type: "file" | "dir";
  children?: FileNode[];
  ext?: string;
  size?: number;
}

const IGNORED = new Set([
  "node_modules", ".next", ".git", ".npm-cache", ".npm-global",
  ".DS_Store", ".tmp", "__pycache__", ".openclaw",
]);

const MAX_DEPTH = 6;

function scanDir(absPath: string, relPath: string, depth: number): FileNode[] {
  if (depth > MAX_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: FileNode[] = [];

  // Sort: dirs first, then files, alphabetical
  const sorted = entries
    .filter((e) => !IGNORED.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of sorted) {
    const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    const entryAbs = path.join(absPath, entry.name);

    if (entry.isDirectory()) {
      const children = scanDir(entryAbs, entryRel, depth + 1);
      result.push({
        name: entry.name,
        path: entryRel,
        type: "dir",
        children,
      });
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      let size = 0;
      try {
        size = fs.statSync(entryAbs).size;
      } catch {}
      result.push({
        name: entry.name,
        path: entryRel,
        type: "file",
        ext,
        size,
      });
    }
  }

  return result;
}

/**
 * GET /api/workspace/files
 * Returns the full workspace file tree.
 */
export async function GET(_request: NextRequest) {
  try {
    const tree = scanDir(WORKSPACE_ROOT, "", 0);
    return NextResponse.json({ root: WORKSPACE_ROOT, tree });
  } catch (err) {
    console.error("GET /api/workspace/files error:", err);
    return NextResponse.json(
      { error: "Failed to scan workspace" },
      { status: 500 }
    );
  }
}
