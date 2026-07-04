import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  notify, readLedger, appendLedger, recordClick, loadConfig, resolveIcon,
  buildDarwinArgs, buildLinuxArgs, dispatch, awaitClickAndOpen, notifyPaths,
  DEFAULT_CONFIG, KINDS,
} from '../lib/notify.mjs';

let tmp, paths;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-test-'));
  paths = {
    ledger: path.join(tmp, 'notifications', 'ledger.jsonl'),
    config: path.join(tmp, 'config', 'notify.json'),
    iconDir: path.join(tmp, 'icons'),
  };
  fs.mkdirSync(paths.iconDir, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const okExec = (cmd, args, opts, cb) => cb(null);
const failExec = (cmd, args, opts, cb) => cb(new Error('boom'));

describe('notifyPaths', () => {
  it('honors env overrides', () => {
    const p = notifyPaths({
      OPENCLAW_NOTIFY_LEDGER: '/x/l.jsonl',
      OPENCLAW_NOTIFY_CONFIG: '/x/c.json',
      OPENCLAW_NOTIFY_ICONS: '/x/icons',
    });
    assert.equal(p.ledger, '/x/l.jsonl');
    assert.equal(p.config, '/x/c.json');
    assert.equal(p.iconDir, '/x/icons');
  });
  it('defaults under ~/.openclaw', () => {
    const p = notifyPaths({});
    assert.ok(p.ledger.endsWith('.openclaw/notifications/ledger.jsonl'));
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const cfg = loadConfig(paths);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.icons.success, 'success.png');
  });
  it('deep-merges user overrides over defaults', () => {
    fs.mkdirSync(path.dirname(paths.config), { recursive: true });
    fs.writeFileSync(paths.config, JSON.stringify({
      icons: { success: 'party.png' },
      sources: { 'node-watch': false },
    }));
    const cfg = loadConfig(paths);
    assert.equal(cfg.icons.success, 'party.png');
    assert.equal(cfg.icons.error, 'error.png');
    assert.equal(cfg.sources['node-watch'], false);
  });
});

describe('resolveIcon', () => {
  it('resolves kind icon from iconDir, falls back to default, null when missing', () => {
    fs.writeFileSync(path.join(paths.iconDir, 'warn.png'), 'x');
    fs.writeFileSync(path.join(paths.iconDir, 'default.png'), 'x');
    const cfg = loadConfig(paths);
    assert.equal(resolveIcon('warn', cfg, paths), path.join(paths.iconDir, 'warn.png'));
    assert.equal(resolveIcon('error', cfg, paths), path.join(paths.iconDir, 'default.png'));
    fs.rmSync(path.join(paths.iconDir, 'default.png'));
    assert.equal(resolveIcon('error', cfg, paths), null);
  });
  it('explicit absolute path wins', () => {
    const abs = path.join(paths.iconDir, 'custom.png');
    fs.writeFileSync(abs, 'x');
    assert.equal(resolveIcon('info', loadConfig(paths), paths, abs), abs);
  });
});

describe('ledger', () => {
  it('read on missing file is empty, not an error', () => {
    assert.deepEqual(readLedger({}, paths), { events: [], total: 0 });
  });
  it('folds clicks, skips malformed lines, newest first, filters + limit', () => {
    appendLedger({ v: 1, type: 'notification', id: 'a', ts: '2026-07-04T10:00:00Z', source: 'workplan', kind: 'success', title: 'A' }, paths);
    fs.appendFileSync(paths.ledger, 'not json{{{\n');
    appendLedger({ v: 1, type: 'notification', id: 'b', ts: '2026-07-04T11:00:00Z', source: 'node-watch', kind: 'error', title: 'B' }, paths);
    recordClick('a', paths);
    recordClick('a', paths);
    const all = readLedger({}, paths);
    assert.equal(all.total, 2);
    assert.deepEqual(all.events.map(e => e.id), ['b', 'a']);
    const a = all.events.find(e => e.id === 'a');
    assert.ok(a.clicked_at);
    assert.equal(readLedger({ kind: 'error' }, paths).events.length, 1);
    assert.equal(readLedger({ source: 'workplan' }, paths).events[0].id, 'a');
    const limited = readLedger({ limit: 1 }, paths);
    assert.equal(limited.events.length, 1);
    assert.equal(limited.total, 2);
  });
});

describe('platform args', () => {
  const evt = {
    id: 'x', source: 'workplan', kind: 'success', title: 'T', subtitle: 'S',
    message: 'M', url: 'http://127.0.0.1:7892/?plan=protocol', icon: '/icons/success.png',
  };
  it('darwin args carry click-through -open, icon, group', () => {
    const args = buildDarwinArgs(evt, 'Glass');
    const get = f => args[args.indexOf(f) + 1];
    assert.equal(get('-open'), evt.url);
    assert.equal(get('-contentImage'), evt.icon);
    assert.equal(get('-group'), 'openclaw-workplan');
    assert.equal(get('-sound'), 'Glass');
  });
  it('darwin args omit -open when no url', () => {
    assert.ok(!buildDarwinArgs({ ...evt, url: undefined }, 'Glass').includes('-open'));
  });
  it('linux args carry icon, urgency, and -A only when clickable', () => {
    const clickable = buildLinuxArgs(evt, { clickable: true });
    assert.ok(clickable.includes('-A'));
    assert.equal(clickable[clickable.indexOf('-i') + 1], evt.icon);
    assert.equal(clickable[clickable.indexOf('-u') + 1], 'normal');
    const plain = buildLinuxArgs({ ...evt, kind: 'block' }, { clickable: false });
    assert.ok(!plain.includes('-A'));
    assert.equal(plain[plain.indexOf('-u') + 1], 'critical');
  });
});

