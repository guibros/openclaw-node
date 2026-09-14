/**
 * node-agent.mjs — ask this node about itself.
 *
 * The model is not the source of truth here; the node is. Every question about
 * live state is answered from a tool call against Mission Control's own APIs
 * and this node's memory, and the trace of those calls is returned alongside
 * the answer so the operator can see what the answer was built from.
 *
 * Structure is ported from God's Eye View's `src/data/analystEngine.js`: all
 * query logic lives in pure functions over plain record arrays, and live data
 * arrives through an injected `providers` object. That is what keeps the agent
 * testable with no Mission Control, no NATS and no ollama.
 *
 * @module lib/node-agent
 */

import { mcAuthHeaders } from './mc-session-token.mjs';

export const DEFAULT_MC_URL = process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000';

/** How many tool rounds before the loop gives up on the model converging. */
export const MAX_TOOL_ROUNDS = Number(process.env.NODE_AGENT_MAX_ROUNDS) || 4;

/**
 * Fields a filter may reference, per record kind.
 *
 * GEV's filter drops a record whose field is missing, which is right for five
 * upstream feeds with ragged schemas. Here the records are shaped by us, so a
 * filter naming a field we do not have is a model mistake, not sparse data:
 * `{field:'state', op:'eq', value:'down'}` against a record keyed `status`
 * would quietly return nothing and the model would report an empty fleet.
 * Declaring the fields lets the filter refuse by name instead.
 */
export const FILTERABLE = {
  nodes: ['nodeId', 'status', 'role', 'platform', 'agentStatus', 'currentTask', 'staleSeconds', 'cpuLoadPercent', 'diskPercent'],
  tasks: ['id', 'title', 'status', 'assignee', 'priority', 'created_at', 'node'],
};

/** One filter: {field, op:'gt'|'gte'|'lt'|'lte'|'eq'|'neq'|'contains', value}. */
export function applyFilter(records, filter, allowed = null) {
  const { field, op, value } = filter || {};
  if (!field || !op) return records;
  if (allowed && !allowed.includes(field)) {
    throw new Error(`unknown field "${field}" — filter on one of: ${allowed.join(', ')}`);
  }
  return records.filter((r) => {
    const got = r[field];
    if (got === null || got === undefined) return false;
    switch (op) {
      case 'gt': return Number(got) > Number(value);
      case 'gte': return Number(got) >= Number(value);
      case 'lt': return Number(got) < Number(value);
      case 'lte': return Number(got) <= Number(value);
      case 'eq': {
        if (typeof got === 'boolean' || typeof value === 'boolean') return Boolean(got) === Boolean(value);
        return String(got).toLowerCase() === String(value).toLowerCase();
      }
      case 'neq': return String(got).toLowerCase() !== String(value).toLowerCase();
      case 'contains': return String(got).toLowerCase().includes(String(value).toLowerCase());
      default: throw new Error(`unknown operator "${op}"`);
    }
  });
}

/**
 * One line per node. The raw health blob carries services[], capabilities[],
 * tailscale.peers[] and stats{} — tens of KB across a fleet, most of it
 * irrelevant to "which nodes are down". get_node_health serves the rest on
 * demand, which is the whole point of splitting the two tools.
 */
export function projectFleet(payload) {
  const nodes = (payload?.nodes || []).map((n) => ({
    nodeId: n.nodeId,
    status: n.status,
    role: n.health?.role ?? null,
    platform: n.health?.platform ?? null,
    agentStatus: n.health?.agent?.status ?? null,
    currentTask: n.health?.agent?.currentTask ?? null,
    staleSeconds: n.staleSeconds ?? null,
    cpuLoadPercent: n.cpuLoadPercent ?? null,
    diskPercent: n.health?.diskPercent ?? null,
    activeTaskCount: (n.activeTasks || []).length,
  }));
  return { nodes, mesh: payload?.meshStatus ?? null };
}

/** The fuller picture for one node, still without the peer-by-peer tailscale dump. */
export function projectNodeHealth(payload, nodeId) {
  const want = String(nodeId || '').toLowerCase();
  const node = (payload?.nodes || []).find((n) => String(n.nodeId).toLowerCase() === want);
  if (!node) {
    const known = (payload?.nodes || []).map((n) => n.nodeId);
    throw new Error(`no node "${nodeId}" in the mesh — known nodes: ${known.join(', ') || '(none)'}`);
  }
  const h = node.health;
  if (!h) return { nodeId: node.nodeId, status: node.status, health: null, staleSeconds: node.staleSeconds ?? null };
  return {
    nodeId: node.nodeId,
    status: node.status,
    staleSeconds: node.staleSeconds ?? null,
    platform: h.platform, role: h.role,
    diskPercent: h.diskPercent,
    memFreeMb: h.mem ? Math.round(h.mem.free / 1048576) : null,
    memTotalMb: h.mem ? Math.round(h.mem.total / 1048576) : null,
    uptimeSeconds: h.uptimeSeconds,
    cpuLoadPercent: h.cpuLoadPercent ?? null,
    services: (h.services || []).map((s) => ({ name: s.name, status: s.status })),
    agent: h.agent ?? null,
    capabilities: h.capabilities ?? [],
    stats: h.stats ?? null,
    nats: h.nats ? { connected: h.nats.connected, isHost: h.nats.isHost } : null,
    peerConnectivity: node.peerConnectivity ?? null,
    deployVersion: h.deployVersion ?? null,
    reportedAt: h.reportedAt ?? null,
  };
}

