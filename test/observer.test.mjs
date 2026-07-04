import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import {
  sampleLayers, appendSample, scanMemoryActivity, extractActivity,
  readTimeline, readActivity, GAP_THRESHOLD_MS, WORKING_WINDOW_MS, CORE_SERVICES,
} from '../lib/observer.mjs';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'observer-test-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sampleLayers', () => {
  it('captures all five layers; interaction ACTIVE + fresh => active, stale extraction => not working', () => {
    const now = Date.parse('2026-07-04T12:00:00Z');
    const dsPath = path.join(tmp, 'daemon-state.json');
    fs.writeFileSync(dsPath, JSON.stringify({ state: 'ACTIVE', sessionId: 'abcd1234-x', pid: process.pid, lastActivityTime: now - 30_000 }));

    const s = sampleLayers({
      now, boot: 111, daemonStatePath: dsPath,
      roster: { up: CORE_SERVICES.slice(0, 5), down: CORE_SERVICES.slice(5) },
      lastExtraction: new Date(now - WORKING_WINDOW_MS - 3600_000).toISOString(), // stale
    });
    assert.equal(s.vm_boot, 111);
    assert.equal(s.node.core_up, 5);
    assert.equal(s.node.core_total, CORE_SERVICES.length);
    assert.equal(s.interaction.active, true, 'ACTIVE + 30s idle => active');
    assert.equal(s.interaction.session, 'abcd1234');
    assert.equal(s.memory.daemon, true, 'own pid is alive');
    assert.equal(s.memory.working, false, 'stale extraction => not forming memories (the frozen-brain state)');
  });

  it('interaction is NOT active when ENDED or idle past the window', () => {
    const now = Date.parse('2026-07-04T12:00:00Z');
    const dsPath = path.join(tmp, 'ds.json');
    fs.writeFileSync(dsPath, JSON.stringify({ state: 'ACTIVE', pid: process.pid, lastActivityTime: now - 60 * 60_000 })); // 1h idle
    const s = sampleLayers({ now, boot: 1, daemonStatePath: dsPath, roster: { up: [], down: CORE_SERVICES }, lastExtraction: null });
    assert.equal(s.interaction.active, false, 'idle past the window => not active even if state says ACTIVE');
    assert.equal(s.memory.working, false);
  });
});

describe('appendSample — VM off / reboot inscription', () => {
  it('inscribes a reboot gap when samples straddle a boot change past the threshold', async () => {
    const ledgerPath = path.join(tmp, 'observer.jsonl');
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    await appendSample(mk(t0, 100), { ledgerPath });
    const r = await appendSample(mk(t0 + 30 * 60_000, 200), { ledgerPath }); // +30min, new boot
    assert.equal(r.gapInscribed, true);
    const recs = (await readFile(ledgerPath, 'utf8')).trim().split('\n').map(JSON.parse);
    const gap = recs.find((x) => x.event === 'gap');
    assert.equal(gap.reason, 'reboot');
    assert.equal(gap.minutes, 30);
  });

  it('no gap for the normal 60s cadence', async () => {
    const ledgerPath = path.join(tmp, 'l.jsonl');
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    await appendSample(mk(t0, 1), { ledgerPath });
    const r = await appendSample(mk(t0 + 60_000, 1), { ledgerPath });
    assert.equal(r.gapInscribed, false);
  });
});

describe('extractActivity — daemon log → structured events', () => {
  it('structures synthesis mode, knowledge-index, graph-cache, and failure lines', () => {
    const log = [
      '[2026-07-04, 12:48:18]   Phase 2: interval synthesis [regex]: 19 facts found',
      '[2026-06-16, 22:17:06]   Phase 2: interval synthesis [llm]: 26 facts found, 26 added',
      '[2026-07-04, 12:50:45]   Phase 2: knowledge-index: 1 sessions indexed (216 chunks)',
      '[2026-07-04, 12:36:11]   Phase 2: graph-cache refreshed: 152 nodes, 1072 edges',
      '[2026-07-03, 16:45:53] [watcher] ALERT: extraction_failure_rate — 3/3 extractions failed (100%)',
      'a line with no timestamp — ignored',
    ].join('\n');
    const ev = extractActivity(log);
    const synth = ev.find((e) => e.kind === 'synthesis' && e.mode === 'llm');
    assert.ok(synth, 'llm synthesis captured');
    assert.equal(synth.facts, 26);
    assert.equal(ev.find((e) => e.kind === 'knowledge-index').chunks, 216);
    assert.equal(ev.find((e) => e.kind === 'graph-cache').edges, 1072);
    assert.ok(ev.find((e) => e.kind === 'extraction-failure'));
    assert.equal(ev.length, 5, 'the timestamp-less line is skipped');
  });
});

