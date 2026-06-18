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

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { runWatch, formatTable, formatReport, formatHtml, STATUS } from '../lib/node-watch.mjs';

const { values } = parseArgs({
  options: {
    watch: { type: 'boolean', default: false },
    interval: { type: 'string', default: '60' },
    deep: { type: 'boolean', default: false },
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

async function once(mode) {
  const report = await runWatch({ mode, includeHeavy: mode === 'once' || values.deep });
  if (values.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else if (!values.quiet) process.stdout.write(formatTable(report) + '\n');
  try {
    const rp = values.report || DEFAULT_REPORT;
    await mkdir(path.dirname(rp), { recursive: true });
    await writeFile(rp, formatReport(report), 'utf8');
    // Always emit the JSON snapshot (the contract Mission Control reads).
    await writeFile(values['json-out'] || DEFAULT_JSON, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) { process.stderr.write(`[node-watch] report write failed: ${err.message}\n`); }
  if (values.html) {
    try {
      const hp = values['html-out'] || DEFAULT_HTML;
      await mkdir(path.dirname(hp), { recursive: true });
      await writeFile(hp, formatHtml(report), 'utf8');
      if (!values.quiet && !values.json) process.stdout.write(`HTML dropdown view -> ${hp}\n`);
    } catch (err) { process.stderr.write(`[node-watch] html write failed: ${err.message}\n`); }
  }
  return report;
}

async function main() {
  if (!values.watch) {
    const report = await once('once');
    const broken = report.results.some((r) => r.status === STATUS.BROKEN);
    process.exit(broken ? 1 : 0);
  }

  const intervalMs = Math.max(5, Number(values.interval) || 60) * 1000;
  process.stdout.write(`[node-watch] continuous mode, every ${intervalMs / 1000}s (Ctrl-C to stop)\n`);
  let stopping = false;
  const tick = async () => {
    if (stopping) return;
    if (!values.json) process.stdout.write('\x1b[2J\x1b[H'); // clear screen between frames
    try { await once('watch'); } catch (err) { process.stderr.write(`[node-watch] tick error: ${err.message}\n`); }
  };
  await tick();
  const timer = setInterval(tick, intervalMs);
  const stop = () => { stopping = true; clearInterval(timer); process.stdout.write('\n[node-watch] stopped\n'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { process.stderr.write(`[node-watch] fatal: ${err.message}\n`); process.exit(3); });
