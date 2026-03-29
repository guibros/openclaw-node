import { connect, NatsConnection, StringCodec, type KV } from "nats";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Singleton state (globalThis survives Next.js hot-reload) ─────────────
// In dev mode, Turbopack re-evaluates modules on change, wiping module-level
// variables. Using globalThis keeps the NATS connection alive across reloads.

interface NatsGlobals {
  __nats_nc?: NatsConnection | null;
  __nats_connectingSince?: number | null;
  __nats_healthKv?: KV | null;
  __nats_collabKv?: KV | null;
  __nats_tasksKv?: KV | null;
}

const g = globalThis as unknown as NatsGlobals;

const sc = StringCodec();

const CONNECT_TIMEOUT_MS = 10_000;
const NATS_FALLBACK = "nats://127.0.0.1:4222";

/**
 * Resolve NATS URL using the same 3-step chain as mesh.js and agent.js:
 *   1. $OPENCLAW_NATS env var (set by launchd/systemd service definitions)
 *   2. ~/.openclaw/openclaw.env file (user-editable, persists across sessions)
 *   3. Hardcoded IP fallback (not hostname — MagicDNS is unreliable)
 */
function resolveNatsUrl(): string {
  if (process.env.OPENCLAW_NATS) return process.env.OPENCLAW_NATS;
  try {
    const envFile = join(homedir(), ".openclaw", "openclaw.env");
    if (existsSync(envFile)) {
      const content = readFileSync(envFile, "utf8");
      const match = content.match(/^\s*OPENCLAW_NATS\s*=\s*(.+)/m);
      if (match && match[1].trim()) return match[1].trim();
    }
  } catch {
    // File unreadable — fall through
  }
  return NATS_FALLBACK;
}

const NATS_URL = resolveNatsUrl();

// KV bucket name — nodes write here, MC reads
const HEALTH_BUCKET = "MESH_NODE_HEALTH";
const TASKS_BUCKET = "MESH_TASKS";

/**
 * Get or create a singleton NATS connection.
 * Returns null if NATS is unreachable — MC degrades gracefully.
 */
export async function getNats(): Promise<NatsConnection | null> {
  if (g.__nats_nc && !g.__nats_nc.isClosed()) return g.__nats_nc;

  // Reset stale guard (self-heal if previous attempt hung)
  if (g.__nats_connectingSince && Date.now() - g.__nats_connectingSince > CONNECT_TIMEOUT_MS) {
    console.warn("[nats] connecting guard stale, resetting");
    g.__nats_connectingSince = null;
  }
  if (g.__nats_connectingSince) return null;

  g.__nats_connectingSince = Date.now();
  try {
    g.__nats_nc = await connect({
      servers: NATS_URL,
      name: "mission-control",
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
      reconnectJitter: 1000,
      timeout: 5000,
    });
    console.log("[nats] connected to", NATS_URL);

    // Reset KV handles on reconnect so they're re-fetched fresh
    g.__nats_healthKv = null;
    g.__nats_collabKv = null;
    g.__nats_tasksKv = null;

    g.__nats_nc.closed().then(() => {
      console.log("[nats] connection closed — will reconnect on next request");
      g.__nats_nc = null;
      g.__nats_healthKv = null;
      g.__nats_collabKv = null;
      g.__nats_tasksKv = null;
    }).catch(() => {
      g.__nats_nc = null;
      g.__nats_healthKv = null;
      g.__nats_collabKv = null;
      g.__nats_tasksKv = null;
    });

    return g.__nats_nc;
  } catch (err) {
    console.error("[nats] connection failed:", (err as Error).message);
    g.__nats_nc = null;
    return null;
  } finally {
    g.__nats_connectingSince = null;
  }
}

/**
 * Get the MESH_NODE_HEALTH KV bucket (JetStream).
 *
 * Nodes write their health to keys like "moltymac" or "calos" every 15s.
 * MC reads from here — no synchronous round-trip, no timeout races.
 *
 * Creates the bucket on first call if it doesn't exist (idempotent).
 * Returns null if NATS is unavailable.
 */
export async function getHealthKv(): Promise<KV | null> {
  if (g.__nats_healthKv) return g.__nats_healthKv;

  const conn = await getNats();
  if (!conn) return null;

  try {
    const js = conn.jetstream();
    g.__nats_healthKv = await js.views.kv(HEALTH_BUCKET, {
      history: 1,
      ttl: 120_000,
    });
    return g.__nats_healthKv;
  } catch (err) {
    console.error("[nats] KV bucket error:", (err as Error).message);
    return null;
  }
}

// KV bucket for collab sessions — daemon writes, MC reads
const COLLAB_BUCKET = "MESH_COLLAB";

/**
 * Get the MESH_COLLAB KV bucket (JetStream).
 *
 * Collab sessions are written by mesh-collab-daemon, MC reads only.
 * No TTL — sessions are managed by daemon lifecycle, not expiry.
 * Returns null if NATS is unavailable.
 */
export async function getCollabKv(): Promise<KV | null> {
  if (g.__nats_collabKv) return g.__nats_collabKv;

  const conn = await getNats();
  if (!conn) return null;

  try {
    const js = conn.jetstream();
    g.__nats_collabKv = await js.views.kv(COLLAB_BUCKET, {
      history: 1,
    });
    return g.__nats_collabKv;
  } catch (err) {
    console.error("[nats] Collab KV bucket error:", (err as Error).message);
    return null;
  }
}

/**
 * Get the MESH_TASKS KV bucket (JetStream).
 *
 * Tasks are coordinated through this bucket — the lead writes,
 * workers read via watch. On worker nodes, this enables the
 * Kanban to display mesh tasks in real-time.
 *
 * Creates the bucket on first call if it doesn't exist (idempotent).
 * Returns null if NATS is unavailable.
 */
export async function getTasksKv(): Promise<KV | null> {
  if (g.__nats_tasksKv) return g.__nats_tasksKv;

  const conn = await getNats();
  if (!conn) return null;

  try {
    const js = conn.jetstream();
    g.__nats_tasksKv = await js.views.kv(TASKS_BUCKET, {
      history: 1,
    });
    return g.__nats_tasksKv;
  } catch (err) {
    console.error("[nats] Tasks KV bucket error:", (err as Error).message);
    return null;
  }
}

export { sc, StringCodec };
