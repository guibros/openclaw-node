/**
 * lib/node-acceptance.mjs — Deployment acceptance gate for an OpenClaw node.
 *
 * Implements the layered gate from docs/NODE_ACCEPTANCE.md. A node is ACCEPTED
 * only when every required check in its profile is PASS with captured evidence.
 * Any FAIL/BLOCK => REJECTED; a required SKIP or an expected-but-empty layer =>
 * INCOMPLETE — never a false ACCEPTED. This is MASTER_PLAN §5 (runtime evidence)
 * applied to a whole node, and the no-fake-pass rule of PROTOCOL §7.
 *
 * Portable: all paths/URLs/ports resolve from env with sensible defaults
 * (resolveNodeConfig), so the same binary self-tests any node — including
 * spawn-node trees via OPENCLAW_HOME. L1 liveness delegates to health-check.mjs;
 * L0/L2/L4 hard-tests live in node-acceptance-probes.mjs.
 */

import os from 'node:os';
import path from 'node:path';
import { runHealthCheck } from './health-check.mjs';

export const VERDICT = Object.freeze({
  PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP', NA: 'N/A', BLOCK: 'BLOCK',
});

/** Layers each profile is expected to cover. An expected-but-empty layer => INCOMPLETE. */
export const PROFILE_LAYERS = Object.freeze({
  'single-node': ['L0', 'L1', 'L2', 'L4'],
  'federated': ['L0', 'L1', 'L2', 'L3', 'L4'],
});

const LAYER_TITLES = Object.freeze({
  L0: 'Presence', L1: 'Liveness', L2: 'Functional', L3: 'Inter-node', L4: 'End-to-end',
});

const DEFAULT_PROBE_TIMEOUT_MS = 30000;

/**
 * Resolve the node's filesystem/network configuration, env-overridable.
 * Mirrors the same env vars the deployed components read, so the harness
 * always targets the node it runs on.
 */
export function resolveNodeConfig(env = process.env) {
  const home = env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
  const workspace = env.OPENCLAW_WORKSPACE || path.join(home, 'workspace');
  return {
    home,
    workspace,
    nodeId: env.OPENCLAW_NODE_ID || os.hostname(),
    stateDb: env.OPENCLAW_STATE_DB || path.join(home, 'state.db'),
    knowledgeDb: env.KNOWLEDGE_DB || path.join(workspace, '.knowledge.db'),
    graphCacheDb: env.GRAPH_CACHE_DB_PATH || path.join(home, 'graph-cache.db'),
    injectToken: path.join(home, 'config', 'memory-injection-token'),
    injectHost: '127.0.0.1',
    injectPort: Number(env.MEMORY_INJECT_PORT) || 7893,
    llmBaseUrl: env.LLM_BASE_URL || 'http://localhost:11434',
    llmModel: env.LLM_MODEL || 'qwen3:8b',
    natsMonitorUrl: env.NATS_MONITOR_URL || 'http://localhost:8222',
    embedDim: 1024,
    genBudgetMs: Number(env.ACCEPT_GEN_BUDGET_MS) || 30000,
    roundtripPollMs: Number(env.ACCEPT_ROUNDTRIP_POLL_MS) || 60000,
    daemonBin: path.join(workspace, 'bin', 'memory-daemon.mjs'),
    workspaceLib: path.join(workspace, 'lib'),
    transcriptSources: path.join(home, 'config', 'transcript-sources.json'),
  };
}

// The six health-check components mapped to L1 acceptance checks.
const L1_FROM_HEALTH = Object.freeze([
  { component: 'daemon',             id: 'MEM-L1-1', axis: 'memory',  required: true },
  { component: 'nats',               id: 'NET-L1-2', axis: 'network', required: true },
  { component: 'ollama',             id: 'LLM-L1-1', axis: 'llm',     required: true },
  { component: 'embedder',           id: 'LLM-L1-3', axis: 'llm',     required: true },
  { component: 'sqlite',             id: 'MEM-L1-3', axis: 'storage', required: true },
  { component: 'workspace_writable', id: 'STO-L1-1', axis: 'storage', required: true },
]);

function healthToChecks(hc) {
  return L1_FROM_HEALTH.map(({ component, id, axis, required }) => {
    const c = hc[component] || { ok: false, detail: 'no result', latency_ms: 0 };
    return {
      id, layer: 'L1', axis, required,
      status: c.ok ? VERDICT.PASS : VERDICT.FAIL,
      threshold: 'process/endpoint reachable',
      detail: `${component}: ${c.detail}`,
      evidence: c.detail,
      latency_ms: c.latency_ms ?? 0,
    };
  });
}

