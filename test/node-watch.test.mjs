#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { WATCH_TARGETS, runWatch, formatHtml, STATUS } from '../lib/node-watch.mjs';
import { resolveNodeConfig } from '../lib/node-acceptance.mjs';

const config = resolveNodeConfig({ OPENCLAW_HOME: '/tmp/acc', OPENCLAW_NODE_ID: 'tn' });

function makeQueryDb(cfg = {}) {
  return (_p, fn) => fn({
    prepare: (sql) => ({
      get: () => {
        if (/integrity_check/i.test(sql)) return { integrity_check: cfg.integrity ?? 'ok' };
        if (/SELECT value/i.test(sql)) return cfg.metaValue !== undefined ? { value: cfg.metaValue } : undefined;
        if (/COUNT\(\*\)/i.test(sql)) return { n: cfg.count ?? 0 };
        if (/MAX\(/i.test(sql)) return { t: cfg.last ?? null };
        return {};
      },
      all: () => [],
    }),
  });
}

function makeCtx(over = {}) {
  const ctx = {
    config, path, teardown: [],
    fsp: {
      stat: async () => ({ mtimeMs: Date.now(), mode: 0o100600 }),
      access: async () => {},
      readFile: async () => '',
      readdir: async () => [],
    },
    queryDb: makeQueryDb(),
    httpGet: async () => ({ status: 200, json: {} }),
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    checkVaultLinks: async () => ({ notes: 3, links: 5, resolved: 5, dangling: [], orphans: [] }),
  };
  return Object.assign(ctx, over);
}

const target = (id) => WATCH_TARGETS.find((t) => t.id === id);
const envFor = (ctx, extra = {}) => ({ ctx, config: ctx.config, hc: {}, probes: {}, includeHeavy: true, ...extra });

describe('node-watch honesty invariants', () => {
  it('a slow target is UNKNOWN (never WORKING) when not probed this cycle', async () => {
    const report = await runWatch({
      ctx: makeCtx(), config,
      healthCheckFn: async () => ({}),
      probes: {},
      includeHeavy: false,
      targets: [target('obs.links')], // slow: true
    });
    assert.equal(report.results[0].status, STATUS.UNKNOWN);
    assert.notEqual(report.results[0].status, STATUS.WORKING);
  });

  it('heavy probe is UNKNOWN (not WORKING) when not probed this cycle', async () => {
    const probes = { 'LLM-L2-GEN': { slow: true, run: async () => ({ status: 'PASS', detail: 'ran' }) } };
    const skipped = await target('llm.local_gen').run(envFor(makeCtx(), { probes, includeHeavy: false }));
    assert.equal(skipped.status, STATUS.UNKNOWN);
    const probed = await target('llm.local_gen').run(envFor(makeCtx(), { probes, includeHeavy: true }));
    assert.equal(probed.status, STATUS.WORKING);
  });

  it('reused acceptance verdicts map PASS→WORKING, FAIL→BROKEN', async () => {
    const ok = { 'MEM-L2-INJECT': { run: async () => ({ status: 'PASS', detail: 'ok' }) } };
    const bad = { 'MEM-L2-INJECT': { run: async () => ({ status: 'FAIL', detail: '401' }) } };
    assert.equal((await target('mem.inject').run(envFor(makeCtx(), { probes: ok }))).status, STATUS.WORKING);
    assert.equal((await target('mem.inject').run(envFor(makeCtx(), { probes: bad }))).status, STATUS.BROKEN);
  });

  it('a missing reused probe is UNKNOWN, never WORKING', async () => {
    const r = await target('net.nats').run(envFor(makeCtx(), { probes: {} }));
    assert.equal(r.status, STATUS.UNKNOWN);
  });
});

describe('node-watch OFF semantics (intentionally not active ≠ broken)', () => {
  it('cloud LLM (via companion-bridge) is OFF when the bridge is not running', async () => {
    const ctx = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('llm.cloud').run(envFor(ctx))).status, STATUS.OFF);
  });

  it('companion-bridge is OFF when not listening (on-demand), not BROKEN', async () => {
    const ctx = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('runtime.bridge').run(envFor(ctx))).status, STATUS.OFF);
  });

  it('federation is OFF when no identity-registry (not deployed)', async () => {
    const ctx = makeCtx({ fsp: { ...makeCtx().fsp, access: async () => { throw new Error('ENOENT'); } } });
    assert.equal((await target('net.federation').run(envFor(ctx))).status, STATUS.OFF);
  });
});

