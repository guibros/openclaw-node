import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  IDLE_THRESHOLD_MS,
  HARD_CAP_MS,
  ANALYSIS_QUIET_MS,
  DEFAULT_INTERVAL_MS,
  isQueueIdle,
  isSystemIdle,
  runScheduledCycle,
  createConsolidationScheduler,
} from '../bin/consolidation-scheduler.mjs';

// ─── Constants ──────────────────────────────────────────────────────────────

describe('consolidation-scheduler constants', () => {
  it('exports expected constant values', () => {
    assert.equal(IDLE_THRESHOLD_MS, 5 * 60 * 1000);
    assert.equal(HARD_CAP_MS, 5 * 60 * 1000);
    assert.equal(ANALYSIS_QUIET_MS, 60 * 1000);
    assert.equal(DEFAULT_INTERVAL_MS, 30 * 60 * 1000);
  });
});

// ─── isQueueIdle ────────────────────────────────────────────────────────────

describe('isQueueIdle', () => {
  it('returns idle when no current job, no pending, no recent activity', () => {
    const state = {
      current_job: null,
      queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, true);
    assert.equal(result.reason, null);
  });

  it('returns not idle when current job is running', () => {
    const state = {
      current_job: { type: 'extraction', elapsed_ms: 3000 },
      queue_depth: 0,
      history: { extraction: { count: 1, avg_ms: 5000 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, false);
    assert.ok(result.reason.includes('active extraction'));
  });

  it('P5-3: returns not idle while a worker-thread extraction job is registered', () => {
    const state = {
      current_job: null, queue_depth: 0,
      external_jobs: [{ id: 'flush-1', type: 'flush', started_at: Date.now() - 5000, elapsed_ms: 5000 }],
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, false);
    assert.match(result.reason, /worker flush job/);
  });

  it('returns not idle when pending jobs exist', () => {
    const state = {
      current_job: null,
      queue_depth: 2,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, false);
    assert.ok(result.reason.includes('2 pending'));
  });

  it('returns not idle when analysis fallback is recent', () => {
    const state = {
      current_job: null,
      queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [{ ts: Date.now() - 10_000, reason: 'analysis-wait-timeout' }],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, false);
    assert.ok(result.reason.includes('analysis activity'));
  });

  it('returns idle when fallbacks are older than ANALYSIS_QUIET_MS', () => {
    const state = {
      current_job: null,
      queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [{ ts: Date.now() - 120_000, reason: 'analysis-wait-timeout' }],
    };
    const result = isQueueIdle(() => state);
    assert.equal(result.idle, true);
  });
});

// ─── isSystemIdle ───────────────────────────────────────────────────────────

describe('isSystemIdle', () => {
  it('returns not idle when in-process queue reports busy', async () => {
    const getStateFn = () => ({
      current_job: { type: 'extraction', elapsed_ms: 1000 },
      queue_depth: 0,
      history: { extraction: { count: 1, avg_ms: 5000 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    });
    const result = await isSystemIdle({ getStateFn });
    assert.equal(result.idle, false);
    assert.ok(result.reason.includes('active extraction'));
  });

  it('returns idle when the in-process queue is idle even if a model remains loaded', async () => {
    const getStateFn = () => ({
      current_job: null,
      queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    });
    const result = await isSystemIdle({ getStateFn });
    assert.equal(result.idle, true);
  });

  it('returns idle from a fresh exported queue snapshot', async () => {
    const result = await isSystemIdle({
      readStateSnapshotFn: () => ({
        current_job: null,
        queue_depth: 0,
        history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
        recent_fallbacks: [],
      }),
    });
    assert.equal(result.idle, true);
  });

  it('returns not idle from a busy exported queue snapshot', async () => {
    const result = await isSystemIdle({
      readStateSnapshotFn: () => ({
        current_job: { type: 'analysis', elapsed_ms: 500 },
        queue_depth: 0,
        history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 1, avg_ms: 500 } },
        recent_fallbacks: [],
      }),
    });
    assert.equal(result.idle, false);
    assert.match(result.reason, /active analysis/);
  });

  it('fails closed when the exported queue snapshot is missing or stale', async () => {
    const result = await isSystemIdle({ readStateSnapshotFn: () => null });
    assert.equal(result.idle, false);
    assert.match(result.reason, /missing or stale/);
  });
});

// ─── runScheduledCycle ──────────────────────────────────────────────────────

describe('runScheduledCycle', () => {
  it('reports a synchronous overrun even when the deadline timer could not run', async () => {
    const result = await runScheduledCycle({
      hardCapMs: 1,
      runCycle: async () => {
        const start = performance.now();
        while (performance.now() - start < 20) {}
        return {};
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /hard cap/);
  });

  it('runs a mock cycle successfully and returns ok + durationMs', async () => {
    const mockResult = { decayed: { decayedEntities: 3 }, durationMs: 100 };
    const result = await runScheduledCycle({
      hardCapMs: 5000,
      runCycle: async () => mockResult,
    });
    assert.equal(result.ok, true);
    assert.deepStrictEqual(result.result, mockResult);
    assert.ok(result.durationMs >= 0);
  });

  it('does not report timeout completion before an uncooperative cycle settles', async () => {
    let terminated = false;
    const result = await runScheduledCycle({
      hardCapMs: 50, // very short cap
      runCycle: async () => {
        await new Promise(r => setTimeout(r, 200)); // exceed cap
        terminated = true;
        return {};
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('hard cap'));
    assert.equal(terminated, true);
    assert.ok(result.durationMs >= 180, `durationMs=${result.durationMs}`);
  });

  it('returns error when cycle throws', async () => {
    const result = await runScheduledCycle({
      hardCapMs: 5000,
      runCycle: async () => { throw new Error('db crashed'); },
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('db crashed'));
  });

  it('hands the cycle an LLM client (regression: cycles ran data-only forever)', async () => {
    const sentinel = { generateAnalysis: async () => ({ mode: 'fallback' }) };
    let seen;
    await runScheduledCycle({
      hardCapMs: 5000,
      client: sentinel,
      runCycle: async (args) => { seen = args.client; return {}; },
    });
    assert.equal(seen, sentinel, 'an injected client must reach the cycle');

    await runScheduledCycle({
      hardCapMs: 5000,
      runCycle: async (args) => { seen = args.client; return {}; },
    });
    assert.ok(seen && typeof seen.generateAnalysis === 'function',
      'without injection the scheduler must construct a real client');
  });
});

// ─── createConsolidationScheduler ───────────────────────────────────────────

describe('createConsolidationScheduler', () => {
  it('awaits its default notification CLI and platform child before reporting or stopping', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'consolidation-notify-'));
    const ready = join(dir, 'sender-started');
    const release = join(dir, 'sender-release');
    const config = join(dir, 'notify.json');
    const sender = join(dir, process.platform === 'darwin' ? 'terminal-notifier' : 'notify-send');
    writeFileSync(config, JSON.stringify({ enabled: true }));
    writeFileSync(sender, `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--help')) { console.log(' -A, --action'); process.exit(0); }
fs.writeFileSync(process.env.OWNED_NOTIFY_READY, String(process.pid));
const timer = setInterval(() => { if (fs.existsSync(process.env.OWNED_NOTIFY_RELEASE)) { clearInterval(timer); } }, 10);
setTimeout(() => process.exit(2), 10000).unref();
`, { mode: 0o700 });
    const source = new URL('../bin/consolidation-scheduler.mjs', import.meta.url).href;
    const code = `import { createConsolidationScheduler } from ${JSON.stringify(source)};
const scheduler = createConsolidationScheduler({
 getStateFn: () => ({current_job:null,queue_depth:0,history:{extraction:{count:0}},recent_fallbacks:[]}),
 log: () => {}, runCycle: async () => {throw new Error('owned notification failure');}
});
const active=scheduler.runOnce();
await scheduler.stop();
const result=await active;
console.log('LOCAL_COMPLETION '+result.ok);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: {
        ...process.env, HOME: dir, OPENCLAW_NOTIFY_CONFIG: config,
        OPENCLAW_NOTIFY_LEDGER: join(dir, 'ledger.jsonl'),
        OPENCLAW_NOTIFIER_APP: sender, OPENCLAW_NOTIFY_ICONS: join(dir, 'icons'),
        PATH: dir + ':' + process.env.PATH, OWNED_NOTIFY_READY: ready, OWNED_NOTIFY_RELEASE: release,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { errors += b; });
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code));
    });
    try {
      for (let i = 0; !existsSync(ready) && i < 1000 && child.exitCode === null; i++) await new Promise(r => setTimeout(r, 10));
      assert.equal(existsSync(ready), true, errors);
      await new Promise(r => setTimeout(r, 30));
      assert.equal(output.includes('LOCAL_COMPLETION'), false);
      writeFileSync(release, '');
      assert.equal(await exited, 0, errors);
      assert.match(output, /LOCAL_COMPLETION false/);
    } finally {
      writeFileSync(release, '');
      await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retains single-flight through delayed abort cleanup, and stop fences admission', async () => {
    let release;
    let sawAbort;
    const cleanup = new Promise(r => { release = r; });
    const aborted = new Promise(r => { sawAbort = r; });
    let runs = 0;
    let returned = false;
    let stopped = false;
    const scheduler = createConsolidationScheduler({
      getStateFn: () => ({ current_job: null, queue_depth: 0, history: { extraction: { count: 0 } }, recent_fallbacks: [] }),
      log: () => {},
      hardCapMs: 20,
      notifyFailure: async () => {},
      runCycle: async ({ signal }) => {
        runs++;
        signal.addEventListener('abort', sawAbort, { once: true });
        await cleanup;
        return {};
      },
    });
    const active = scheduler.runOnce().then(r => { returned = true; return r; });
    try {
      await aborted;
      assert.equal(returned, false);
      assert.equal((await scheduler.runOnce()).skipped, true);
      assert.equal(runs, 1);
      const stop = scheduler.stop().then(() => { stopped = true; });
      assert.equal((await scheduler.runOnce()).reason, 'scheduler stopped');
      await new Promise(r => setTimeout(r, 20));
      assert.equal(stopped, false);
      release();
      assert.equal((await active).ok, false);
      await stop;
      assert.equal(stopped, true);
    } finally {
      release();
      await active;
      await scheduler.stop();
    }
  });

  it('owns an actual notification child until exit, including stop', async () => {
    let child;
    let childStarted;
    let returned = false;
    let stopped = false;
    const started = new Promise(r => { childStarted = r; });
    const scheduler = createConsolidationScheduler({
      getStateFn: () => ({ current_job: null, queue_depth: 0, history: { extraction: { count: 0 } }, recent_fallbacks: [] }),
      log: () => {},
      runCycle: async () => { throw new Error('owned failure'); },
      notifyFailure: () => new Promise((resolve, reject) => {
        child = spawn(process.execPath, ['-e', "process.send('ready'); process.on('message', () => process.exit(0))"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        child.once('message', childStarted);
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error('child failed')));
      }),
    });
    const active = scheduler.runOnce().then(r => { returned = true; return r; });
    try {
      await started;
      assert.equal(returned, false);
      assert.equal((await scheduler.runOnce()).skipped, true);
      const stop = scheduler.stop().then(() => { stopped = true; });
      await new Promise(r => setTimeout(r, 20));
      assert.equal(stopped, false);
      child.send('release');
      assert.equal((await active).ok, false);
      await stop;
      assert.equal(child.exitCode, 0);
    } finally {
      if (child?.exitCode === null) child.kill();
      await active;
      await scheduler.stop();
    }
  });

  it('returns object with start, stop, runOnce', () => {
    const scheduler = createConsolidationScheduler({ log: () => {} });
    assert.equal(typeof scheduler.start, 'function');
    assert.equal(typeof scheduler.stop, 'function');
    assert.equal(typeof scheduler.runOnce, 'function');
    scheduler.stop(); // cleanup
  });

  it('runOnce logs every removed row and the prune counts on completion (repair 2026-09-26)', async () => {
    const idle = () => ({
      current_job: null, queue_depth: 0,
      history: { extraction: { count: 0, avg_ms: 0 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    });
    const logs = [];
    const scheduler = createConsolidationScheduler({
      getStateFn: idle,
      log: (msg) => logs.push(msg),
      hardCapMs: 5000,
      runCycle: async () => ({
        decayed: {
          decayedEntities: 4, decayedDecisions: 2, archivedEntities: 1,
          removed: [{ action: 'archived', kind: 'entity', id: 7, label: 'Faded Thing', salience: 0.04 }],
        },
        pruned: {
          archivedDecisions: 1, prunedThemes: 1, themesSkipped: null,
          backup: { path: '/tmp/backups/state-20260926T120000000Z.db', reused: false, removed: [] },
          removed: [
            { action: 'archived', kind: 'decision', id: 42, label: 'Use JetStream', salience: 0.049, session_id: '1bbee00d-aaaa' },
            { action: 'deleted', kind: 'theme', id: 5, label: 'old theme' },
          ],
        },
      }),
    });

    const result = await scheduler.runOnce();

    assert.equal(result.ok, true);
    assert.ok(logs.some((l) => l.includes('archived entity #7 (salience 0.040) "Faded Thing"')), logs.join('\n'));
    assert.ok(logs.some((l) => l.includes('archived decision #42 (salience 0.049, session 1bbee00d) "Use JetStream"')));
    assert.ok(logs.some((l) => l.includes('deleted theme #5 "old theme"')));
    const done = logs.find((l) => l.includes('cycle complete'));
    assert.match(done, /archived 1 entities/);
    assert.match(done, /pruned: archived 1 decisions, deleted 1 idle themes/);
    assert.match(done, /backup written \/tmp\/backups\/state-20260926T120000000Z\.db/);
  });

  it('runOnce skips when system is busy', async () => {
    const getStateFn = () => ({
      current_job: { type: 'extraction', elapsed_ms: 1000 },
      queue_depth: 0,
      history: { extraction: { count: 1, avg_ms: 5000 }, analysis: { count: 0, avg_ms: 0 } },
      recent_fallbacks: [],
    });
    const logs = [];
    const scheduler = createConsolidationScheduler({
      getStateFn,
      log: msg => logs.push(msg),
    });
    const result = await scheduler.runOnce();
    assert.equal(result.skipped, true);
    assert.ok(result.reason.includes('extraction'));
    assert.ok(logs.some(l => l.includes('skipping')));
  });
});
