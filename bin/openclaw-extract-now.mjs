#!/usr/bin/env node
/**
 * openclaw-extract-now.mjs — Manual extraction trigger CLI.
 *
 * Connects to NATS, publishes `mesh.memory.extract_request`, exits.
 * Used by Tier 1 hooks (shell scripts) and as Tier 3 manual fallback.
 *
 * Usage:
 *   node bin/openclaw-extract-now.mjs [--triggered-by=SOURCE]
 *
 * Env:
 *   NATS_URL                 — NATS server (default: nats://localhost:4222)
 *   OPENCLAW_NODE_ID         — Node identifier (default: os.hostname())
 */

import os from 'node:os';
import { parseArgs } from 'node:util';
import { connect } from 'nats';
import { EXTRACT_SUBJECT, DEFAULT_NATS_URL, publishExtractDirect } from '../lib/publishers/publish-helper.mjs';

/**
 * Run the extraction trigger: connect to NATS, publish, disconnect.
 *
 * @param {object} [opts]
 * @param {string} [opts.triggeredBy] - source identifier
 * @param {string} [opts.natsUrl] - NATS server URL
 * @param {string} [opts.nodeId] - node identifier
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runExtractNow(opts = {}) {
  const natsUrl = opts.natsUrl || process.env.NATS_URL || DEFAULT_NATS_URL;
  const nodeId = opts.nodeId || process.env.OPENCLAW_NODE_ID || os.hostname();
  const triggeredBy = opts.triggeredBy || 'manual';

  try {
    const nc = await connect({ servers: natsUrl });
    publishExtractDirect(nc, nodeId, triggeredBy);
    await nc.flush();
    await nc.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// --- CLI entry ---
const isMain = process.argv[1] && (
  process.argv[1].endsWith('openclaw-extract-now.mjs') ||
  process.argv[1].endsWith('openclaw-extract-now')
);

if (isMain) {
  const { values } = parseArgs({
    options: {
      'triggered-by': { type: 'string', default: 'manual' },
    },
    strict: false,
  });

  const result = await runExtractNow({ triggeredBy: values['triggered-by'] });

  if (result.ok) {
    console.log(`extract request published (triggered_by=${values['triggered-by']})`);
  } else {
    console.error(`failed to publish: ${result.error}`);
    process.exit(1);
  }
}