describe('node-watch observed verdicts', () => {
  it('daemon WORKING/BROKEN from health-check', async () => {
    assert.equal((await target('mem.daemon').run(envFor(makeCtx(), { hc: { daemon: { ok: true, detail: 'pid=1' } } }))).status, STATUS.WORKING);
    assert.equal((await target('mem.daemon').run(envFor(makeCtx(), { hc: { daemon: { ok: false, detail: 'down' } } }))).status, STATUS.BROKEN);
  });

  it('state.db integrity ok → WORKING; absent → BROKEN', async () => {
    assert.equal((await target('store.state_db').run(envFor(makeCtx({ queryDb: makeQueryDb({ integrity: 'ok' }) })))).status, STATUS.WORKING);
    const absent = makeCtx({ queryDb: () => { throw new Error('unable to open database file'); } });
    assert.equal((await target('store.state_db').run(envFor(absent))).status, STATUS.BROKEN);
  });

  it('graph cache fresh → WORKING; stale → BROKEN (channel 5 degraded)', async () => {
    const fresh = makeCtx({ queryDb: makeQueryDb({ metaValue: new Date().toISOString() }) });
    assert.equal((await target('obs.graph_cache').run(envFor(fresh))).status, STATUS.WORKING);
    const stale = makeCtx({ queryDb: makeQueryDb({ metaValue: new Date(Date.now() - 5 * 3600_000).toISOString() }) });
    assert.equal((await target('obs.graph_cache').run(envFor(stale))).status, STATUS.BROKEN);
  });

  it('roadmap viewer OFF when not listening, WORKING on 200', async () => {
    const down = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('ops.roadmap').run(envFor(down))).status, STATUS.OFF);
    const up = makeCtx({ httpGet: async () => ({ status: 200 }) });
    assert.equal((await target('ops.roadmap').run(envFor(up))).status, STATUS.WORKING);
  });

  it('cloud LLM via bridge: WORKING when /health reports a served session', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { status: 'ok', companion: 'http://localhost:3457', model: 'm', sessions: [{ lifetimeTurns: 5, zombieRetryCount: 0, contextTrackingHealthy: true }] } }) });
    assert.equal((await target('llm.cloud').run(envFor(ctx))).status, STATUS.WORKING);
  });
  it('cloud LLM via bridge: BROKEN when a session is degraded (zombie retries)', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { status: 'ok', sessions: [{ lifetimeTurns: 2, zombieRetryCount: 2 }] } }) });
    assert.equal((await target('llm.cloud').run(envFor(ctx))).status, STATUS.BROKEN);
  });
  it('cloud LLM via bridge: UNKNOWN when bridge up but no completed turns (no billable probe sent)', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { status: 'ok', sessions: [] } }) });
    assert.equal((await target('llm.cloud').run(envFor(ctx))).status, STATUS.UNKNOWN);
  });

  it('vault links WORKING when no dangling wikilinks', async () => {
    const ctx = makeCtx({ checkVaultLinks: async () => ({ notes: 4, links: 10, resolved: 10, dangling: [] }) });
    assert.equal((await target('obs.links').run(envFor(ctx))).status, STATUS.WORKING);
  });
  it('vault links BROKEN when dangling wikilinks exist', async () => {
    const ctx = makeCtx({ checkVaultLinks: async () => ({ notes: 4, links: 10, resolved: 8, dangling: [{ file: 'a.md', target: 'X' }, { file: 'b.md', target: 'Y' }] }) });
    assert.equal((await target('obs.links').run(envFor(ctx))).status, STATUS.BROKEN);
  });
  it('vault links UNKNOWN when vault has no notes', async () => {
    const ctx = makeCtx({ checkVaultLinks: async () => ({ notes: 0, links: 0, resolved: 0, dangling: [] }) });
    assert.equal((await target('obs.links').run(envFor(ctx))).status, STATUS.UNKNOWN);
  });

  it('calendar OFF when Mission Control is not running', async () => {
    const ctx = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('ops.calendar').run(envFor(ctx))).status, STATUS.OFF);
  });
  it('calendar WORKING when scheduler reachable and nothing overdue', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { scheduled: { at: 2, cron: 1 }, ready: 0, overdue: 0, graceMinutes: 30 } }) });
    assert.equal((await target('ops.calendar').run(envFor(ctx))).status, STATUS.WORKING);
  });
  it('calendar BROKEN when scheduled tasks are overdue (tick not running)', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { scheduled: { at: 3, cron: 0 }, overdue: 2, overdueIds: ['T1', 'T2'], graceMinutes: 30 } }) });
    assert.equal((await target('ops.calendar').run(envFor(ctx))).status, STATUS.BROKEN);
  });
});

