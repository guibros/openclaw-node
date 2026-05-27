#!/usr/bin/env node
/**
 * openclaw-trust-peer.mjs — CLI to register a peer node's pubkey in the identity registry.
 *
 * F-N3 fix: production deployments should default to STRICT mode (no TOFU).
 * That means every peer must have its pubkey explicitly registered before
 * its signed events will be accepted. This CLI is the operator-facing
 * tool that does the registering.
 *
 * Usage:
 *   bin/openclaw-trust-peer.mjs <nodeId> <pubkeyBase64>
 *     # add a peer to the registry
 *
 *   bin/openclaw-trust-peer.mjs --list
 *     # list current trusted peers
 *
 *   bin/openclaw-trust-peer.mjs --remove <nodeId>
 *     # forget a peer (e.g. after key rotation, see F-N10)
 *
 *   bin/openclaw-trust-peer.mjs --my-pubkey
 *     # print THIS node's pubkey (to share out-of-band so peers can trust us)
 *
 *   bin/openclaw-trust-peer.mjs --whoami
 *     # print this node's identity (nodeId + pubkey)
 *
 * Registry lives at $OPENCLAW_IDENTITY_DIR/identity-registry.json
 * (default ~/.openclaw/identity-registry.json), 0600 permissions.
 *
 * Onboarding flow for a new 3-node deployment (A, B, C):
 *   1. On each node, run `openclaw-trust-peer --my-pubkey` to get its pubkey.
 *   2. Share pubkeys over a trusted channel (e.g. Tailscale, in-person, signed email).
 *   3. On each node, run `openclaw-trust-peer <peerNodeId> <peerPubkey>` for
 *      each OTHER peer. Three nodes = each registers two peers = 6 calls total.
 *   4. Restart the memory daemon on each node (or send SIGHUP — TODO) so the
 *      newly-seeded registry is loaded.
 */

import os from 'node:os';
import { getOrCreateIdentity, createIdentityRegistry } from '../lib/node-identity.mjs';

/** Resolve this node's identifier (matches the convention in memory-subscriber.mjs). */
function getNodeId() {
  return process.env.OPENCLAW_NODE_ID || os.hostname();
}

function usage(code = 0) {
  process.stderr.write([
    'Usage:',
    '  openclaw-trust-peer <nodeId> <pubkeyBase64>',
    '  openclaw-trust-peer --list',
    '  openclaw-trust-peer --remove <nodeId>',
    '  openclaw-trust-peer --my-pubkey',
    '  openclaw-trust-peer --whoami',
    '',
    'Registry: $OPENCLAW_IDENTITY_DIR/identity-registry.json (default ~/.openclaw)',
    '',
  ].join('\n'));
  process.exit(code);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage(1);

  // --my-pubkey: print our own pubkey so peers can trust us.
  if (args[0] === '--my-pubkey') {
    const identity = getOrCreateIdentity();
    process.stdout.write(`${identity.publicKeyBase64}\n`);
    return;
  }

  // --whoami: nodeId + pubkey
  if (args[0] === '--whoami') {
    const identity = getOrCreateIdentity();
    process.stdout.write(`nodeId: ${getNodeId()}\npubkey: ${identity.publicKeyBase64}\n`);
    return;
  }

  // Build the registry. We always use strict mode here; this CLI is the
  // *seeding* path that makes strict-mode deployments work.
  const registry = createIdentityRegistry({ mode: 'strict' });

  // --list: dump current registry
  if (args[0] === '--list') {
    const entries = [...registry.entries()];
    if (entries.length === 0) {
      process.stdout.write('(no trusted peers)\n');
      return;
    }
    for (const [nodeId, record] of entries) {
      process.stdout.write(`${nodeId}  ${record.pubkey}  (added ${record.addedAt} via ${record.addedBy})\n`);
    }
    return;
  }

  // --remove <nodeId>: forget a peer
  if (args[0] === '--remove') {
    if (!args[1]) usage(1);
    const nodeId = args[1];
    const removed = registry.remove(nodeId);
    if (removed) process.stdout.write(`removed ${nodeId}\n`);
    else process.stdout.write(`${nodeId} not in registry\n`);
    return;
  }

  // Positional: nodeId pubkey
  if (args.length !== 2 || args[0].startsWith('--')) usage(1);
  const [nodeId, pubkey] = args;
  if (!pubkey || pubkey.length < 32) {
    process.stderr.write(`error: pubkey looks too short (got ${pubkey?.length || 0} chars; expected base64 ed25519 pubkey ~44)\n`);
    process.exit(2);
  }
  const added = registry.trust(nodeId, pubkey, 'operator');
  if (added) {
    process.stdout.write(`trusted: ${nodeId}\n`);
  } else {
    const existing = registry.get(nodeId);
    if (existing.pubkey === pubkey) {
      process.stdout.write(`${nodeId} already trusted with same pubkey (no-op)\n`);
    } else {
      process.stderr.write(`refused: ${nodeId} already registered with a DIFFERENT pubkey.\n`);
      process.stderr.write(`  existing: ${existing.pubkey}\n`);
      process.stderr.write(`  attempted: ${pubkey}\n`);
      process.stderr.write(`If this is a legitimate key rotation, remove the old entry first:\n`);
      process.stderr.write(`  openclaw-trust-peer --remove ${nodeId}\n`);
      process.exit(3);
    }
  }
}

main().catch(err => {
  process.stderr.write(`fatal: ${err?.message || err}\n`);
  process.exit(1);
});
