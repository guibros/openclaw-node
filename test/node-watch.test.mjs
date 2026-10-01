#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  WATCH_TARGETS, runWatch, formatHtml, STATUS,
  parseLaunchdPrint, gradeMeshServices, gradeRequiredServices, gradeGateway, probeCoreLaunchdServices,
} from '../lib/node-watch.mjs';
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
  it('launchd parsing distinguishes a running PID from a loaded stopped job', () => {
    assert.deepEqual(
      parseLaunchdPrint({ code: 0, stdout: 'state = running\npid = 56662\nlast exit code = 1\n' }),
      { observable: true, loaded: true, running: true, pid: 56662, state: 'running' },
    );
    assert.deepEqual(
      parseLaunchdPrint({ code: 0, stdout: 'state = not running\nlast exit code = (never exited)\n' }),
      { observable: true, loaded: true, running: false, pid: null, state: 'not running' },
    );
  });

  it('loaded PID-less mesh labels cannot earn WORKING', () => {
    const stopped = [{ label: 'ai.openclaw.mesh-agent', observable: true, loaded: true, running: false, pid: null }];
    assert.equal(gradeMeshServices(stopped).status, STATUS.BROKEN);
    const mixed = [...stopped, { label: 'ai.openclaw.mesh-bridge', observable: true, loaded: true, running: true, pid: 42 }];
    assert.equal(gradeMeshServices(mixed).status, STATUS.BROKEN);
    assert.match(gradeMeshServices(mixed).detail, /no PID/);
    const running = [{ label: 'ai.openclaw.mesh-bridge', observable: true, loaded: true, running: true, pid: 42 }];
    assert.equal(gradeMeshServices(running).status, STATUS.WORKING);
    assert.match(gradeMeshServices(running).detail, /PID evidence/);
  });

  it('required core labels need a running PID, not mere loaded state', () => {
    const running = { label: 'ai.openclaw.nats', observable: true, loaded: true, running: true, pid: 10 };
    assert.equal(gradeRequiredServices([running]).status, STATUS.WORKING);
    assert.equal(gradeRequiredServices([{ ...running, running: false, pid: null }]).status, STATUS.BROKEN);
    assert.equal(gradeRequiredServices([{ ...running, loaded: false, running: false, pid: null }]).status, STATUS.BROKEN);
    assert.equal(gradeRequiredServices([{ ...running, observable: false }]).status, STATUS.UNKNOWN);
  });

  it('reads protected NATS jobs in system and refuses a loaded legacy GUI peer', async () => {
    const calls = [];
    let marker = true;
    let oldLoaded = false;
    let userLoaded = false;
    let systemLoaded = true;
    let heldLoaded = false;
    let markerContent = '{"schema":1,"kind":"openclaw-nats-writer-handoff"}';
    let markerUid = 0;
    const ctx = makeCtx({
      fsp: { lstat: async () => {
        if (!marker) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return { isFile: () => true, isSymbolicLink: () => false, uid: markerUid, mode: 0o100644 };
      }, readFile: async () => markerContent },
      exec: async (_bin, args) => {
        const name = args[1];
        calls.push(name);
        if (name.endsWith('/ai.openclaw.nats-1') && !heldLoaded) {
          return { code: 113, stdout: '', stderr: 'Could not find service' };
        }
        if (name.startsWith('gui/') && name.includes('/ai.openclaw.nats') && !oldLoaded) {
          return { code: 113, stdout: '', stderr: 'Could not find service' };
        }
        if (name.startsWith('user/') && name.includes('/ai.openclaw.nats') && !userLoaded) {
          return { code: 113, stdout: '', stderr: 'Could not find service' };
        }
        if (name.startsWith('system/') && !systemLoaded) {
          return { code: 113, stdout: '', stderr: 'Could not find service' };
        }
        return { code: 0, stdout: 'state = running\npid = 42\n', stderr: '' };
      },
    });
    const protectedVerdict = await probeCoreLaunchdServices(ctx, { platform: 'darwin' });
    assert.equal(protectedVerdict.status, STATUS.WORKING);
    assert.match(protectedVerdict.evidence, /system\/ai\.openclaw\.nats:42/);
    assert.ok(calls.includes('system/ai.openclaw.nats'));
    markerContent = '{broken';
    calls.length = 0;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
    assert.equal(calls.length, 0);
    markerContent = '{"schema":1,"kind":"openclaw-nats-writer-handoff"}';
    markerUid = 501;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
    markerUid = 0;
    oldLoaded = true;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    oldLoaded = false;
    userLoaded = true;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    userLoaded = false;
    heldLoaded = true;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    heldLoaded = false;
    marker = false;
    oldLoaded = true;
    calls.length = 0;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    systemLoaded = false;
    calls.length = 0;
    const legacyVerdict = await probeCoreLaunchdServices(ctx, { platform: 'darwin' });
    assert.equal(legacyVerdict.status, STATUS.WORKING);
    assert.ok(calls.includes(`gui/${process.getuid()}/ai.openclaw.nats`));
    assert.ok(calls.includes(`user/${process.getuid()}/ai.openclaw.nats`));
    assert.ok(calls.includes('system/ai.openclaw.nats'));
  });

  it('does not claim core services healthy when handoff state cannot be read', async () => {
    const ctx = makeCtx({ fsp: { lstat: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } },
      exec: async () => { throw new Error('must not probe jobs'); } });
    const verdict = await probeCoreLaunchdServices(ctx, { platform: 'darwin' });
    assert.equal(verdict.status, STATUS.UNKNOWN);
    assert.match(verdict.detail, /EACCES/);
  });

  it('an old gateway JSONL cannot earn WORKING even when the service has a PID', () => {
    const service = { observable: true, loaded: true, running: true, pid: 77, state: 'running' };
    const verdict = gradeGateway({ service, newestSessionMs: Date.now() - 18 * 24 * 3600_000 });
    assert.equal(verdict.status, STATUS.UNKNOWN);
    assert.match(verdict.detail, /stale/);
    assert.equal(gradeGateway({ service: { ...service, running: false, pid: null }, newestSessionMs: Date.now() }).status, STATUS.BROKEN);
  });

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

  it('a reusing target inherits the reused probe timeoutMs (no 30s default clamp)', async () => {
    // probe declares a 50ms budget and takes 150ms: with inheritance the target
    // times out at 50ms (UNKNOWN "timeout 50ms"); under the old default clamp
    // (30s) it would have completed and reported WORKING.
    const t = target('llm.extraction_task');
    assert.equal(t.reuses, 'LLM-L2-EXTRACT');
    const probes = {
      'LLM-L2-EXTRACT': {
        timeoutMs: 50,
        run: () => new Promise((res) => setTimeout(() => res({ status: 'PASS', detail: 'slow ok' }), 150)),
      },
    };
    const report = await runWatch({
      ctx: makeCtx(), config,
      healthCheckFn: async () => ({}),
      probes, includeHeavy: true,
      targets: [t],
    });
    assert.equal(report.results[0].status, STATUS.UNKNOWN);
    assert.match(report.results[0].detail, /timeout 50ms/);
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

describe('node-watch disabled Discord lifecycle', () => {
  const discord = {
    label: 'ai.openclaw.mesh-tool-discord', observable: true, loaded: true,
    running: false, pid: null, state: 'not running', lastExitCode: 0,
  };
  const peer = {
    label: 'ai.openclaw.mesh-agent', observable: true, loaded: true,
    running: true, pid: 42, state: 'running', lastExitCode: null,
  };

  it('confirmed inactive Discord is explicit OFF alongside observed working peers', () => {
    const r = gradeMeshServices([peer, discord], { discordEnabled: false });
    assert.equal(r.status, STATUS.WORKING);
    assert.match(r.detail, /1\/1.*mesh-tool-discord OFF/);
    assert.match(r.evidence, /mesh-agent:42.*mesh-tool-discord:OFF\(exit0\)/);
  });

  it('an inactive-only node is OFF rather than a working cluster', () => {
    const r = gradeMeshServices([discord], { discordEnabled: false });
    assert.equal(r.status, STATUS.OFF);
    assert.match(r.detail, /explicitly disabled.*exit0/);
  });

  for (const [name, enabled] of [['enabled', true], ['legacy', undefined], ['string false', 'false'], ['null', null], ['zero', 0]]) {
    it(`${name} policy cannot waive a stopped Discord service`, () => {
      assert.equal(gradeMeshServices([peer, discord], { discordEnabled: enabled }).status, STATUS.BROKEN);
    });
  }

  for (const [name, change, expected] of [
    ['failed exit', { lastExitCode: 1 }, STATUS.BROKEN],
    ['signal exit', { lastExitCode: -15 }, STATUS.BROKEN],
    ['no exit observed', { lastExitCode: null }, STATUS.UNKNOWN],
    ['no state observed', { state: null }, STATUS.UNKNOWN],
    ['waiting state', { state: 'waiting' }, STATUS.UNKNOWN],
    ['unobservable state', { observable: false }, STATUS.UNKNOWN],
    ['running contradiction', { running: true, pid: 43, state: 'running' }, STATUS.BROKEN],
  ]) {
    it(`${name} cannot earn healthy disabled inactivity`, () => {
      assert.equal(gradeMeshServices([peer, { ...discord, ...change }], { discordEnabled: false }).status, expected);
    });
  }

  it('confirmed inactive Discord cannot hide another stopped peer', () => {
    assert.equal(gradeMeshServices([{ ...peer, running: false, pid: null }, discord], { discordEnabled: false }).status, STATUS.BROKEN);
  });

  it('an unobservable peer cannot earn WORKING beside an inactive Discord', () => {
    assert.equal(gradeMeshServices([{ ...peer, observable: false }, discord], { discordEnabled: false }).status, STATUS.UNKNOWN);
    assert.equal(gradeMeshServices([peer, { ...peer, label: 'ai.openclaw.mesh-bridge', observable: false }]).status, STATUS.UNKNOWN);
  });

  it('known failures remain BROKEN when policy or another service is unobservable', () => {
    const stoppedPeer = { ...peer, running: false, pid: null };
    assert.equal(gradeMeshServices([stoppedPeer, discord], { discordPolicyError: 'config unreadable' }).status, STATUS.BROKEN);
    assert.equal(gradeMeshServices([peer, { ...discord, lastExitCode: 1 }], { discordPolicyError: 'config unreadable' }).status, STATUS.BROKEN);
    assert.equal(gradeMeshServices([stoppedPeer, { ...discord, observable: false }]).status, STATUS.BROKEN);
    assert.equal(gradeMeshServices([peer, discord], { discordPolicyError: 'config unreadable' }).status, STATUS.UNKNOWN);
  });

  it('an unloaded role remains OFF without inventing inactive exit evidence', () => {
    assert.equal(gradeMeshServices([{ ...discord, loaded: false }], { discordEnabled: false }).status, STATUS.OFF);
  });

  it('Darwin target reads the loaded Discord HOME and preserves failure priority', { skip: process.platform !== 'darwin' }, async () => {
    const observedHome = '/tmp/discord-loaded-home';
    const samples = [
      { name: 'false', body: '{"channels":{"discord":{"enabled":false}}}', status: STATUS.WORKING },
      { name: 'true', body: '{"channels":{"discord":{"enabled":true}}}', status: STATUS.BROKEN },
      { name: 'legacy', body: '{}', status: STATUS.BROKEN },
      { name: 'string', body: '{"channels":{"discord":{"enabled":"false"}}}', status: STATUS.BROKEN },
      { name: 'null', body: '{"channels":{"discord":{"enabled":null}}}', status: STATUS.BROKEN },
      { name: 'malformed', body: '{', status: STATUS.UNKNOWN },
      { name: 'missing config', missing: true, status: STATUS.UNKNOWN },
      { name: 'missing HOME', noHome: true, status: STATUS.UNKNOWN },
      { name: 'failed peer plus malformed policy', body: '{', peerFailed: true, status: STATUS.BROKEN },
      { name: 'failed peer plus missing HOME', noHome: true, peerFailed: true, status: STATUS.BROKEN },
      { name: 'failed Discord plus malformed policy', body: '{', exit: 1, status: STATUS.BROKEN },
      { name: 'exit unobserved', body: '{"channels":{"discord":{"enabled":false}}}', exit: '(never exited)', status: STATUS.UNKNOWN },
      { name: 'running disabled', body: '{"channels":{"discord":{"enabled":false}}}', discordRunning: true, status: STATUS.BROKEN },
    ];
    for (const s of samples) {
      const reads = [];
      const ctx = makeCtx({
        fsp: { ...makeCtx().fsp, readFile: async (p) => {
          reads.push(p);
          assert.equal(p, path.join(observedHome, '.openclaw', 'openclaw.json'));
          if (s.missing) throw new Error('ENOENT');
          return s.body;
        } },
        exec: async (_command, args) => {
          const isDiscord = args[1].endsWith('/ai.openclaw.mesh-tool-discord');
          const stopped = isDiscord ? !s.discordRunning : s.peerFailed;
          return { code: 0, stderr: '', stdout: `state = ${stopped ? 'not running' : 'running'}\n${stopped ? '' : 'pid = 42\n'}last exit code = ${isDiscord ? s.exit ?? 0 : 1}\n${isDiscord && s.noHome ? '' : `HOME => ${observedHome}\n`}` };
        },
      });
      const r = await target('net.mesh').run(envFor(ctx));
      assert.equal(r.status, s.status, s.name);
      assert.equal(reads.length, s.noHome ? 0 : 1, s.name);
    }
  });
});

describe('node-watch observed verdicts', () => {
  it('HyperAgent is WORKING only with a successful deploy probe and fresh scheduler tick', async () => {
    const probes = { 'L0-HYPERAGENT': { run: async () => ({ status: 'PASS', detail: 'imports' }) } };
    const fresh = makeCtx({
      fsp: { ...makeCtx().fsp, readFile: async () => JSON.stringify({ lastHyperagentReflect: Date.now() - 60_000 }) },
      queryDb: makeQueryDb({ count: 2 }),
    });
    assert.equal((await target('ops.hyperagent').run(envFor(fresh, { probes }))).status, STATUS.WORKING);

    const stale = makeCtx({
      fsp: { ...makeCtx().fsp, readFile: async () => JSON.stringify({ lastHyperagentReflect: Date.now() - 2 * 3600_000 }) },
      queryDb: makeQueryDb({ count: 2 }),
    });
    assert.equal((await target('ops.hyperagent').run(envFor(stale, { probes }))).status, STATUS.BROKEN);
  });

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

  it('roadmap viewer requires authenticated plan discovery, not a public sign-in page', async () => {
    const down = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('ops.roadmap').run(envFor(down))).status, STATUS.OFF);
    const shell = makeCtx({ httpGet: async () => ({ status: 200 }) });
    assert.equal((await target('ops.roadmap').run(envFor(shell))).status, STATUS.BROKEN);
    const denied = makeCtx({ httpGet: async () => ({ status: 401 }) });
    assert.equal((await target('ops.roadmap').run(envFor(denied))).status, STATUS.BROKEN);
    const up = makeCtx({ httpGet: async url => {
      assert.equal(url, 'http://127.0.0.1:7892/api/plans');
      return { status: 200, json: { plans: [] } };
    } });
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

// ── mem.ingest / mem.extraction honesty graders (memory_ingest_remediation) ──
// Regression fixtures are the REAL 2026-07-16 failure values: newest transcript
// Jul 16 14:50Z while state.db's newest message was Jul 14 23:04:49Z (~40h lag)
// and newest entity landing Jul 11 — all graded WORKING by the old presence-only
// probes while ingest ran dark.
import { gradeIngest, gradeExtraction } from '../lib/node-watch.mjs';

const T_MSG_LAST = Date.parse('2026-07-14T23:04:49.727Z');
const T_TRANSCRIPT = Date.parse('2026-07-16T14:50:00Z');
const T_ENTITY_LAST = Date.parse('2026-07-11T19:46:58.327Z');

describe('gradeIngest (freshness, not presence)', () => {
  it('REGRESSION: the live 40h-dark state grades BROKEN, not WORKING', () => {
    const v = gradeIngest({ messageCount: 13117, lastMessageMs: T_MSG_LAST, newestTranscriptMs: T_TRANSCRIPT });
    assert.equal(v.status, STATUS.BROKEN);
    assert.match(v.detail, /LAGGING 39\.8h/);
  });
  it('REGRESSION: enabled source dirs missing grades BROKEN naming them (the silent-skip failure)', () => {
    const v = gradeIngest({
      messageCount: 13117, lastMessageMs: T_MSG_LAST, newestTranscriptMs: null,
      missingSources: ['claude-code-workspace (/Users/x/.claude/projects/Users-x--openclaw-workspace)'],
    });
    assert.equal(v.status, STATUS.BROKEN);
    assert.match(v.detail, /MISSING/);
    assert.match(v.detail, /claude-code-workspace/);
  });
  it('keeping pace (transcript newer by < budget) → WORKING', () => {
    const now = Date.parse('2026-07-16T15:00:00Z');
    const v = gradeIngest({ messageCount: 100, lastMessageMs: now - 5 * 60_000, newestTranscriptMs: now });
    assert.equal(v.status, STATUS.WORKING);
  });
  it('no sources observable → UNKNOWN (never green blind); transcripts but zero messages → BROKEN', () => {
    assert.equal(gradeIngest({ messageCount: 5, lastMessageMs: T_MSG_LAST, newestTranscriptMs: null }).status, STATUS.UNKNOWN);
    assert.equal(gradeIngest({ messageCount: 0, lastMessageMs: NaN, newestTranscriptMs: T_TRANSCRIPT }).status, STATUS.BROKEN);
    assert.equal(gradeIngest({ messageCount: 0, lastMessageMs: NaN, newestTranscriptMs: null }).status, STATUS.UNKNOWN);
  });
});

describe('gradeExtraction (keeps pace with ingest)', () => {
  it('REGRESSION: entities 5 days behind flowing ingest grades BROKEN', () => {
    const v = gradeExtraction({ entityCount: 1112, lastEntityMs: T_ENTITY_LAST, lastMessageMs: T_MSG_LAST });
    assert.equal(v.status, STATUS.BROKEN);
    assert.match(v.detail, /STALLED/);
  });
  it('entities within the stall budget of the newest message → WORKING; none yet → UNKNOWN', () => {
    assert.equal(gradeExtraction({ entityCount: 10, lastEntityMs: T_MSG_LAST - 3600_000, lastMessageMs: T_MSG_LAST }).status, STATUS.WORKING);
    assert.equal(gradeExtraction({ entityCount: 0, lastEntityMs: NaN, lastMessageMs: T_MSG_LAST }).status, STATUS.UNKNOWN);
  });
});

describe('gradeIngest lag budget calibration (tool-marathon tolerance)', () => {
  it('45min mtime-lead during a tool-heavy stretch → WORKING (not a false alarm)', () => {
    const now = Date.parse('2026-07-16T21:30:00Z');
    const v = gradeIngest({ messageCount: 554, lastMessageMs: now - 45 * 60_000, newestTranscriptMs: now });
    assert.equal(v.status, STATUS.WORKING);
  });
  it('a real 3h lag still grades BROKEN', () => {
    const now = Date.parse('2026-07-16T21:30:00Z');
    const v = gradeIngest({ messageCount: 554, lastMessageMs: now - 3 * 3600_000, newestTranscriptMs: now });
    assert.equal(v.status, STATUS.BROKEN);
  });
});