describe('node-watch HTML dropdown view', () => {
  const fakeReport = {
    meta: { nodeId: 'tn', mode: 'once', timestamp: '2026-06-15T00:00:00Z' },
    counts: { WORKING: 1, BROKEN: 1, OFF: 1, UNKNOWN: 1 },
    results: [
      { id: 'a', family: 'memory', label: 'Memory daemon', signal: 'alive', status: 'WORKING', detail: 'pid=1', evidence: '', latency_ms: 1 },
      { id: 'b', family: 'memory', label: 'Inject server', signal: '200', status: 'BROKEN', detail: '401', evidence: '', latency_ms: 2 },
      { id: 'c', family: 'llm-cloud', label: 'Cloud LLM', signal: 'reachable', status: 'OFF', detail: 'no key', evidence: '', latency_ms: 0 },
      { id: 'd', family: 'ops', label: 'Calendar', signal: 'tick', status: 'UNKNOWN', detail: 'no probe', evidence: '', latency_ms: 0 },
    ],
  };

  it('renders a dropdown with one option per checked item, showing its result', () => {
    const html = formatHtml(fakeReport);
    assert.ok(html.includes('<select'), 'has a dropdown');
    assert.equal((html.match(/<option /g) || []).length, 4, 'one option per item');
    for (const r of fakeReport.results) {
      assert.ok(html.includes(`${r.status} — ${r.label}`), `option shows "${r.status} — ${r.label}"`);
    }
  });

  it('groups the dropdown by family and embeds the data for the detail panel', () => {
    const html = formatHtml(fakeReport);
    assert.ok(html.includes('<optgroup label="memory">'));
    assert.ok(html.includes('<optgroup label="llm-cloud">'));
    assert.ok(html.includes('<optgroup label="ops">'));
    assert.ok(html.includes('JSON.parse'), 'embeds report data for detail rendering');
    assert.ok(html.includes('<!doctype html>'), 'self-contained page');
  });
});

describe('node-watch runner', () => {
  it('runs all targets, tallies, and drains teardown', async () => {
    const ctx = makeCtx({ httpGet: async () => { throw new Error('bridge down'); }, checkVaultLinks: async () => ({ notes: 0, links: 0, resolved: 0, dangling: [] }) });
    ctx.teardown.push(async () => { ctx._cleaned = true; });
    const report = await runWatch({
      ctx, config,
      healthCheckFn: async () => ({ daemon: { ok: true, detail: 'pid=1' } }),
      probes: {},
      includeHeavy: true,
      targets: [target('mem.daemon'), target('obs.links'), target('llm.cloud')],
    });
    assert.equal(report.results.length, 3);
    assert.equal(report.counts.WORKING, 1);   // daemon (hc.ok)
    assert.equal(report.counts.UNKNOWN, 1);    // obs.links (no probe)
    assert.equal(report.counts.OFF, 1);        // cloud via bridge (bridge down → OFF)
    assert.equal(ctx._cleaned, true);
    // honesty: nothing WORKING beyond what was observed
    assert.ok(report.results.find((r) => r.id === 'obs.links').status !== STATUS.WORKING);
  });
});
