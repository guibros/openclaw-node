/**
 * openclaw-trigger.js — LibreChat trigger for OpenClaw extraction.
 *
 * Import this module in your LibreChat custom endpoint configuration
 * to fire extraction events after each conversation turn.
 *
 * Usage in LibreChat config:
 *   const { onResponse } = require('./openclaw-trigger.js');
 *   // Call onResponse() in your endpoint's post-response hook
 *
 * Or as a standalone trigger:
 *   node hooks/librechat/openclaw-trigger.js
 *
 * Env: NATS_URL, OPENCLAW_NODE_ID (same as all OpenClaw publishers)
 */

import { createNatsPublisher } from '../../lib/publishers/publish-helper.mjs';

let publisher = null;

/**
 * Get or create the shared publisher instance.
 * @returns {{ publish: function, close: function }}
 */
export function getPublisher() {
  if (!publisher) {
    publisher = createNatsPublisher();
  }
  return publisher;
}

/**
 * Call after a LibreChat response is sent to the user.
 * Fires a mesh.memory.extract_request event (fire-and-forget).
 */
export async function onResponse() {
  await getPublisher().publish('librechat-trigger');
}

/**
 * Clean up the NATS connection on process shutdown.
 */
export async function shutdown() {
  if (publisher) {
    await publisher.close();
    publisher = null;
  }
}

// --- Standalone CLI entry ---
const isMain = process.argv[1] && (
  process.argv[1].endsWith('openclaw-trigger.js') ||
  process.argv[1].endsWith('openclaw-trigger')
);

if (isMain) {
  const pub = getPublisher();
  await pub.publish('librechat-trigger-cli');
  await pub.close();
  console.log('extract request published (triggered_by=librechat-trigger-cli)');
}
