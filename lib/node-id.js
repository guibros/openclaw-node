/**
 * node-id.js — the ONE node-id derivation.
 *
 * Review finding I13/P10 (2026-09-06): the same machine derived up to four
 * different ids depending on which process asked — env.sh stripped non-alnum
 * ("Guillaume's MacBook Pro.local" → "guillaumesmacbookpro"), node-init and the
 * task daemon replaced with dashes ("guillaume-s-macbook-pro-local"), the
 * memory daemon and health publisher fell back to the raw hostname (which even
 * fails the event envelope regex on a name with an apostrophe). Mission
 * Control then listed the lead twice, `preferred_nodes` never matched, and
 * daemon-state files were written under one id and read under another.
 *
 * Rule (identical to scripts/install/env.sh, which the installer persists into
 * openclaw.env so it never drifts on --update): explicit env wins; otherwise
 * the SHORT hostname, lowercased, with everything outside [a-z0-9-] removed.
 *
 * CommonJS on purpose: both the CJS daemons and the ESM daemons import it.
 */

'use strict';

const os = require('os');

/** Derive an id from a hostname the way env.sh does (`hostname -s | tr A-Z a-z | tr -cd a-z0-9-`). */
function deriveNodeId(hostname) {
  const short = String(hostname || '').split('.')[0];
  return short.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/**
 * The node's id: OPENCLAW_NODE_ID, else MESH_NODE_ID (legacy launcher var),
 * else derived from the hostname. Never empty.
 */
function resolveNodeId(env = process.env, hostname = os.hostname()) {
  const explicit = (env.OPENCLAW_NODE_ID || env.MESH_NODE_ID || '').trim();
  if (explicit) return explicit;
  return deriveNodeId(hostname) || 'node';
}

module.exports = { deriveNodeId, resolveNodeId };