function naRow() {
  return {
    id: 'NODE-*', layer: 'L3', axis: 'internode', required: false,
    status: VERDICT.NA, threshold: 'n/a',
    detail: 'inter-node deferred this round (federation absent in runtime — docs/NODE_ACCEPTANCE.md §8)',
    evidence: '', latency_ms: 0,
  };
}

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/** Run one probe descriptor into a result row. Throw/timeout => BLOCK (never PASS). */
async function runOneProbe(probe, { mutate, deep }) {
  const base = { id: probe.id, layer: probe.layer, axis: probe.axis, required: !!probe.required };
  if (probe.mutate && !mutate) {
    return { ...base, status: VERDICT.SKIP, detail: 'skipped (--no-mutate)', evidence: '', threshold: '', latency_ms: 0 };
  }
  if (probe.deep && !deep) {
    return { ...base, status: VERDICT.SKIP, detail: 'deep-only (pass --deep to run)', evidence: '', threshold: '', latency_ms: 0 };
  }
  const start = performance.now();
  try {
    const r = await withTimeout(Promise.resolve().then(() => probe.run()), probe.timeoutMs || DEFAULT_PROBE_TIMEOUT_MS);
    return {
      ...base, status: r.status, detail: r.detail,
      evidence: r.evidence ?? '', threshold: r.threshold || '',
      latency_ms: Math.round(performance.now() - start),
    };
  } catch (e) {
    return { ...base, status: VERDICT.BLOCK, detail: `probe error: ${e.message}`, evidence: '', threshold: '', latency_ms: Math.round(performance.now() - start) };
  }
}

/**
 * Compute the gate verdict.
 * @returns {{ state:'ACCEPTED'|'REJECTED'|'INCOMPLETE', exitCode:number, ... }}
 */
export function computeGate(results, profile = 'single-node', { axisFilter = null } = {}) {
  const expected = PROFILE_LAYERS[profile] || PROFILE_LAYERS['single-node'];
  const real = results.filter(r => r.status !== VERDICT.NA); // N/A is out of profile

  const hasFail = real.some(r => r.status === VERDICT.FAIL);
  const hasBlock = real.some(r => r.status === VERDICT.BLOCK);
  const requiredHardFail = real.some(r => r.required && (r.status === VERDICT.FAIL || r.status === VERDICT.BLOCK));
  const requiredSkip = real.some(r => r.required && r.status === VERDICT.SKIP);

  const covered = new Set(real.map(r => r.layer));
  const missingLayers = axisFilter ? [] : expected.filter(l => !covered.has(l));

  let state, exitCode;
  if (hasFail || hasBlock) { state = 'REJECTED'; exitCode = 1; }       // any FAIL/BLOCK is disqualifying
  else if (real.length === 0) { state = 'INCOMPLETE'; exitCode = 2; }  // nothing observed can never ACCEPT
  else if (missingLayers.length || requiredSkip) { state = 'INCOMPLETE'; exitCode = 2; }
  else { state = 'ACCEPTED'; exitCode = 0; }

  const counts = {};
  for (const v of Object.values(VERDICT)) counts[v] = results.filter(r => r.status === v).length;

  return { state, exitCode, hasFail, hasBlock, requiredHardFail, requiredSkip, missingLayers, counts };
}

/**
 * Run the acceptance gate against a node.
 * Injectable for tests: opts.healthCheckFn (L1), opts.probes (skip live probe
 * build), opts.ctx (mock runtime), opts.config.
 */
