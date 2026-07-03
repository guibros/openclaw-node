#!/usr/bin/env node
/**
 * bin/node-watch.mjs — the node watcher CLI.
 *
 * Reports the REAL status of every key node element: WORKING / BROKEN / OFF /
 * UNKNOWN. Read-only. Never reports WORKING without an observed signal.
 * See docs/NODE_WATCH_SPEC.md.
 *
 *   node bin/node-watch.mjs                 # one-shot, all probes (incl. heavy)
 *   node bin/node-watch.mjs --watch         # continuous (default 60s; heavy probes skipped)
 *   node bin/node-watch.mjs --watch --interval 30 --deep
 *   node bin/node-watch.mjs --json --report ~/.openclaw/.node-watch.md
 *
 * Exit (one-shot): 0 = no BROKEN · 1 = ≥1 BROKEN · 3 = harness error.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { atomicWriteFile } from '../lib/atomic-write.mjs';
import { runWatch, formatTable, formatReport, formatHtml, STATUS } from '../lib/node-watch.mjs';

const { values } = parseArgs({
  options: {
    watch: { type: 'boolean', default: false },
    interval: { type: 'string', default: '60' },
    'deep-interval': { type: 'string', default: '900' },
    deep: { type: 'boolean', default: false },
    axis: { type: 'string' },
    json: { type: 'boolean', default: false },
    html: { type: 'boolean', default: false },
    report: { type: 'string' },
    'html-out': { type: 'string' },
    'json-out': { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

const DEFAULT_REPORT = path.join(os.homedir(), '.openclaw', '.node-watch.md');
const DEFAULT_HTML = path.join(os.homedir(), '.openclaw', '.node-watch.html');
// Machine snapshot read by the Mission Control /diagnostics Watch dropdown.
const DEFAULT_JSON = path.join(os.homedir(), '.openclaw', '.node-watch.json');

async function once(mode, includeHeavy) {
  const report = await runWatch({ mode, includeHeavy, axis: values.axis });
  if (values.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else if (!values.quiet) process.stdout.write(formatTable(report) + '\n');
  // An --axis run is a partial view: writing it to the default report/snapshot
  // would present filtered results as whole-node health (Mission Control reads
  // the JSON snapshot). Axis runs only write explicitly requested paths.
  try {
    const rp = values.report || (values.axis ? null : DEFAULT_REPORT);
    if (rp) {
      await mkdir(path.dirname(rp), { recursive: true });
      await atomicWriteFile(rp, formatReport(report));
    }
    // The JSON snapshot is the contract Mission Control reads — atomic so a
    // 15s poller never sees a torn write.
    const jp = values['json-out'] || (values.axis ? null : DEFAULT_JSON);
    if (jp) await atomicWriteFile(jp, JSON.stringify(report, null, 2));
  } catch (err) { process.stderr.write(`[node-watch] report write failed: ${err.message}\n`); }
  if (values.html) {
    try {
      const hp = values['html-out'] || DEFAULT_HTML;
      await mkdir(path.dirname(hp), { recursive: true });
      await atomicWriteFile(hp, formatHtml(report));
      if (!values.quiet && !values.json) process.stdout.write(`HTML dropdown view -> ${hp}\n`);
    } catch (err) { process.stderr.write(`[node-watch] html write failed: ${err.message}\n`); }
  }
  return report;
}

async function main() {
  if (!values.watch) {
    const report = await once('once', true); // one-shot runs every check, incl. heavy
    const broken = report.results.some((r) => r.status === STATUS.BROKEN);
    process.exit(broken ? 1 : 0);
  }

  const intervalMs = Math.max(5, Number(values.interval) || 60) * 1000;
  const deepIntervalMs = Math.max(intervalMs, (Number(values['deep-interval']) || 900) * 1000);
  process.stdout.write(`[node-watch] continuous monitor — light every ${intervalMs / 1000}s, full (incl. heavy) every ${deepIntervalMs / 1000}s (Ctrl-C to stop)\n`);
  let stopping = false;
  let running = false; // deep sweeps can outlast the interval — never overlap ticks
  let lastDeep = 0; // 0 => first tick is a full sweep
  const tick = async () => {
    if (stopping || running) return;
    running = true;
    try {
      const deep = values.deep || (Date.now() - lastDeep) >= deepIntervalMs;
      if (deep) lastDeep = Date.now();
      if (!values.json && !values.quiet) process.stdout.write('\x1b[2J\x1b[H'); // clear screen between frames
      try { await once('watch', deep); } catch (err) { process.stderr.write(`[node-watch] tick error: ${err.message}\n`); }
    } finally { running = false; }
  };
  await tick();
  const timer = setInterval(tick, intervalMs);
  const stop = () => { stopping = true; clearInterval(timer); process.stdout.write('\n[node-watch] stopped\n'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { process.stderr.write(`[node-watch] fatal: ${err.message}\n`); process.exit(3); });
