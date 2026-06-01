/**
 * Memory File API — open a file a watcher event points at (vault note, injections log, MEMORY.md).
 *
 * GET /api/memory-file?path=<abs-or-rel>   — file content (jailed to ~/.openclaw)
 * GET /api/memory-file?path=<...>&tail=N    — last N lines (for the big injections log)
 *
 * Read-only, path-traversal + symlink guarded to OPENCLAW_ROOT.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { OPENCLAW_ROOT } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("path");
  const tail = parseInt(request.nextUrl.searchParams.get("tail") || "0", 10);
  if (!raw) return NextResponse.json({ error: "missing path" }, { status: 400 });

  // Accept absolute paths under OPENCLAW_ROOT or paths relative to it.
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(OPENCLAW_ROOT, raw);
  if (abs !== OPENCLAW_ROOT && !abs.startsWith(OPENCLAW_ROOT + path.sep)) {
    return NextResponse.json({ error: "path outside ~/.openclaw denied" }, { status: 403 });
  }

  try {
    const real = fs.realpathSync(abs); // defeat symlink escapes
    if (real !== OPENCLAW_ROOT && !real.startsWith(OPENCLAW_ROOT + path.sep)) {
      return NextResponse.json({ error: "symlink escape denied" }, { status: 403 });
    }
    let content = fs.readFileSync(real, "utf-8");
    if (tail > 0) {
      const lines = content.trim().split("\n");
      content = lines.slice(-tail).join("\n");
    }
    return NextResponse.json({ path: abs, content, bytes: content.length });
  } catch (err) {
    return NextResponse.json({ error: String(err), path: abs }, { status: 404 });
  }
}
