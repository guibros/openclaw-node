import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

export const dynamic = "force-dynamic";

// The watcher (bin/node-watch.mjs) writes this snapshot on every run/tick.
// MC is a pure viewer — it reads the file, it does not probe the node itself.
const JSON_PATH =
  process.env.NODE_WATCH_JSON || path.join(os.homedir(), ".openclaw", ".node-watch.json");

const EMPTY_COUNTS = { WORKING: 0, BROKEN: 0, OFF: 0, UNKNOWN: 0 };

export async function GET() {
  if (!fs.existsSync(JSON_PATH)) {
    return NextResponse.json({
      missing: true,
      counts: EMPTY_COUNTS,
      results: [],
      meta: { nodeId: "(unknown)", mode: "none", timestamp: null },
      hint: "Watcher has not run yet. Run: node bin/node-watch.mjs (or `node bin/node-watch.mjs --watch` for continuous).",
    });
  }
  try {
    const report = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
    const stat = fs.statSync(JSON_PATH);
    return NextResponse.json({
      ...report,
      counts: report.counts ?? EMPTY_COUNTS,
      results: report.results ?? [],
      fileMtime: stat.mtime.toISOString(),
      fileAgeMs: Date.now() - stat.mtimeMs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, counts: EMPTY_COUNTS, results: [] },
      { status: 500 },
    );
  }
}
