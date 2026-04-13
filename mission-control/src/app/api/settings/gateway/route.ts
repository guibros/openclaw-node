import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

const CONFIG_PATH = path.join(
  process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw"),
  "openclaw.json"
);

async function loadConfig(): Promise<Record<string, any>> {
  const raw = await fs.readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

async function saveConfig(config: Record<string, any>): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/**
 * GET /api/settings/gateway
 * Returns the gateway + agent defaults config (heartbeat, fallbacks, etc.)
 */
export async function GET() {
  try {
    const config = await loadConfig();
    const defaults = config.agents?.defaults || {};
    const gateway = config.gateway || {};

    return NextResponse.json({
      heartbeat: defaults.heartbeat || { target: "none" },
      model: defaults.model || {},
      compaction: defaults.compaction || {},
      maxConcurrent: defaults.maxConcurrent ?? 4,
      gateway: {
        port: gateway.port ?? 18789,
        mode: gateway.mode ?? "local",
        bind: gateway.bind ?? "loopback",
      },
    });
  } catch (error) {
    console.error("Failed to load gateway settings:", error);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/gateway
 * Update gateway-related settings. Accepts partial updates.
 * Body: { heartbeat?: { target, every? }, maxConcurrent?: number }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const config = await loadConfig();

    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};

    // Heartbeat
    if (body.heartbeat !== undefined) {
      const hb: Record<string, string> = { target: body.heartbeat.target || "none" };
      if (body.heartbeat.every) {
        hb.every = body.heartbeat.every;
      }
      config.agents.defaults.heartbeat = hb;
    }

    // Max concurrent
    if (body.maxConcurrent !== undefined) {
      config.agents.defaults.maxConcurrent = body.maxConcurrent;
    }

    // Compaction mode
    if (body.compaction !== undefined) {
      config.agents.defaults.compaction = body.compaction;
    }

    await saveConfig(config);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to save gateway settings:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
