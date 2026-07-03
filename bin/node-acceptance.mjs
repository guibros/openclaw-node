#!/usr/bin/env node
/**
 * bin/node-acceptance.mjs — the node's global system check (deployment acceptance gate).
 *
 * Hard-tests a deployed OpenClaw node's components + functioning (memory, LLM
 * backing, network) and reports. Probes the running runtime (never source).
 * See docs/NODE_ACCEPTANCE.md. Portable: paths/URLs resolve from env.
 *
 * Usage:
 *   node bin/node-acceptance.mjs                         # full single-node gate
 *   node bin/node-acceptance.mjs --axis llm              # one axis only
 *   node bin/node-acceptance.mjs --no-mutate             # skip probes that write synthetic data
 *   node bin/node-acceptance.mjs --deep                  # include invasive probes
 *   node bin/node-acceptance.mjs --json --report /tmp/r.md
 *
 * Exit: 0 ACCEPTED · 1 REJECTED · 2 INCOMPLETE · 3 harness error.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { runAcceptance, formatTable, formatReport } from '../lib/node-acceptance.mjs';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'single-node' },
    axis: { type: 'string' },
    json: { type: 'boolean', default: false },
    report: { type: 'string' },
    quiet: { type: 'boolean', default: false },
    'no-mutate': { type: 'boolean', default: false },
    deep: { type: 'boolean', default: false },
  },
});

const DEFAULT_REPORT = path.join(os.homedir(), '.openclaw', '.node-acceptance.md');

async function main() {
  const report = await runAcceptance({
    profile: values.profile,
    axis: values.axis,
    mutate: !values['no-mutate'],
    deep: values.deep,
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (!values.quiet) {
    process.stdout.write(formatTable(report) + '\n');
  }

  // An axis run is a partial view — it must not clobber the full-gate evidence file.
  const reportPath = values.report || (values.axis ? null : DEFAULT_REPORT);
  if (reportPath) {
    try {
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, formatReport(report), 'utf8');
      if (!values.quiet && !values.json) process.stdout.write(`Evidence -> ${reportPath}\n`);
    } catch (err) {
      process.stderr.write(`[node-acceptance] could not write report: ${err.message}\n`);
    }
  }

  process.exit(report.gate.exitCode);
}

main().catch(err => {
  process.stderr.write(`[node-acceptance] fatal: ${err.message}\n`);
  process.exit(3);
});
