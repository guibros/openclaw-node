import { NextResponse } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

/**
 * POST /api/system/restart
 *
 * Kills and restarts Mission Control. The process exits, and
 * launchd (macOS) or systemd (Linux) restarts it automatically.
 * In dev mode, clears the .next cache first for a clean rebuild.
 */
export async function POST() {
  try {
    const isDev = process.env.NODE_ENV !== "production";

    // Clear Next.js cache for a clean restart
    if (isDev) {
      try {
        const cwd = process.cwd();
        execSync(`rm -rf ${cwd}/.next/cache`, { timeout: 5000 });
      } catch { /* Intentional: cache clear before process exit */ }
    }

    // Send response BEFORE killing ourselves
    const response = NextResponse.json({
      message: "Restarting Mission Control...",
      mode: isDev ? "dev" : "production",
    });

    // Schedule the kill after the response is sent
    setTimeout(() => {
      process.exit(0); // Clean exit — launchd/systemd will restart
    }, 500);

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Restart failed" },
      { status: 500 }
    );
  }
}
