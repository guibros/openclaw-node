/**
 * mesh-registry.js — NATS KV tool registry for OpenClaw mesh.
 *
 * Shared library for:
 *   - Registering tools in MESH_TOOLS KV bucket
 *   - Heartbeat refresh (keeps tools alive via TTL)
 *   - Calling remote tools via NATS request/reply
 *   - Listing available tools from KV
 *
 * Usage:
 *   const { MeshRegistry } = require('./mesh-registry');
 *   const registry = new MeshRegistry(natsConnection, nodeId);
 *   await registry.register(manifest);
 *   await registry.startHeartbeat();
 *   const result = await registry.call('discord-history', 'readMessages', { channelId: '123' });
 */

const { connect, StringCodec } = require('nats');
const os = require('os');

const sc = StringCodec();
const { NATS_URL, natsConnectOpts } = require('./nats-resolve');
const KV_BUCKET = 'MESH_TOOLS';
const HEARTBEAT_INTERVAL = 60000; // 60s (TTL is 120s — refreshes well before expiry)

class MeshRegistry {
  constructor(nc, nodeId) {
    this.nc = nc;
    this.nodeId = nodeId || os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    this.kv = null;
    this.manifests = new Map(); // toolName -> manifest
    this.handlers = new Map(); // toolName.methodName -> handler function
    this.heartbeatTimer = null;
    this.subscriptions = [];
  }

  async init() {
    const js = this.nc.jetstream();
    this.kv = await js.views.kv(KV_BUCKET);
    return this;
  }

  /**
   * Register a tool manifest and subscribe to its NATS subjects.
   * @param {object} manifest - Tool manifest (name, methods, etc.)
   * @param {object} handlers - Map of methodName -> async function(params)
   */
  async register(manifest, handlers = {}) {
    const toolName = manifest.name;
    const kvKey = `${this.nodeId}.${toolName}`;

    // Store manifest
    const entry = {
      ...manifest,
      node_id: this.nodeId,
      registered_at: new Date().toISOString(),
    };
    this.manifests.set(toolName, entry);

    // Publish to KV
    await this.kv.put(kvKey, sc.encode(JSON.stringify(entry)));

    // Register handlers and subscribe to NATS subjects
    for (const method of (manifest.methods || [])) {
      const handlerKey = `${toolName}.${method.name}`;
      const subject = `mesh.tool.${this.nodeId}.${toolName}.${method.name}`;

      if (handlers[method.name]) {
        this.handlers.set(handlerKey, handlers[method.name]);

        const sub = this.nc.subscribe(subject);
        this.subscriptions.push(sub);

        // Process requests in background
        this._processSubscription(sub, handlerKey);
      }
    }

    return entry;
  }

  async _processSubscription(sub, handlerKey) {
    for await (const msg of sub) {
      try {
        const request = JSON.parse(sc.decode(msg.data));
        const handler = this.handlers.get(handlerKey);

        if (!handler) {
          msg.respond(sc.encode(JSON.stringify({
            error: `No handler for ${handlerKey}`,
          })));
          continue;
        }

        const result = await handler(request.args || request);
        msg.respond(sc.encode(JSON.stringify({ data: result })));
      } catch (err) {
        msg.respond(sc.encode(JSON.stringify({
          error: err.message,
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        })));
      }
    }
  }

  /**
   * Start heartbeat loop — refreshes all manifests in KV every 60s.
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      for (const [toolName, manifest] of this.manifests) {
        const kvKey = `${this.nodeId}.${toolName}`;
        try {
          await this.kv.put(kvKey, sc.encode(JSON.stringify(manifest)));
        } catch (err) {
          console.error(`[mesh-registry] heartbeat failed for ${kvKey}: ${err.message}`);
        }
      }
    }, HEARTBEAT_INTERVAL);
    // Don't block process exit
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  /**
   * Call a remote tool method via NATS request/reply.
   * @param {string} nodeId - Target node
   * @param {string} toolName - Tool name
   * @param {string} methodName - Method name
   * @param {object} args - Arguments
   * @param {number} timeoutMs - Timeout in ms (default 30s)
   */
  async call(nodeId, toolName, methodName, args = {}, timeoutMs = 30000) {
    const subject = `mesh.tool.${nodeId}.${toolName}.${methodName}`;
    const payload = JSON.stringify({ args, caller: this.nodeId });

    const msg = await this.nc.request(subject, sc.encode(payload), { timeout: timeoutMs });
    const response = JSON.parse(sc.decode(msg.data));

    if (response.error) {
      throw new Error(`Remote tool error (${subject}): ${response.error}`);
    }
    return response.data;
  }

  /**
   * List all registered tools from KV bucket.
   * @returns {Array} Array of tool manifests
   */
  async listTools() {
    const tools = [];
    const keys = await this.kv.keys();
    for await (const key of keys) {
      const entry = await this.kv.get(key);
      if (entry && entry.value) {
        tools.push(JSON.parse(sc.decode(entry.value)));
      }
    }
    return tools;
  }

  /**
   * Clean shutdown — purge own KV keys and unsubscribe.
   */
  async shutdown() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Purge own KV entries
    for (const toolName of this.manifests.keys()) {
      const kvKey = `${this.nodeId}.${toolName}`;
      try {
        await this.kv.delete(kvKey);
      } catch (err) {
        // Best effort
      }
    }

    // Unsubscribe
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
  }
}

/**
 * Connect to NATS and create a registry instance.
 */
async function createRegistry(nodeId) {
  const nc = await connect(natsConnectOpts({ timeout: 5000 }));
  const registry = new MeshRegistry(nc, nodeId);
  await registry.init();
  return { nc, registry };
}

module.exports = { MeshRegistry, createRegistry, NATS_URL, KV_BUCKET };
