import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyFilter, projectFleet, projectNodeHealth, projectTasks,
  createNodeAgent, createDefaultProviders, TOOLS, FILTERABLE,
} from '../lib/node-agent.mjs';
import { createLlmClient } from '../lib/llm-client.mjs';

// A recorded /api/mesh/nodes payload: one healthy node, one offline with a
// stale report, shaped like the route's MeshNode/NodeHealth interfaces.
const FLEET = {
  nodes: [
    {
      nodeId: 'moltbook', status: 'online', staleSeconds: 3, cpuLoadPercent: 12,
      peerConnectivity: 'all_direct',
      activeTasks: [{ id: 'T-1', title: 'index', status: 'running', meshTaskId: 'm1' }],
      health: {
        platform: 'darwin', role: 'lead', diskPercent: 41,
        mem: { total: 34359738368, free: 8589934592 }, uptimeSeconds: 90000,
        cpuLoadPercent: 12, deployVersion: 'v7.8', reportedAt: '2026-09-14T20:00:00Z',
        services: [{ name: 'memory-daemon', status: 'running', pid: 42 }, { name: 'nats', status: 'running', pid: 43 }],
        agent: { status: 'idle', currentTask: null, llm: 'ollama', model: 'qwen3:8b' },
        capabilities: ['extraction', 'mesh'],
        stats: { tasksToday: 4, successRate: 1, tokenSpendTodayUsd: 0 },
        tailscale: { selfIp: '100.1.1.1', natType: 'easy', peers: Array.from({ length: 12 }, (_, i) => ({ nodeId: `p${i}`, ip: `100.1.1.${i}`, online: true, latencyMs: 9, relay: false })) },
        nats: { serverUrl: 'nats://127.0.0.1:4222', connected: true, serverVersion: '2.10.22', isHost: true },
      },
    },
    {
      nodeId: 'studio', status: 'offline', staleSeconds: 940, cpuLoadPercent: null,
      peerConnectivity: 'unknown', activeTasks: [],
      health: {
        platform: 'darwin', role: 'worker', diskPercent: 88,
        mem: { total: 17179869184, free: 1073741824 }, uptimeSeconds: 12,
        services: [{ name: 'mesh-agent', status: 'stopped' }],
        agent: { status: 'offline', currentTask: null, llm: null, model: null },
        capabilities: [], stats: { tasksToday: 0, successRate: 0, tokenSpendTodayUsd: 0 },
        nats: { serverUrl: 'nats://127.0.0.1:4222', connected: false, serverVersion: '', isHost: false },
      },
    },
  ],
  tokenStats: {},
  meshStatus: { natsConnected: true, natsUrl: 'nats://127.0.0.1:4222', localNodeId: 'moltbook', nodesOnline: 1, nodesTotal: 2 },
};

const TASKS = {
  natsAvailable: true,
  tasks: [
    { id: 'T-1', title: 'index the vault', status: 'running', assignee: 'moltbook', priority: 5, created_at: '2026-09-14T18:00:00Z' },
    { id: 'T-2', title: 'rotate logs', status: 'queued', priority: 1, created_at: '2026-09-14T19:00:00Z' },
    { id: 'T-3', title: 'index the archive', status: 'failed', claimed_by: 'studio', priority: 3, created_at: '2026-09-13T10:00:00Z' },
  ],
};

const stubProviders = (over = {}) => ({
  getFleet: async () => FLEET,
  getTasks: async () => TASKS,
  recall: async () => ({ concepts: [], decisions: [], snippets: [] }),
  ...over,
});

describe('applyFilter — the pure half, ported from GEV analystEngine', () => {
  const rows = [
    { id: 'a', status: 'online', load: 12, host: true },
    { id: 'b', status: 'OFFLINE', load: 90, host: false },
    { id: 'c', load: 50, host: false },
  ];
  it('compares numbers numerically, not as strings', () => {
    assert.deepEqual(applyFilter(rows, { field: 'load', op: 'gt', value: 9 }).map(r => r.id), ['a', 'b', 'c']);
    assert.deepEqual(applyFilter(rows, { field: 'load', op: 'lte', value: 50 }).map(r => r.id), ['a', 'c']);
  });
  it('text compares case-insensitively, both eq and contains', () => {
    assert.deepEqual(applyFilter(rows, { field: 'status', op: 'eq', value: 'offline' }).map(r => r.id), ['b']);
    assert.deepEqual(applyFilter(rows, { field: 'status', op: 'contains', value: 'LINE' }).map(r => r.id), ['a', 'b']);
  });
  it('eq on a boolean compares as a boolean, not as "true"', () => {
    assert.deepEqual(applyFilter(rows, { field: 'host', op: 'eq', value: true }).map(r => r.id), ['a']);
    assert.deepEqual(applyFilter(rows, { field: 'host', op: 'eq', value: false }).map(r => r.id), ['b', 'c']);
  });
  it('a record missing the field drops out rather than matching', () => {
    assert.deepEqual(applyFilter(rows, { field: 'status', op: 'neq', value: 'online' }).map(r => r.id), ['b']);
  });
  it('no filter is not an empty filter', () => {
    assert.equal(applyFilter(rows, undefined).length, 3);
    assert.equal(applyFilter(rows, { field: 'status' }).length, 3);
  });
  it('refuses a field the record kind does not have, by name', () => {
    assert.throws(
      () => applyFilter(rows, { field: 'state', op: 'eq', value: 'down' }, FILTERABLE.nodes),
      /unknown field "state".*nodeId, status/s,
    );
  });
  it('refuses an operator it does not implement', () => {
    assert.throws(() => applyFilter(rows, { field: 'load', op: 'between', value: 1 }), /unknown operator "between"/);
  });
});

