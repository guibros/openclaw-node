/**
 * @openclaw-node/memory-context-engine — OpenClaw plugin entry.
 *
 * Registers the memory daemon as the gateway's context engine
 * (plugins.slots.contextEngine = "openclaw-node-memory") and two agent
 * tools. Mirrors the shape OpenViking's plugin uses for the same slot, with
 * the retrieval side delegated to the daemon's :7893 inject server.
 */

import { createMemoryClient } from './memory-client.js';
import { createMemoryContextEngine, ENGINE_ID, ENGINE_VERSION, FRONTEND_TAG } from './context-engine.js';

// OpenClaw's own compactor, for sessions this engine does not archive. The
// host exports it from its plugin SDK; resolved lazily so the package loads
// (and tests run) without the host installed.
async function loadRuntimeCompaction() {
  try {
    const mod = await import('openclaw/plugin-sdk/core');
    return typeof mod?.delegateCompactionToRuntime === 'function' ? mod.delegateCompactionToRuntime : undefined;
  } catch {
    return undefined;
  }
}

function pluginConfig(api) {
  const c = api.pluginConfig;
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

const plugin = {
  id: ENGINE_ID,
  name: 'openclaw-node memory',
  description: 'Context engine backed by the openclaw-node memory daemon (loopback :7893)',
  kind: 'context-engine',

  register(api) {
    const config = pluginConfig(api);
    const logger = api.logger;
    let client;
    try {
      client = createMemoryClient({ injectUrl: config.injectUrl, tokenPath: config.tokenPath, timeoutMs: config.timeoutMs });
    } catch (err) {
      logger.error(`${ENGINE_ID}: not registered — ${err.message}`);
      return;
    }

    let runtimeCompact;
    const compactionReady = loadRuntimeCompaction().then((fn) => { runtimeCompact = fn; });

    if (typeof api.registerContextEngine !== 'function') {
      logger.warn?.(`${ENGINE_ID}: host has no registerContextEngine; only tools are available`);
    } else {
      api.registerContextEngine(ENGINE_ID, () => createMemoryContextEngine({
        client,
        config,
        logger,
        runtimeCompact: (params) => compactionReady.then(() => (runtimeCompact ? runtimeCompact(params) : undefined)),
      }));
      logger.info(`${ENGINE_ID} v${ENGINE_VERSION}: context engine registered (inject ${client.injectUrl})`);
    }

    api.registerTool({
      name: 'memory_recall',
      description:
        'Recall relevant long-term memory (concepts, decisions, related sessions) for a query from the local memory daemon. Use when the conversation needs background the current context does not carry. Accepts @memory directives in the query (e.g. "@memory deep ...").',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to recall memory for' },
        },
        required: ['query'],
      },
      async execute(_toolCallId, params) {
        const res = await client.inject({ prompt: String(params?.query ?? ''), frontend: `${FRONTEND_TAG}:tool` });
        return { content: [{ type: 'text', text: res.block || '(no relevant memory)' }], details: res.analysis };
      },
    }, { name: 'memory_recall' });

    api.registerTool({
      name: 'memory_status',
      description: 'Health of the local memory daemon inject server (reachable, token present).',
      parameters: { type: 'object', properties: {} },
      async execute() {
        try {
          const h = await client.health();
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, injectUrl: client.injectUrl, ...h }) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: false, injectUrl: client.injectUrl, error: err.message }) }] };
        }
      },
    }, { name: 'memory_status' });
  },
};

export default plugin;
