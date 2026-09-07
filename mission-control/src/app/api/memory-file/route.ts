/**
 * Memory File API — open a file a watcher event points at (vault note, injections log, MEMORY.md).
 *
 * GET /api/memory-file?path=<abs-or-rel>   — file content (jailed to ~/.openclaw)
 * GET /api/memory-file?path=<...>&tail=N    — last N lines (for the big injections log)
 *
 * Read-only. The jail (~/.openclaw) CONTAINS the node's secrets — openclaw.env,
 * openclaw.json (gateway token), auth-profiles.json, identity keys, rendered
 * NATS confs, session transcripts, the MC token itself. A read-anything-in-the-
 * jail API was a secret-disclosure API (review C-4) because the old basename
 * denylist missed most of those. Now: realpath must stay inside the root, and
 * anything secret-shaped (dotfile segment, credential dir/name/extension) is
 * refused structurally via lib/safe-path.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { OPENCLAW_ROOT } from "@/lib/config";
import { isSensitiveRelPath, resolveWithinRoot } from "@/lib/safe-path";

export const dynamic = "force-dynamic";

/** Directories under ~/.openclaw that hold credentials or raw transcripts, never documents. */
const BLOCKED_DIRS = ["agents", "config", "nats", "identity", "node_modules"] as const;
const MAX_BYTES = 2_000_000;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("path");
  const tail = parseInt(request.nextUrl.searchParams.get("tail") || "0", 10);
  if (!raw) return NextResponse.json({ error: "missing path" }, { status: 400 });

  const hit = resolveWithinRoot(OPENCLAW_ROOT, raw);
  if (!hit) {
    return NextResponse.json({ error: "path outside ~/.openclaw denied" }, { status: 403 });
  }
  if (isSensitiveRelPath(hit.rel, { blockedDirs: BLOCKED_DIRS, nameHeuristics: true })) {
    return NextResponse.json({ error: "secret path denied" }, { status: 403 });
  }

  try {
    const stat = fs.statSync(hit.real);
    if (!stat.isFile()) return NextResponse.json({ error: "not a file" }, { status: 400 });
    if (stat.size > MAX_BYTES) {
      return NextResponse.json({ error: `file too large (>${MAX_BYTES} bytes)`, size: stat.size }, { status: 413 });
    }
    let content = fs.readFileSync(hit.real, "utf-8");
    if (tail > 0) {
      const lines = content.trim().split("\n");
      content = lines.slice(-tail).join("\n");
    }
    return NextResponse.json({ path: hit.real, content, bytes: content.length });
  } catch (err) {
    return NextResponse.json({ error: String(err), path: hit.real }, { status: 404 });
  }
}