describe('projections — what the model is allowed to see', () => {
  it('the fleet summary keeps the verdict and drops the bulk', () => {
    const out = projectFleet(FLEET);
    assert.deepEqual(out.nodes.map(n => [n.nodeId, n.status, n.staleSeconds]), [
      ['moltbook', 'online', 3], ['studio', 'offline', 940],
    ]);
    assert.equal(out.nodes[0].activeTaskCount, 1);
    assert.equal(out.mesh.nodesOnline, 1);
    // The 12 tailscale peers and the services list are the heavy parts;
    // get_node_health serves them, which is why the tools are split.
    const json = JSON.stringify(out);
    assert.ok(!json.includes('tailscale'), 'peer dump leaked into the fleet summary');
    assert.ok(!json.includes('memory-daemon'), 'service list leaked into the fleet summary');
    assert.ok(json.length < 1200, `fleet summary is ${json.length} bytes`);
  });

  it('node health names what is wrong with the one node asked about', () => {
    const h = projectNodeHealth(FLEET, 'studio');
    assert.equal(h.diskPercent, 88);
    assert.deepEqual(h.services, [{ name: 'mesh-agent', status: 'stopped' }]);
    assert.equal(h.nats.connected, false);
    assert.equal(h.memFreeMb, 1024);
  });

  it('matches a node id case-insensitively, and names the real ones when it cannot', () => {
    assert.equal(projectNodeHealth(FLEET, 'MoltBook').nodeId, 'moltbook');
    assert.throws(() => projectNodeHealth(FLEET, 'laptop'), /no node "laptop".*moltbook, studio/s);
  });

  it('tasks read assignee from either field the KV entries use', () => {
    const rows = projectTasks(TASKS);
    assert.deepEqual(rows.map(r => [r.id, r.assignee]), [['T-1', 'moltbook'], ['T-2', null], ['T-3', 'studio']]);
  });
});

describe('tool dispatch', () => {
  const agent = () => createNodeAgent({ client: { generate: async () => ({}) }, providers: stubProviders() });

  it('get_fleet_state filters by status when asked', async () => {
    const out = await agent().runTool('get_fleet_state', { status: 'offline' });
    assert.deepEqual(out.nodes.map(n => n.nodeId), ['studio']);
    assert.equal(out.mesh.nodesTotal, 2, 'the mesh summary survives the filter');
  });

  it('query_tasks filters and caps', async () => {
    const out = await agent().runTool('query_tasks', { field: 'title', op: 'contains', value: 'index' });
    assert.deepEqual(out.tasks.map(t => t.id), ['T-1', 'T-3']);
    assert.equal(out.count, 2);
    assert.equal((await agent().runTool('query_tasks', { limit: 1 })).tasks.length, 1);
  });

  it('an unknown tool name says what does exist', async () => {
    await assert.rejects(() => agent().runTool('get_weather'), /unknown tool "get_weather".*get_fleet_state/s);
  });

  it('every advertised tool name is dispatchable', async () => {
    for (const t of TOOLS) {
      const args = { get_node_health: { nodeId: 'moltbook' }, recall_memory: { query: 'x' } }[t.function.name] || {};
      await agent().runTool(t.function.name, args);
    }
  });
});