describe('scanMemoryActivity — incremental, offset-tracked', () => {
  it('appends only NEW events on a second scan (offset advances)', async () => {
    const logPath = path.join(tmp, 'daemon.log');
    const activityPath = path.join(tmp, 'activity.jsonl');
    const logPosPath = path.join(tmp, 'pos.json');
    fs.writeFileSync(logPath, '[2026-07-04, 12:00:00]   Phase 2: interval synthesis [regex]: 5 facts found\n');
    const a1 = await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath });
    assert.equal(a1.appended, 1);
    // second scan, nothing new
    const a2 = await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath });
    assert.equal(a2.appended, 0, 'no re-append without new log lines');
    // append a new line
    fs.appendFileSync(logPath, '[2026-07-04, 12:01:00]   Phase 2: knowledge-index: 2 sessions indexed (10 chunks)\n');
    const a3 = await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath });
    assert.equal(a3.appended, 1, 'only the new line');
    const feed = readActivity(await readFile(activityPath, 'utf8'));
    assert.equal(feed.count, 2);
  });
});

describe('readTimeline — per-layer uptime', () => {
  it('computes independent uptime per layer and flags the memory-idle condition', () => {
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    const lines = [];
    // 4 samples at 60s: vm always up, node up, interaction active for 2 then idle,
    // memory daemon up throughout but working only for the first 2
    for (let i = 0; i < 4; i++) {
      lines.push(JSON.stringify({
        event: 'sample', ts: new Date(t0 + i * 60_000).toISOString(), vm_boot: 1,
        node: { core_up: CORE_SERVICES.length, core_total: CORE_SERVICES.length, down: [] },
        interaction: { state: i < 2 ? 'ACTIVE' : 'ENDED', session: 's', idle_s: 5, active: i < 2 },
        memory: { daemon: true, extraction_age_h: i < 2 ? 1 : 999, working: i < 2 },
      }));
    }
    const t = readTimeline(lines.join('\n'), { now: t0 + 3 * 60_000 + 1000 });
    assert.equal(t.layers.vm.uptimePct, 100);
    assert.equal(t.layers.node.uptimePct, 100);
    assert.ok(t.layers.interaction.uptimePct > 0 && t.layers.interaction.uptimePct < 100);
    assert.equal(t.layers.memory.uptimePct, 100, 'daemon up the whole time');
    assert.ok(t.layers.memory.workingPct < 100, 'but forming memories only part of the time');
    assert.equal(t.layers.memory.current, 'IDLE (not extracting)', 'last sample: up but stale extraction');
  });

  it('current reads OFF when the last sample is stale', () => {
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    const line = JSON.stringify({ event: 'sample', ts: new Date(t0).toISOString(), vm_boot: 1,
      node: { core_up: 6, core_total: 6, down: [] }, interaction: { state: 'ACTIVE', active: true },
      memory: { daemon: true, working: true, extraction_age_h: 1 } });
    const t = readTimeline(line, { now: t0 + GAP_THRESHOLD_MS + 60_000 });
    assert.equal(t.layers.vm.current, 'OFF');
    assert.equal(t.lastSampleStale, true);
  });
});

function mk(nowMs, boot) {
  return {
    ts: new Date(nowMs).toISOString(), vm_boot: boot,
    node: { core_up: 6, core_total: 6, down: [] },
    interaction: { state: 'IDLE', session: null, idle_s: 100, active: false },
    memory: { daemon: true, last_extraction: null, extraction_age_h: null, working: false },
  };
}
