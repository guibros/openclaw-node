#!/usr/bin/env node
/**
 * bin/wakefulness.mjs — render the memory system's on/off/idle timeline.
 *
 *   node bin/wakefulness.mjs                 # last 7 days, human timeline
 *   node bin/wakefulness.mjs --since 30d     # window (Nd / Nh)
 *   node bin/wakefulness.mjs --json          # machine-readable rollup
 *   node bin/wakefulness.mjs --ping          # append one heartbeat now (manual;
 *                                            #   node-watch does this every tick)
 *
 * The heartbeat is normally driven by node-watch's continuous loop; --ping is
 * for a manual sample or a standalone timer.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { DEFAULT_LEDGER, readTimeline, appendWakeRecord, deriveWakeSample } from '../lib/wakefulness.mjs';

const { values } = parseArgs({
  options: {
    since: { type: 'string' },
    json: { type: 'boolean', default: false },
    ping: { type: 'boolean', default: false },
    ledger: { type: 'string' },
  },
});

const ledgerPath = values.ledger || DEFAULT_LEDGER;

function windowMs(s) {
  if (!s) return 7 * 24 * 3600_000;
  const m = String(s).match(/^(\d+)\s*([dh])$/);
  if (!m) return 7 * 24 * 3600_000;
  return Number(m[1]) * (m[2] === 'd' ? 24 : 1) * 3600_000;
}

function fmtDur(ms) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), mm = min % 60;
  if (h < 24) return mm ? `${h}h${mm}m` : `${h}h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d}d${hh}h` : `${d}d`;
}

async function main() {
  if (values.ping) {
    // Standalone ping: no node-watch report handy, so aliveness is unknown
    // (the daemon-state + extraction reads still populate the record).
    const sample = deriveWakeSample(null, {});
    const r = await appendWakeRecord(sample, { ledgerPath });
    process.stdout.write(`[wakefulness] ping: ${sample.daemon_state} · extraction ${sample.extraction_age_h ?? '?'}h old${r.gapInscribed ? ' · GAP inscribed' : ''}\n`);
    return;
  }

  let text = '';
  try { text = await readFile(ledgerPath, 'utf8'); }
  catch { process.stdout.write(`[wakefulness] no ledger yet at ${ledgerPath}\n(node-watch --watch writes one every tick; or run --ping)\n`); return; }

  const since = Date.now() - windowMs(values.since);
  const t = readTimeline(text, { since });

  if (values.json) { process.stdout.write(JSON.stringify(t, null, 2) + '\n'); return; }

  const cur = t.current;
  const curLine = !cur ? 'no data'
    : cur.state === 'OFF' ? `OFF for ${fmtDur(cur.forMin * 60_000)} (since ${cur.since})`
    : `${cur.state} · daemon ${cur.daemon}/${cur.daemon_state} · health ${cur.health ?? '?'}% · extraction ${cur.extraction_age_h ?? '?'}h old`;

  const lines = [
    `Wakefulness — last ${values.since || '7d'} (${t.heartbeats} heartbeats)`,
    `  now:        ${curLine}`,
    `  uptime:     ${t.uptimePct ?? '?'}%  (awake ${fmtDur(t.awakeMs)}, off ${fmtDur(t.offMs)})`,
    `  of awake:   ${t.workingPctOfAwake ?? '?'}% forming memories, rest idle`,
    `  reboots:    ${t.reboots}   longest gap: ${fmtDur(t.longestGapMin * 60_000)}`,
    '',
    '  timeline (newest last):',
  ];
  for (const iv of t.intervals.slice(-24)) {
    if (iv.kind === 'off') {
      lines.push(`    ✗ OFF    ${fmtDur(iv.minutes * 60_000).padEnd(7)} ${iv.reason === 'reboot' ? '(reboot)' : '(down)'}   ${iv.from.slice(5, 16)} → ${iv.to.slice(5, 16)}`);
    } else {
      lines.push(`    ● awake  ${fmtDur(Date.parse(iv.to) - Date.parse(iv.from)).padEnd(7)}          ${iv.from.slice(5, 16)} → ${iv.to.slice(5, 16)}`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((err) => { process.stderr.write(`[wakefulness] fatal: ${err.message}\n`); process.exit(1); });
