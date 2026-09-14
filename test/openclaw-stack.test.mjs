import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {
  scanLaunchdUnits, scanSystemdUnits, probePort, classify, shortId, PORTS, PERIODIC,
  externalAppRow, notifyCounts,
} from '../bin/openclaw-stack.mjs';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('unit discovery', () => {
  it('scans ai.openclaw plists, flags .disabled, ignores foreign files', () => {
    for (const f of [
      'ai.openclaw.nats.plist',
      'ai.openclaw.mesh-agent.plist.disabled',
      'com.apple.something.plist',
      'ai.openclaw.memory-daemon.plist.bak-2026-05-28',
    ]) fs.writeFileSync(path.join(tmp, f), 'x');
    const units = scanLaunchdUnits(tmp);
    assert.deepEqual(units.map(u => [u.id, u.disabled]), [
      ['mesh-agent', true],
      ['nats', false],
    ]);
  });
  it('parses systemd list-unit-files output; masked = disabled', () => {
    const exec = () => 'openclaw-mission-control.service enabled\nopenclaw-mesh-agent.service masked\nopenclaw-log-rotate.timer enabled\n';
    const units = scanSystemdUnits(exec);
    assert.deepEqual(units.map(u => [u.id, u.disabled]), [
      ['mission-control', false], ['mesh-agent', true], ['log-rotate', false],
    ]);
  });
  it('shortId strips both platform prefixes', () => {
    assert.equal(shortId('ai.openclaw.workplan-viewer.plist'), 'workplan-viewer');
    assert.equal(shortId('openclaw-node-watch.service'), 'node-watch');
  });
});

describe('probePort', () => {
  it('true for a listening port, false for a closed one', async () => {
    const srv = net.createServer().listen(0, '127.0.0.1');
    await new Promise(r => srv.once('listening', r));
    const port = srv.address().port;
    assert.equal(await probePort(port), true);
    srv.close();
    await new Promise(r => srv.once('close', r));
    assert.equal(await probePort(port), false);
  });
});

describe('classify — the honesty rules', () => {
  it('disabled units are DISABLED, never resurrected as startable', () => {
    assert.equal(classify({ id: 'mesh-agent', disabled: true }, { loaded: false }), 'DISABLED');
  });
  it('port units: LIVE only on an open port; loaded-but-closed is DOWN', () => {
    assert.equal(classify({ id: 'nats' }, { loaded: true, pid: 1, portOk: true }), 'LIVE');
    assert.equal(classify({ id: 'nats' }, { loaded: true, pid: 1, portOk: false }), 'DOWN');
    assert.equal(classify({ id: 'nats' }, { loaded: false, portOk: false }), 'OFF');
  });
  it('periodic units are healthy while LOADED without a pid; daemons are not', () => {
    assert.equal(classify({ id: 'observer' }, { loaded: true, pid: null }), 'LOADED');
    assert.equal(classify({ id: 'gateway' }, { loaded: true, pid: null }), 'DOWN');
    assert.equal(classify({ id: 'gateway' }, { loaded: true, pid: 42 }), 'LIVE');
  });
  it('every port id and periodic id uses the canonical short form', () => {
    for (const id of [...Object.keys(PORTS), ...PERIODIC]) {
      assert.equal(id, shortId(`ai.openclaw.${id}.plist`));
    }
  });
});

describe('external apps — a closed GUI app is not a fault', () => {
  const live = async () => true;
  const closed = async () => false;

  it('LIVE on an open port, whatever the install dir says', async () => {
    const row = await externalAppRow('voicestudio', 3900, '/nope', () => false, live);
    assert.equal(row.status, 'LIVE');
    assert.equal(row.port, 3900);
  });

  it('CLOSED — not DOWN — when it is installed but not open', async () => {
    const row = await externalAppRow('voicestudio', 3900, '/Applications/VoiceStudio.app', () => true, closed);
    assert.equal(row.status, 'CLOSED');
    assert.equal(row.reportOnly, true);
  });

  it('ABSENT when it was never installed', async () => {
    const row = await externalAppRow('voicestudio', 3900, '/Applications/VoiceStudio.app', () => false, closed);
    assert.equal(row.status, 'ABSENT');
  });

  it('a closed app never reaches the bad set, so the exit code stays 0', async () => {
    const row = await externalAppRow('voicestudio', 3900, '/app', () => true, closed);
    const rows = [{ id: 'nats', status: 'LIVE' }, row];
    // The two places a verdict is drawn: notifyResult's bad set, and the exit
    // predicate in the CLI, which keys on DOWN.
    assert.deepEqual(notifyCounts(rows).bad, []);
    assert.equal(rows.some(r => r.status === 'DOWN'), false);
  });

  it('a report-only row moves neither live nor total', async () => {
    const base = [{ id: 'nats', status: 'LIVE' }, { id: 'observer', status: 'LOADED' }];
    const before = notifyCounts(base);
    const after = notifyCounts([...base, await externalAppRow('voicestudio', 3900, '/app', () => true, closed)]);
    assert.deepEqual([after.live, after.total], [before.live, before.total]);
    assert.deepEqual([after.live, after.total], [2, 2]);
  });

  it('real units still count and still fail', () => {
    const counts = notifyCounts([
      { id: 'nats', status: 'LIVE' },
      { id: 'gateway', status: 'DOWN' },
      { id: 'mesh-agent', status: 'DISABLED' },
    ]);
    assert.deepEqual(counts, { live: 1, total: 2, bad: ['gateway'] });
  });
});