describe('the loop — a tool call must precede the answer', () => {
  let modelServer, modelUrl, seen;

  before(async () => {
    // A real HTTP server speaking Ollama's native /api/chat shape: round one
    // asks for the fleet, round two answers. The loop's own behaviour is what
    // is under test — whether qwen3 picks this tool unprompted is the operator
    // probe 6.1 recorded.
    modelServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        seen.push(body);
        const alreadyCalled = body.messages.some((m) => m.role === 'tool');
        const message = alreadyCalled
          ? { content: (() => {
              const toolMsg = body.messages.find((m) => m.role === 'tool');
              const fleet = JSON.parse(toolMsg.content);
              const down = fleet.nodes.filter((n) => n.status !== 'online').map((n) => n.nodeId);
              return down.length ? `${down.join(', ')} is not online.` : 'Every node is online.';
            })() }
          : { content: '', tool_calls: [{ function: { name: 'get_fleet_state', arguments: {} } }] };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message, done_reason: 'stop', prompt_eval_count: 10, eval_count: 5 }));
      });
    });
    await new Promise((r) => modelServer.listen(0, '127.0.0.1', r));
    modelUrl = `http://127.0.0.1:${modelServer.address().port}`;
  });

  after(async () => { await new Promise((r) => modelServer.close(r)); });

  it('calls get_fleet_state, then answers naming the node that is actually down', async () => {
    seen = [];
    const client = createLlmClient({ baseUrl: modelUrl });
    const agent = createNodeAgent({ client: { generate: (m, o) => client.generate(m, { ...o, bypassQueue: true }) }, providers: stubProviders() });

    const out = await agent.ask('which nodes are down');

    assert.deepEqual(out.trace.map(t => t.tool), ['get_fleet_state']);
    assert.equal(out.trace[0].error, null);
    assert.equal(out.rounds, 2);
    assert.match(out.answer, /studio/);
    assert.doesNotMatch(out.answer, /moltbook/, 'named a node that is online');

    // The order is the claim: the tool result reached the model before the answer.
    assert.equal(seen.length, 2);
    assert.equal(seen[0].messages.some(m => m.role === 'tool'), false);
    const toolMsg = seen[1].messages.find(m => m.role === 'tool');
    assert.equal(toolMsg.name, 'get_fleet_state');
    assert.ok(JSON.parse(toolMsg.content).nodes.length === 2);
    // The tools were actually advertised to the model, not just held locally.
    assert.deepEqual(seen[0].tools.map(t => t.function.name), TOOLS.map(t => t.function.name));
  });

  it('a failing tool comes back as a correctable tool result, not a crash', async () => {
    seen = [];
    const client = { generate: async (messages) => (
      messages.some(m => m.role === 'tool')
        ? { content: 'The mesh has no field called state.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'c1', name: 'query_tasks', arguments: { field: 'state', op: 'eq', value: 'down' } }] }
    ) };
    const agent = createNodeAgent({ client, providers: stubProviders() });
    const out = await agent.ask('which tasks are in state down');
    assert.match(out.trace[0].error, /unknown field "state"/);
    assert.match(out.answer, /no field called state/);
  });

  it('stops instead of looping forever when the model never answers', async () => {
    const client = { generate: async () => ({ content: '', toolCalls: [{ id: 'x', name: 'get_fleet_state', arguments: {} }] }) };
    const agent = createNodeAgent({ client, providers: stubProviders(), maxRounds: 3 });
    const out = await agent.ask('hello');
    assert.equal(out.answer, null);
    assert.match(out.error, /stopped after 3 tool rounds/);
    assert.equal(out.trace.length, 3);
  });
});

describe('default providers', () => {
  it('sends the session token to Mission Control and reads the two routes', async () => {
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      return { ok: true, json: async () => (url.endsWith('/api/mesh/tasks') ? TASKS : FLEET) };
    };
    // A token file written here rather than committed: a repo file named like a
    // session token is worse hygiene than four lines of setup.
    const tokenPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'node-agent-')), 'mc-session-token');
    fs.writeFileSync(tokenPath, 'test-token-value\n');
    const providers = createDefaultProviders({ baseUrl: 'http://127.0.0.1:3000/', fetch: fakeFetch, tokenPath });
    assert.equal((await providers.getFleet()).nodes.length, 2);
    assert.equal((await providers.getTasks()).tasks.length, 3);
    assert.deepEqual(calls.map(c => c.url), ['http://127.0.0.1:3000/api/mesh/nodes', 'http://127.0.0.1:3000/api/mesh/tasks']);
    assert.equal(calls[0].auth, 'Bearer test-token-value');
  });

  it('surfaces a Mission Control error instead of returning an empty fleet', async () => {
    const providers = createDefaultProviders({ fetch: async () => ({ ok: false, status: 401 }) });
    await assert.rejects(() => providers.getFleet(), /\/api\/mesh\/nodes returned 401/);
  });

  it('says memory is unavailable rather than pretending it is empty', async () => {
    const providers = createDefaultProviders({ fetch: async () => ({ ok: true, json: async () => ({}) }) });
    assert.match((await providers.recall('anything')).unavailable, /no memory injector/);
  });
});
