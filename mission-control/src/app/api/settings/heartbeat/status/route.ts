import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

const HOME = os.homedir();
const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  path.join(HOME, ".openclaw/workspace");
const TRANSCRIPT_REGISTRY = path.join(
  HOME,
  ".openclaw/config/transcript-sources.json"
);

// Patterns that identify a heartbeat-triggered gateway session.
const HEARTBEAT_PATTERNS = [
  /HEARTBEAT/i,
  /Read HEARTBEAT\.md/i,
  /heartbeat poll/i,
  /heartbeat check/i,
  /bin\/heartbeat/i,
];

function loadTranscriptSources(): Array<{
  name: string;
  path: string;
  format: string;
  enabled?: boolean;
}> {
  if (fs.existsSync(TRANSCRIPT_REGISTRY)) {
    try {
      const reg = JSON.parse(fs.readFileSync(TRANSCRIPT_REGISTRY, "utf-8"));
      return (reg.sources || [])
        .filter((s: { enabled?: boolean }) => s.enabled !== false)
        .map((s: { path: string; [key: string]: unknown }) => ({
          ...s,
          path: s.path.startsWith("~")
            ? path.join(HOME, s.path.slice(1))
            : s.path,
        }));
    } catch {
      /* fall through */
    }
  }
  return [
    {
      name: "gateway",
      path: path.join(HOME, ".openclaw/agents/main/sessions"),
      format: "openclaw-gateway",
    },
  ];
}

function isHeartbeatSession(filePath: string, scanLines = 15): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").slice(0, scanLines);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const msg =
          entry.message || entry.text || entry.content || "";
        const text = typeof msg === "string" ? msg : JSON.stringify(msg);
        if (HEARTBEAT_PATTERNS.some((p) => p.test(text))) return true;
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* unreadable */
  }
  return false;
}

function loadDaemonState(): {
  state: string;
  sessionId: string | null;
  lastActivityTime: number;
  pid: number;
  updatedAt: number;
} | null {
  const daemonFile = path.join(WORKSPACE, ".tmp/daemon-state.json");
  if (!fs.existsSync(daemonFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(daemonFile, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * GET /api/settings/heartbeat/status
 *
 * Returns the current heartbeat detection state by scanning the most recently
 * modified gateway session JSONL for heartbeat trigger patterns.
 *
 * Response:
 * {
 *   isActive: boolean,           // true if a heartbeat session is currently running
 *   sessionId: string | null,    // gateway session ID of the active heartbeat
 *   detectedAt: string | null,   // ISO timestamp of the session's last modification
 *   ageSeconds: number | null,   // how old (in seconds) the session is
 *   sessionType: "heartbeat" | "main" | "unknown",
 *   daemon: {
 *     state: string,             // ACTIVE | IDLE | ENDED | BOOT | UNKNOWN
 *     sessionId: string | null,  // daemon-tracked session ID
 *     isActive: boolean,
 *     lastActivityTime: number | null,
 *   }
 * }
 */
export async function GET() {
  try {
    const sources = loadTranscriptSources();
    const gatewaySources = sources.filter((s) => s.format === "openclaw-gateway");

    const daemonState = loadDaemonState();
    const daemon = {
      state: daemonState?.state || "UNKNOWN",
      sessionId: daemonState?.sessionId || null,
      isActive:
        daemonState?.state === "ACTIVE" || daemonState?.state === "IDLE",
      lastActivityTime: daemonState?.lastActivityTime || null,
    };

    // Find the most recently modified gateway session
    let newestFile: string | null = null;
    let newestMtime = 0;
    let newestSessionId: string | null = null;

    for (const source of gatewaySources) {
      if (!fs.existsSync(source.path)) continue;
      let files: string[];
      try {
        files = fs
          .readdirSync(source.path)
          .filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      for (const f of files) {
        const fullPath = path.join(source.path, f);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestFile = fullPath;
            newestSessionId = path.basename(f, ".jsonl");
          }
        } catch {
          /* skip */
        }
      }
    }

    if (!newestFile) {
      return NextResponse.json({
        isActive: false,
        sessionId: null,
        detectedAt: null,
        ageSeconds: null,
        sessionType: "unknown",
        daemon,
      });
    }

    const now = Date.now();
    const ageMs = now - newestMtime;
    const ageSeconds = Math.floor(ageMs / 1000);
    const detectedAt = new Date(newestMtime).toISOString();

    // Active window: 30 minutes (1800s), matching the heartbeat interval
    const withinWindow = ageMs <= 30 * 60 * 1000;
    const isHb = withinWindow && isHeartbeatSession(newestFile);

    return NextResponse.json({
      isActive: isHb,
      sessionId: isHb ? newestSessionId : null,
      detectedAt: isHb ? detectedAt : null,
      ageSeconds: isHb ? ageSeconds : null,
      sessionType: withinWindow ? (isHb ? "heartbeat" : "main") : "unknown",
      daemon,
    });
  } catch (err) {
    console.error("[heartbeat/status] error:", err);
    return NextResponse.json(
      { error: "Failed to detect heartbeat status" },
      { status: 500 }
    );
  }
}
