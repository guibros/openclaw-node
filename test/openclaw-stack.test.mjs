import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {
  scanLaunchdUnits, scanSystemdUnits, probePort, classify, shortId, PORTS, PERIODIC,
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