export function projectTasks(payload) {
  return (payload?.tasks || []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assignee ?? t.claimed_by ?? null,
    node: t.node ?? null,
    priority: t.priority ?? 0,
    created_at: t.created_at ?? null,
  }));
}

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_fleet_state',
      description: 'Current state of every node in the mesh: status (online/degraded/offline), role, agent status, staleness, cpu and disk. Call this before answering anything about which nodes exist or how they are doing.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Optional: keep only nodes with this status (online, degraded, offline).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_node_health',
      description: 'Detailed health for one named node: disk, memory, uptime, running services, agent state, NATS role, deploy version. Use after get_fleet_state when one node needs explaining.',
      parameters: {
        type: 'object',
        properties: { nodeId: { type: 'string', description: 'The node id exactly as get_fleet_state reported it.' } },
        required: ['nodeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_tasks',
      description: 'Mesh tasks with an optional filter. Call this before answering anything about what work is queued, running or stuck.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', description: `One of: ${FILTERABLE.tasks.join(', ')}` },
          op: { type: 'string', description: 'eq, neq, contains, gt, gte, lt, lte' },
          value: { type: 'string', description: 'Value to compare against.' },
          limit: { type: 'number', description: 'Maximum rows to return (default 20).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: "This node's own memory: concepts, decisions and snippets relevant to a phrase. Use for anything about past work, decisions or history rather than current state.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to recall — a phrase, not a keyword.' },
        },
        required: ['query'],
      },
    },
  },
];

export const SYSTEM_PROMPT = [
  'You answer questions about this OpenClaw node and the mesh it belongs to.',
  '',
  'Call a context tool before answering anything about live state. You have no',
  'reliable knowledge of this fleet from training — node names, task ids and',
  'health numbers must come from a tool result in this conversation.',
  '',
  'If a tool returns nothing, or returns an error, say exactly that. An empty',
  'result is an answer: "no tasks are queued" is useful, an invented task id is',
  'worse than silence. Never fill a gap in a tool result from memory.',
  '',
  'Answer in plain prose, naming the nodes, tasks or numbers the tools gave you.',
].join('\n');

/**
 * Live data sources. Kept separate from the agent so the loop can be driven in
 * a test with no Mission Control, no NATS and no ollama.
 */
export function createDefaultProviders(opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_MC_URL).replace(/\/+$/, '');
  const doFetch = opts.fetch || fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function mcGet(pathname) {
    const res = await doFetch(`${baseUrl}${pathname}`, {
      headers: mcAuthHeaders(opts),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Mission Control ${pathname} returned ${res.status}`);
    return res.json();
  }

  return {
    getFleet: () => mcGet('/api/mesh/nodes'),
    getTasks: () => mcGet('/api/mesh/tasks'),
    recall: async (query) => {
      if (!opts.injector) return { concepts: [], decisions: [], snippets: [], unavailable: 'no memory injector configured' };
      return opts.injector.retrieve(query);
    },
  };
}

/**
 * @param {object} deps
 * @param {{generate: Function}} deps.client — an llm-client (6.1)
 * @param {{getFleet: Function, getTasks: Function, recall: Function}} deps.providers
 */
export function createNodeAgent({ client, providers, maxRounds = MAX_TOOL_ROUNDS, tools = TOOLS, systemPrompt = SYSTEM_PROMPT }) {
  async function runTool(name, args = {}) {
    switch (name) {
      case 'get_fleet_state': {
        const projected = projectFleet(await providers.getFleet());
        if (!args.status) return projected;
        return { ...projected, nodes: applyFilter(projected.nodes, { field: 'status', op: 'eq', value: args.status }, FILTERABLE.nodes) };
      }
      case 'get_node_health':
        return projectNodeHealth(await providers.getFleet(), args.nodeId);
      case 'query_tasks': {
        let rows = projectTasks(await providers.getTasks());
        if (args.field) rows = applyFilter(rows, { field: args.field, op: args.op || 'eq', value: args.value }, FILTERABLE.tasks);
        return { count: rows.length, tasks: rows.slice(0, args.limit ?? 20) };
      }
      case 'recall_memory':
        return providers.recall(args.query);
      default:
        throw new Error(`unknown tool "${name}" — available: ${tools.map((t) => t.function.name).join(', ')}`);
    }
  }

  /**
   * A failing tool goes back to the model as a tool result, not as a thrown
   * error: "unknown field X, filter on one of …" is something it can correct
   * on the next round, and a crashed request tells the operator nothing.
   */
  async function askOnce(messages, trace) {
    const reply = await client.generate(messages, { tools });
    if (!reply.toolCalls?.length) return reply;
    messages.push({ role: 'assistant', content: reply.content || '', tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) });
    for (const call of reply.toolCalls) {
      const started = Date.now();
      let result, error = null;
      try {
        result = await runTool(call.name, call.arguments);
      } catch (err) {
        error = err.message;
        result = { error: err.message };
      }
      trace.push({ tool: call.name, args: call.arguments, ms: Date.now() - started, error });
      messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content: JSON.stringify(result) });
    }
    return null;
  }

  async function ask(question) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ];
    const trace = [];
    for (let round = 0; round < maxRounds; round++) {
      const reply = await askOnce(messages, trace);
      if (reply) return { answer: reply.content, trace, rounds: round + 1, usage: reply.usage ?? null };
    }
    return {
      answer: null,
      trace,
      rounds: maxRounds,
      error: `stopped after ${maxRounds} tool rounds without an answer`,
    };
  }

  return { ask, runTool };
}
