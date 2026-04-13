import { NextResponse } from "next/server";
import { dbHealth, walCheckpoint } from "@/lib/db";
import fs from "fs";
import { DB_PATH } from "@/lib/config";

export const dynamic = "force-dynamic";

// WAL size threshold: 50MB — above this, force a checkpoint
const WAL_WARN_BYTES = 50 * 1024 * 1024;
// Checkpoint must complete within 10s or we skip it
const CHECKPOINT_TIMEOUT_MS = 10_000;

/**
 * GET /api/system/health
 *
 * Returns DB health diagnostics. Runs a WAL checkpoint if WAL is oversized.
 * Use this endpoint for monitoring — memory-daemon or external health checks.
 *
 * Response:
 *   { status: "healthy" | "degraded" | "unhealthy", db: {...}, uptime_s: N }
 */
export async function GET() {
  const health = dbHealth();

  if (!health.ok) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: health.error,
        uptime_s: Math.floor(process.uptime()),
      },
      { status: 503 }
    );
  }

  // Auto-checkpoint if WAL is bloated (with timeout guard)
  let checkpointResult = null;
  if (health.walSizeBytes && health.walSizeBytes > WAL_WARN_BYTES) {
    const start = Date.now();
    checkpointResult = walCheckpoint();
    const elapsed = Date.now() - start;
    if (elapsed > CHECKPOINT_TIMEOUT_MS) {
      console.warn(`[health] WAL checkpoint took ${elapsed}ms (threshold: ${CHECKPOINT_TIMEOUT_MS}ms)`);
    }
  }

  // Re-check WAL size after checkpoint to determine actual status
  let currentWalBytes = health.walSizeBytes ?? 0;
  if (checkpointResult) {
    try {
      const walPath = DB_PATH + "-wal";
      if (fs.existsSync(walPath)) {
        currentWalBytes = fs.statSync(walPath).size;
      }
    } catch { /* stat failure non-fatal, use original */ }
  }

  const degraded = currentWalBytes > WAL_WARN_BYTES;

  return NextResponse.json({
    status: degraded ? "degraded" : "healthy",
    db: {
      taskCount: health.taskCount,
      obsEventCount: health.obsEventCount,
      dbSizeMB: Math.round((health.dbSizeBytes ?? 0) / 1024 / 1024),
      walSizeMB: Math.round(currentWalBytes / 1024 / 1024),
    },
    checkpoint: checkpointResult,
    uptime_s: Math.floor(process.uptime()),
  });
}
