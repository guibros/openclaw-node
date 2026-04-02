/**
 * Gateway notification via WebSocket chat.send.
 * Injects a message into the TUI chat stream via the main session.
 * Message stays visible. Triggers an agent turn (companion bridge).
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { traceCall } from "./tracer";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || "/Users/moltymac", ".openclaw");
const CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");

const SESSION_KEY = "agent:main:main";

interface GatewayConfig {
  port: number;
  host: string;
  token: string;
}

function loadGatewayConfig(): GatewayConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return {
      port: raw.gateway?.port || 18789,
      host: raw.gateway?.host || "127.0.0.1",
      token: raw.gateway?.auth?.token || "",
    };
  } catch {
    return { port: 18789, host: "127.0.0.1", token: "" };
  }
}

/**
 * Send a notification message to the OpenClaw TUI.
 * Uses chat.send — message persists in TUI chat stream.
 */
export function gatewayNotify(text: string): Promise<boolean> {
  const _start = Date.now();
  const config = loadGatewayConfig();
  if (!config.token) {
    console.error("gateway-notify: no gateway token configured");
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve(false);
    }, 5000);

    const ws = new WebSocket(`ws://${config.host}:${config.port}/ws`);

    ws.onmessage = (e: MessageEvent) => {
      const d = JSON.parse(String(e.data));

      if (d.type === "event" && d.event === "connect.challenge") {
        ws.send(JSON.stringify({
          type: "req",
          id: randomUUID(),
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: "gateway-client",
              displayName: "MC-Kanban",
              version: "1.0.0",
              platform: process.platform,
              mode: "backend",
            },
            auth: { token: config.token },
            role: "operator",
            scopes: ["operator.admin"],
            caps: [],
          },
        }));
      }

      if (d.type === "res" && d.ok === true && d.payload?.type === "hello-ok") {
        ws.send(JSON.stringify({
          type: "req",
          id: randomUUID(),
          method: "chat.send",
          params: {
            sessionKey: SESSION_KEY,
            message: text,
            idempotencyKey: randomUUID(),
          },
        }));
      }

      // chat.send accepted — close connection
      if (d.type === "res" && d.ok === true && d.payload?.runId) {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        traceCall("gateway-notify", "gatewayNotify", _start, "ok");
        resolve(true);
      }

      if (d.type === "res" && d.ok === false) {
        console.error("gateway-notify error:", d.error?.message);
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      traceCall("gateway-notify", "gatewayNotify", _start, undefined, "ws error");
      resolve(false);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
    };
  });
}
