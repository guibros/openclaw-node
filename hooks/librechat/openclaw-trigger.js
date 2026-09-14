/**
 * openclaw-trigger.js — LibreChat-tagged trigger for OpenClaw extraction.
 *
 * This is NOT loadable by LibreChat. LibreChat's `custom` endpoints are
 * YAML-declared HTTP provider configs and the server never loads user-supplied
 * JS, so it has no post-response hook to call into. Verified against LibreChat
 * v0.8.8-rc3 (2026-09-14). See docs/PUBLISHERS.md for the supported paths.
 *
 * Standalone trigger (Tier 3 — cron, keybinding, wrapper script):
 *   node hooks/librechat/openclaw-trigger.js
 *
 * onResponse() remains exported for a proxy or wrapper you control that sits in
 * front of LibreChat — not for LibreChat itself.
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
