#!/usr/bin/env node
/**
 * bin/observer.mjs — the five-layer uptime + memory-activity observer.
 *
 *   node bin/observer.mjs --sample      # take one sample + scan activity (the timer runs this)
 *   node bin/observer.mjs               # render all five layers, last 7d
 *   node bin/observer.mjs --since 30d   # window (Nd / Nh)
 *   node bin/observer.mjs --activity    # the timestamped memory-activity feed
 *   node bin/observer.mjs --json        # machine-readable rollup
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  sampleLayers, appendSample, scanMemoryActivity,
  readTimeline, readActivity, DEFAULT_LEDGER, DEFAULT_ACTIVITY,
} from '../lib/observer.mjs';

const { values } = parseArgs({
  options: {
    sample: { type: 'boolean', default: false },
    activity: { type: 'boolean', default: false },
    since: { type: 'string' },
    json: { type: 'boolean', default: false },
    ledger: { type: 'string' },
  },
});

const ledgerPath = values.ledger || DEFAULT_LEDGER;

function windowMs(s) {
  const m = String(s || '7d').match(/^(\d+)\s*([dh])$/);
  return m ? Number(m[1]) * (m[2] === 'd' ? 24 : 1) * 3600_000 : 7 * 24 * 3600_000;
}
function dur(ms) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), mm = min % 60;
  if (h < 24) return mm ? `${h}h${mm}m` : `${h}h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d}d${hh}h` : `${d}d`;
}
const pct = (v) => v == null ? '  ?  ' : `${String(v).padStart(4)}%`;

async function main() {
  if (values.sample) {
    const s = sampleLayers();
    const r = await appendSample(s, { ledgerPath });
    const a = await scanMemoryActivity();
    process.stdout.write(
      `[observer] vm/boot ok · node ${s.node.core_up}/${s.node.core_total} · ` +
      `interaction ${s.interaction.active ? 'ACTIVE' : s.interaction.state} · ` +
      `memory ${s.memory.daemon ? (s.memory.working ? 'WORKING' : 'IDLE') : 'DOWN'} ` +
      `(extraction ${s.memory.extraction_age_h ?? '?'}h) · +${a.appended} activity` +
      `${r.gapInscribed ? ' · GAP inscribed' : ''}\n`);
    return;
  }

  if (values.activity) {
    let text = '';
    try { text = await readFile(DEFAULT_ACTIVITY, 'utf8'); }
    catch { process.stdout.write('[observer] no activity feed yet (observer --sample builds it)\n'); return; }
    const a = readActivity(text, { since: Date.now() - windowMs(values.since) });
    if (values.json) { process.stdout.write(JSON.stringify(a, null, 2) + '\n'); return; }
    const lines = [
      `Memory activity — last ${values.since || '7d'} (${a.count} events)`,
      `  last LLM extraction: ${a.lastLlmExtraction || 'NONE in window — structured brain not forming memories'}`,
      `  by kind: ${Object.entries(a.byKind).map(([k, n]) => `${k}:${n}`).join('  ') || '(none)'}`,
      '', '  recent (newest last):',
    ];
    for (const e of a.events.slice(-20)) {
      const detail = Object.entries(e).filter(([k]) => !['ts', 'kind'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ');
      lines.push(`    ${e.ts.slice(5, 16)}  ${e.kind.padEnd(20)} ${detail}`);
    }
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }

  // default: five-layer status + uptime
  let text = '';
  try { text = await readFile(ledgerPath, 'utf8'); }
  catch { process.stdout.write(`[observer] no ledger yet at ${ledgerPath}\n(the timer runs 'observer --sample' every 60s; or run it once now)\n`); return; }
  const t = readTimeline(text, { since: Date.now() - windowMs(values.since) });
  if (values.json) { process.stdout.write(JSON.stringify(t, null, 2) + '\n'); return; }
  if (t.empty) { process.stdout.write('[observer] ledger has no samples in window\n'); return; }

  const L = t.layers;
  const out = [
    `OpenClaw observer — last ${values.since || '7d'}  (${t.samples} samples${t.lastSampleStale ? ', LAST SAMPLE STALE → currently OFF' : ''})`,
    '',
    `  layer                    uptime   now`,
    `  1 vm / system            ${pct(L.vm.uptimePct)}   ${L.vm.current}`,
    `  2 openclaw-node          ${pct(L.node.uptimePct)}   ${L.node.current}${L.node.down?.length ? `  (down: ${L.node.down.map((s) => s.replace('ai.openclaw.', '')).join(', ')})` : ''}`,
    `  3 active interaction     ${pct(L.interaction.uptimePct)}   ${L.interaction.current}${L.interaction.idle_s != null ? `  (idle ${L.interaction.idle_s}s)` : ''}`,
    `  4 memory system          ${pct(L.memory.uptimePct)}   ${L.memory.current}  (extraction ${L.memory.extraction_age_h ?? '?'}h old)`,
    `      └ of that, forming memories: ${pct(L.memory.workingPct)}`,
    '',
    `  downtime: ${dur(t.off.ms)} across gaps · ${t.off.reboots} reboot(s) · longest ${dur(t.off.longestMin * 60_000)}`,
  ];
  if (t.off.events.length) {
    out.push('  off periods (newest last):');
    for (const g of t.off.events.slice(-8)) {
      out.push(`    ✗ ${dur(g.minutes * 60_000).padEnd(7)} ${g.reason === 'reboot' ? '(reboot)' : '(down)  '}  ${g.from.slice(5, 16)} → ${g.to.slice(5, 16)}`);
    }
  }
  process.stdout.write(out.join('\n') + '\n');
}

main().catch((err) => { process.stderr.write(`[observer] fatal: ${err.message}\n`); process.exit(1); });
