import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { withTrace } from "@/lib/tracer";

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
export const GET = withTrace("settings", "GET /api/settings/gateway", async () => {
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
});

/**
 * PATCH /api/settings/gateway
 * Update gateway-related settings. Accepts partial updates.
 * Body: { heartbeat?: { target, every? }, maxConcurrent?: number }
 */
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "heartbeat", "maxConcurrent", "compaction", "gateway",
]);
const ALLOWED_GATEWAY_KEYS = new Set(["port", "mode", "bind"]);
const VALID_MODES = new Set(["local", "remote", "hybrid"]);
const VALID_BINDS = new Set(["loopback", "tailscale", "any"]);

export const PATCH = withTrace("settings", "PATCH /api/settings/gateway", async (request: NextRequest) => {
  try {
    const body = await request.json();

    // Reject unknown top-level keys
    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_TOP_LEVEL_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Unknown keys: ${unknownKeys.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate gateway sub-object if present
    if (body.gateway !== undefined) {
      if (typeof body.gateway !== "object" || body.gateway === null || Array.isArray(body.gateway)) {
        return NextResponse.json(
          { error: "gateway must be an object" },
          { status: 400 }
        );
      }
      const unknownGw = Object.keys(body.gateway).filter((k) => !ALLOWED_GATEWAY_KEYS.has(k));
      if (unknownGw.length > 0) {
        return NextResponse.json(
          { error: `Unknown gateway keys: ${unknownGw.join(", ")}` },
          { status: 400 }
        );
      }
      if (body.gateway.port !== undefined) {
        if (!Number.isInteger(body.gateway.port) || body.gateway.port < 1 || body.gateway.port > 65535) {
          return NextResponse.json(
            { error: "gateway.port must be an integer between 1 and 65535" },
            { status: 400 }
          );
        }
      }
      if (body.gateway.mode !== undefined && !VALID_MODES.has(body.gateway.mode)) {
        return NextResponse.json(
          { error: `gateway.mode must be one of: ${[...VALID_MODES].join(", ")}` },
          { status: 400 }
        );
      }
      if (body.gateway.bind !== undefined && !VALID_BINDS.has(body.gateway.bind)) {
        return NextResponse.json(
          { error: `gateway.bind must be one of: ${[...VALID_BINDS].join(", ")}` },
          { status: 400 }
        );
      }
    }

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

    // Gateway settings
    if (body.gateway !== undefined) {
      if (!config.gateway) config.gateway = {};
      if (body.gateway.port !== undefined) config.gateway.port = body.gateway.port;
      if (body.gateway.mode !== undefined) config.gateway.mode = body.gateway.mode;
      if (body.gateway.bind !== undefined) config.gateway.bind = body.gateway.bind;
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
});