export async function runAcceptance(opts = {}) {
  const profile = opts.profile || 'single-node';
  const axisFilter = opts.axis || null;
  const config = opts.config || resolveNodeConfig();
  const mutate = opts.mutate !== false;
  const deep = !!opts.deep;

  const results = [];

  // L1 liveness — one health-check call shared across the six checks.
  const hc = await (opts.healthCheckFn || runHealthCheck)(opts.checkOpts || {});
  results.push(...healthToChecks(hc));

  // L0/L2/L4 hard-test probes.
  let teardown = [];
  try {
    let probes = opts.probes;
    let ctx = opts.ctx || null;
    if (!probes) {
      const mod = await import('./node-acceptance-probes.mjs');
      if (!ctx) ctx = mod.createRuntimeContext(config, { mutate, deep });
      probes = (opts.buildProbesFn || mod.buildProbes)(ctx);
    }
    teardown = ctx?.teardown || [];

    for (const probe of probes) {
      if (axisFilter && probe.axis !== axisFilter) continue;
      results.push(await runOneProbe(probe, { mutate, deep }));
    }
  } finally {
    for (const fn of teardown) { try { await fn(); } catch { /* best-effort cleanup */ } }
  }

  // L3 deferred on single-node — one informational N/A row keeps the report honest.
  if (profile === 'single-node') results.push(naRow());

  const filtered = axisFilter ? results.filter(r => r.axis === axisFilter) : results;
  if (axisFilter && filtered.length === 0) {
    // A typo'd axis must not become an observed-nothing ACCEPT (exit 0).
    const axes = [...new Set(results.map(r => r.axis))].join(', ');
    throw new Error(`unknown axis '${axisFilter}' — no checks match (axes: ${axes})`);
  }
  const gate = computeGate(filtered, profile, { axisFilter });
  return {
    meta: { nodeId: config.nodeId, profile, axisFilter, mutate, deep, timestamp: new Date().toISOString() },
    results: filtered,
    gate,
  };
}

function statusGlyph(s) {
  if (s === VERDICT.PASS) return '#';
  if (s === VERDICT.NA) return '.';
  if (s === VERDICT.SKIP) return '-';
  return '_';
}

/** Human-readable summary table for stdout. */
export function formatTable(report) {
  const { meta, results, gate } = report;
  const expected = PROFILE_LAYERS[meta.profile] || [];
  const lines = [
    `Node Acceptance — node=${meta.nodeId} profile=${meta.profile}`
    + `${meta.axisFilter ? ` axis=${meta.axisFilter}` : ''}${meta.mutate === false ? ' [no-mutate]' : ''}`
    + ` — ${meta.timestamp}`,
  ];
  for (const layer of ['L0', 'L1', 'L2', 'L3', 'L4']) {
    const rows = results.filter(r => r.layer === layer);
    const title = LAYER_TITLES[layer].padEnd(11);
    if (!rows.length) {
      if (!meta.axisFilter && expected.includes(layer)) {
        lines.push(`  ${layer} ${title}  —  not yet implemented (INCOMPLETE)`);
      }
      continue;
    }
    if (rows.every(r => r.status === VERDICT.NA)) {
      lines.push(`  ${layer} ${title}  —  N/A (${rows[0].detail})`);
      continue;
    }
    const pass = rows.filter(r => r.status === VERDICT.PASS).length;
    const tally = rows.map(r => statusGlyph(r.status)).join('');
    lines.push(`  ${layer} ${title} ${tally}  ${pass}/${rows.length}`);
    for (const r of rows) {
      lines.push(`     ${r.status.padEnd(5)} ${r.id.padEnd(16)} ${r.detail}`);
    }
  }
  lines.push(`GATE: ${gate.state}`
    + (gate.missingLayers.length ? ` — missing layers: ${gate.missingLayers.join(',')}` : ''));
  return lines.join('\n');
}

function esc(s) { return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }

/** Markdown report — the captured §5 runtime-evidence artifact for a deploy. */
export function formatReport(report) {
  const { meta, results, gate } = report;
  const lines = [
    `# Node Acceptance Report`, ``,
    `**Node:** ${meta.nodeId}`,
    `**Profile:** ${meta.profile}${meta.axisFilter ? ` (axis=${meta.axisFilter})` : ''}${meta.mutate === false ? ' [no-mutate]' : ''}`,
    `**Checked:** ${meta.timestamp}`,
    `**Gate:** ${gate.state}`
      + (gate.missingLayers.length ? ` (missing layers: ${gate.missingLayers.join(', ')})` : ''),
    ``,
    `| Check | Layer | Axis | Status | Req | Detail | Evidence | Latency |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.layer} | ${r.axis} | ${r.status} | ${r.required ? 'yes' : 'no'}`
      + ` | ${esc(r.detail)} | ${esc(String(r.evidence ?? ''))} | ${r.latency_ms}ms |`);
  }
  lines.push('', `Counts: ` + Object.entries(gate.counts)
    .filter(([, n]) => n).map(([k, n]) => `${k}=${n}`).join(' '), '');
  return lines.join('\n');
}
