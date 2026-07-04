import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import {
  deriveWakeSample, appendWakeRecord, readTimeline,
  GAP_THRESHOLD_MS, STALE_EXTRACTION_MS,
} from '../lib/wakefulness.mjs';

let tmp, ledger;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-test-'));
  ledger = path.join(tmp, 'wakefulness.jsonl');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const reportWith = (health, daemonWorking) => ({
  health,
  results: [{ id: 'mem.daemon', status: daemonWorking ? 'WORKING' : 'BROKEN' }],
});

describe('deriveWakeSample', () => {
  it('marks working when extraction is fresh, idle when stale', () => {
    const now = Date.parse('2026-07-04T12:00:00Z');
    const fresh = deriveWakeSample(reportWith(80, true), {
      now, boot: 1, readExtraction: false,
      lastExtraction: new Date(now - 3600_000).toISOString(), // 1h old
      daemonStatePath: '/nonexistent',
    });
    assert.equal(fresh.working, true);
    assert.equal(fresh.daemon, 'up');

    const stale = deriveWakeSample(reportWith(80, true), {
      now, boot: 1, readExtraction: false,
      lastExtraction: new Date(now - STALE_EXTRACTION_MS - 3600_000).toISOString(),
      daemonStatePath: '/nonexistent',
    });
    assert.equal(stale.working, false, 'stale extraction => not working (the June-17 state)');
  });

  it('daemon down surfaces from the node-watch probe', () => {
    const s = deriveWakeSample(reportWith(40, false), { now: 1, boot: 1, readExtraction: false, daemonStatePath: '/nonexistent' });
    assert.equal(s.daemon, 'down');
  });
});

describe('appendWakeRecord — gap inscription', () => {
  it('inscribes a gap record when the previous heartbeat is older than the threshold', async () => {
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    await appendWakeRecord(mkSample(t0, 1), { ledgerPath: ledger });
    // next heartbeat 20 min later (> 5min threshold) with a NEW boot time => reboot
    const r = await appendWakeRecord(mkSample(t0 + 20 * 60_000, 2), { ledgerPath: ledger });
    assert.equal(r.gapInscribed, true);

    const text = await readFile(ledger, 'utf8');
    const recs = text.trim().split('\n').map(JSON.parse);
    const gap = recs.find((x) => x.event === 'gap');
    assert.ok(gap, 'gap record written');
    assert.equal(gap.minutes, 20);
    assert.equal(gap.reason, 'reboot', 'boot change => reboot, not a mere daemon restart');
  });

  it('no gap for a normal 60s cadence', async () => {
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    await appendWakeRecord(mkSample(t0, 1), { ledgerPath: ledger });
    const r = await appendWakeRecord(mkSample(t0 + 60_000, 1), { ledgerPath: ledger });
    assert.equal(r.gapInscribed, false);
  });
});

describe('readTimeline', () => {
  it('reconstructs awake/off intervals, uptime%, and working-fraction', () => {
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    const lines = [];
    // 3 awake heartbeats (working), then a 60-min OFF gap, then 2 awake (idle)
    for (let i = 0; i < 3; i++) lines.push(JSON.stringify({ event: 'heartbeat', ...mkSample(t0 + i * 60_000, 1, true) }));
    lines.push(JSON.stringify({ event: 'gap', ts: new Date(t0 + 63 * 60_000).toISOString(), from: new Date(t0 + 2 * 60_000).toISOString(), to: new Date(t0 + 63 * 60_000).toISOString(), minutes: 61, reason: 'reboot' }));
    for (let i = 0; i < 2; i++) lines.push(JSON.stringify({ event: 'heartbeat', ...mkSample(t0 + (63 + i) * 60_000, 2, false) }));

    const t = readTimeline(lines.join('\n'), { now: t0 + 65 * 60_000 });
    assert.equal(t.reboots, 1);
    assert.equal(t.longestGapMin, 61);
    assert.equal(t.intervals.filter((iv) => iv.kind === 'off').length, 1);
    assert.equal(t.intervals.filter((iv) => iv.kind === 'awake').length, 2);
    // current: last heartbeat was idle and recent => AWAKE-IDLE
    assert.equal(t.current.state, 'AWAKE-IDLE');
    assert.ok(t.uptimePct > 0 && t.uptimePct < 100);
  });

  it('current state is OFF when the last heartbeat is stale', () => {
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    const line = JSON.stringify({ event: 'heartbeat', ...mkSample(t0, 1, true) });
    const t = readTimeline(line, { now: t0 + GAP_THRESHOLD_MS + 60_000 });
    assert.equal(t.current.state, 'OFF');
    assert.ok(t.current.forMin >= 6);
  });

  it('empty ledger yields null uptime, no throw', () => {
    const t = readTimeline('', { now: Date.now() });
    assert.equal(t.uptimePct, null);
    assert.equal(t.heartbeats, 0);
  });
});

function mkSample(nowMs, boot, working = true) {
  return {
    ts: new Date(nowMs).toISOString(),
    boot,
    health: 75,
    daemon: 'up',
    daemon_state: working ? 'ACTIVE' : 'ENDED',
    last_extraction: working ? new Date(nowMs - 3600_000).toISOString() : new Date(nowMs - STALE_EXTRACTION_MS - 3600_000).toISOString(),
    extraction_age_h: working ? 1 : 7,
    working,
  };
}
