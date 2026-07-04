#!/usr/bin/env node
// openclaw-notify — fire a ledgered, click-through desktop notification.
//
//   openclaw-notify --kind success --source workplan --title "Step closed" \
//     --message "protocol v3.2 …" --url "http://127.0.0.1:7892/?plan=protocol"
//   openclaw-notify --list [n]     recent ledger entries
//   openclaw-notify --test         fire one test notification per kind
//
// Every event lands in ~/.openclaw/notifications/ledger.jsonl whether or not
// the popup could be delivered. Exit 0 = ledgered; --strict also requires
// popup delivery.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  notify, readLedger, notifyPaths, loadConfig, awaitClickAndOpen, KINDS,
} from '../lib/notify.mjs';

const argv = process.argv.slice(2);

function parseArgs(args) {
  const out = { _: [] };
  const takesValue = new Set([
    'kind', 'source', 'title', 'subtitle', 'message', 'url', 'icon', 'sound', 'list',
  ]);
  const aliases = { k: 'kind', t: 'title', m: 'message', s: 'source', u: 'url' };
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (!a.startsWith('-')) { out._.push(a); continue; }
    a = a.replace(/^--?/, '');
    if (aliases[a]) a = aliases[a];
    if (takesValue.has(a) && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      out[a] = args[++i];
    } else {
      out[a] = true;
    }
  }
  return out;
}

const args = parseArgs(argv);
const paths = notifyPaths();

if (args['_wait-click']) {
  // Internal: detached waiter (Linux). argv: _wait-click <json-event>
  const evt = JSON.parse(args._[0]);
  awaitClickAndOpen(evt, paths);
  process.exit(0);
}

if (args.help) {
  console.log(`usage: openclaw-notify [--kind ${KINDS.join('|')}] [--source NAME] --title T [--message M]
                       [--subtitle S] [--url URL] [--icon FILE] [--sound NAME] [--strict] [--json]
       openclaw-notify --list [N] [--json]
       openclaw-notify --test
ledger: ${paths.ledger}
config: ${paths.config}`);
  process.exit(0);
}

if (args.list) {
  const limit = /^\d+$/.test(String(args.list)) ? Number(args.list) : 20;
  const { events, total } = readLedger({ limit }, paths);
  if (args.json) {
    console.log(JSON.stringify({ events, total }, null, 2));
  } else if (!events.length) {
    console.log(`ledger empty (${paths.ledger})`);
  } else {
    for (const e of events) {
      const click = e.clicked_at ? ' [clicked]' : '';
      const url = e.url ? `\n    → ${e.url}` : '';
      console.log(`${e.ts}  ${e.kind.padEnd(7)} ${e.source.padEnd(12)} ${e.title} — ${e.message}${click}${url}`);
    }
    console.log(`\n${events.length}/${total} shown · ledger: ${paths.ledger}`);
  }
  process.exit(0);
}

const SELF = fileURLToPath(import.meta.url);

function spawnClickWaiter(evt) {
  spawn(process.execPath, [SELF, '--_wait-click', JSON.stringify(evt)], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

async function fire(input) {
  const evt = await notify(input, { spawnClickWaiter });
  if (args.json) console.log(JSON.stringify(evt, null, 2));
  else console.log(`ledgered ${evt.id} · delivery=${evt.delivery.method} clickable=${evt.delivery.clickable} ok=${evt.delivery.ok}`);
  if (args.strict && !evt.delivery.ok) process.exit(2);
  return evt;
}

if (args.test) {
  const cfg = loadConfig(paths);
  console.log(`config: ${paths.config} (enabled=${cfg.enabled !== false})`);
  for (const kind of KINDS) {
    await fire({
      kind,
      source: 'notify-test',
      title: `OpenClaw test — ${kind}`,
      subtitle: 'openclaw-notify --test',
      message: `test notification (${kind}); click should open the notifications ledger page`,
      url: 'http://127.0.0.1:3000/notifications',
    });
    await new Promise(r => setTimeout(r, 800));
  }
  process.exit(0);
}

if (!args.title) {
  console.error('missing --title (see --help)');
  process.exit(1);
}

await fire({
  kind: args.kind,
  source: args.source,
  title: args.title,
  subtitle: args.subtitle,
  message: args.message,
  url: args.url,
  icon: args.icon,
  sound: args.sound,
});