describe('dispatch', () => {
  const evt = { id: 'x', source: 's', kind: 'info', title: 'T', message: 'M', url: 'http://x/' };
  it('darwin uses terminal-notifier when present → clickable', async () => {
    const d = await dispatch(evt, DEFAULT_CONFIG, { platform: 'darwin', terminalNotifier: '/tn', exec: okExec });
    assert.deepEqual(d, { method: 'terminal-notifier', clickable: true, ok: true });
  });
  it('darwin falls back to osascript → honest unclickable', async () => {
    const d = await dispatch(evt, DEFAULT_CONFIG, { platform: 'darwin', terminalNotifier: null, exec: okExec });
    assert.deepEqual(d, { method: 'osascript', clickable: false, ok: true });
  });
  it('linux with action support spawns the click waiter', async () => {
    let spawned = null;
    const d = await dispatch(evt, DEFAULT_CONFIG, {
      platform: 'linux', hasActions: true, spawnClickWaiter: e => { spawned = e; },
    });
    assert.deepEqual(d, { method: 'notify-send', clickable: true, ok: true });
    assert.equal(spawned.id, 'x');
  });
  it('linux without action support fires plain notify-send', async () => {
    const calls = [];
    const d = await dispatch(evt, DEFAULT_CONFIG, {
      platform: 'linux', hasActions: false, exec: (c, a, o, cb) => { calls.push([c, a]); cb(null); },
    });
    assert.deepEqual(d, { method: 'notify-send', clickable: false, ok: true });
    assert.equal(calls[0][0], 'notify-send');
    assert.ok(!calls[0][1].includes('-A'));
  });
  it('delivery failure is reported, not thrown', async () => {
    const d = await dispatch(evt, DEFAULT_CONFIG, { platform: 'darwin', terminalNotifier: '/tn', exec: failExec });
    assert.equal(d.ok, false);
  });
  it('unknown platform → none', async () => {
    const d = await dispatch(evt, DEFAULT_CONFIG, { platform: 'win32' });
    assert.deepEqual(d, { method: 'none', clickable: false, ok: false });
  });
});

describe('awaitClickAndOpen', () => {
  const evt = { id: 'clicked-1', source: 's', kind: 'info', title: 'T', message: 'M', url: 'http://origin/' };
  it('on activation: opens origin and ledgers the click', () => {
    let opened = null;
    const hit = awaitClickAndOpen(evt, paths, { exec: () => 'default\n', open: u => { opened = u; } });
    assert.equal(hit, true);
    assert.equal(opened, 'http://origin/');
    const lines = fs.readFileSync(paths.ledger, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual([lines[0].type, lines[0].ref], ['click', 'clicked-1']);
  });
  it('on expiry: no click ledgered', () => {
    const hit = awaitClickAndOpen(evt, paths, { exec: () => '', open: () => { throw new Error('no'); } });
    assert.equal(hit, false);
    assert.ok(!fs.existsSync(paths.ledger));
  });
});

describe('notify (end to end, mocked dispatch)', () => {
  it('ledgers the event with delivery info and resolved icon', async () => {
    fs.writeFileSync(path.join(paths.iconDir, 'success.png'), 'x');
    const evt = await notify(
      { kind: 'success', source: 'workplan', title: 'Step closed', message: 'v1.2', url: 'http://v/' },
      { paths, platform: 'darwin', terminalNotifier: '/tn', exec: okExec },
    );
    assert.equal(evt.delivery.method, 'terminal-notifier');
    assert.equal(evt.icon, path.join(paths.iconDir, 'success.png'));
    const { events } = readLedger({}, paths);
    assert.equal(events[0].id, evt.id);
    assert.equal(events[0].delivery.clickable, true);
  });
  it('unknown kind coerces to info', async () => {
    const evt = await notify({ kind: 'nope', title: 'T' }, { paths, platform: 'win32' });
    assert.equal(evt.kind, 'info');
  });
  it('muted source is ledgered as muted, never dispatched', async () => {
    fs.mkdirSync(path.dirname(paths.config), { recursive: true });
    fs.writeFileSync(paths.config, JSON.stringify({ sources: { spammy: false } }));
    const evt = await notify(
      { source: 'spammy', title: 'T' },
      { paths, platform: 'darwin', exec: () => { throw new Error('must not dispatch'); } },
    );
    assert.equal(evt.delivery.method, 'muted');
    assert.equal(readLedger({}, paths).events.length, 1);
  });
  it('globally disabled config mutes everything', async () => {
    fs.mkdirSync(path.dirname(paths.config), { recursive: true });
    fs.writeFileSync(paths.config, JSON.stringify({ enabled: false }));
    const evt = await notify({ title: 'T' }, { paths });
    assert.equal(evt.delivery.method, 'muted');
  });
  it('every kind has a default sound and icon mapping', () => {
    for (const k of KINDS) {
      assert.ok(DEFAULT_CONFIG.sounds[k], `sound for ${k}`);
      assert.ok(DEFAULT_CONFIG.icons[k], `icon for ${k}`);
    }
  });
});
