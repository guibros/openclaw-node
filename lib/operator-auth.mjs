/**
 * operator-auth.mjs — Signed operator actions on the mesh bus.
 *
 * Problem this closes (review C-4/H-1/H-10 class): task approve/reject/cancel,
 * plan approve/abort, circling-gate decisions and plan-subtask updates were
 * plain request/reply subjects. Anyone holding the single shared NATS token —
 * every worker, every peer, any local process that can read openclaw.env —
 * could approve its own work, cancel a rival's task, or mass-assign a subtask
 * to "completed" and advance a plan. Authorization was reachability.
 *
 * Model:
 *   - An OPERATOR action is a request signed (ed25519, lib/node-identity) by a
 *     key in the operator allowlist. On the lead node the allowlist defaults to
 *     the node's own identity, so the local CLI and Mission Control — which read
 *     the same ~/.openclaw/identity.key — are trusted with zero configuration.
 *     Remote or unsigned requests are refused. That is the point.
 *   - An OWNER action is one the node that claimed the task performs on it
 *     (start, complete, release): node_id must equal task.owner, exactly the
 *     check handleFail already made.
 *   - Which actions accept which credential is decided in ONE place,
 *     authorizeTaskMutation(), so the daemon handlers stay one-liners and the
 *     matrix is unit-testable without the daemon.
 *
 * Known limit, stated plainly: the operator key is a NODE key. On a single
 * node that both executes and reviews tasks, the CLI's approval and the
 * worker's own completion sign with the same key, so this layer cannot tell a
 * human at the terminal from an agent on the same host. It does stop every
 * OTHER node and every unsigned caller — the actual forgery path. Per-user
 * keys are a later step.
 *
 * Wire shape of a signed operator request:
 *   { ...payload, node_id, timestamp, event_id, operator_action: true,
 *     signature, signer_pubkey }
 */

import crypto from 'node:crypto';
import { resolveNodeId } from './node-id.js';
import {
  DEFAULT_IDENTITY_DIR,
  getOrCreateIdentity,
  signEvent,
  verifySignedRequest,
  createSeenEventCache,
} from './node-identity.mjs';

/** Operator requests are consumed within seconds; anything older is a replay. */
export const OPERATOR_REQUEST_MAX_AGE_MS = Number(process.env.OPENCLAW_OPERATOR_MAX_AGE_MS || 5 * 60_000);

/** Envelope fields the signer adds; handlers must never treat them as payload. */
export const OPERATOR_ENVELOPE_FIELDS = Object.freeze([
  'node_id', 'timestamp', 'event_id', 'operator_action', 'signature', 'signer_pubkey', 'event_version',
]);

const defaultSeenCache = createSeenEventCache();

function localNodeId() {
  return resolveNodeId();
}

/**
 * Keys allowed to sign operator actions.
 * OPENCLAW_OPERATOR_TRUSTED_KEYS (comma-separated base64 pubkeys) wins; when
 * unset, the local node's own identity is the sole trusted operator key.
 * Returns [] (→ fail closed) only if no identity can be loaded either.
 */
export function trustedOperatorKeys(opts = {}) {
  const fromEnv = (opts.env ?? process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  try {
    const identity = opts.identity || getOrCreateIdentity(opts.identityDir || DEFAULT_IDENTITY_DIR);
    return identity?.publicKeyBase64 ? [identity.publicKeyBase64] : [];
  } catch {
    return [];
  }
}

/**
 * Sign a request as an operator action with the local node identity.
 * @param {object} payload — the request body (task_id, reason, result, ...)
 * @param {object} [opts] — identity | identityDir, nodeId, now (tests)
 */
export function signOperatorRequest(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') throw new TypeError('signOperatorRequest: payload must be an object');
  const identity = opts.identity || getOrCreateIdentity(opts.identityDir || DEFAULT_IDENTITY_DIR);
  const event = {
    ...stripOperatorEnvelope(payload),
    node_id: opts.nodeId || localNodeId(),
    timestamp: opts.now ?? Date.now(),
    event_id: crypto.randomUUID(),
    operator_action: true,
  };
  return signEvent(event, identity.privateKey);
}

/**
 * Verify an operator request: strict signature, short freshness window,
 * replay cache, and the operator allowlist. Fails closed.
 * @returns {{ ok: boolean, reason: string }}
 */
export function verifyOperatorRequest(req, opts = {}) {
  return verifySignedRequest(req, {
    trustedKeys: opts.trustedKeys || trustedOperatorKeys(opts),
    maxAgeMs: opts.maxAgeMs ?? OPERATOR_REQUEST_MAX_AGE_MS,
    seenIds: opts.seenIds !== undefined ? opts.seenIds : defaultSeenCache,
    verifyOpts: opts.verifyOpts,
    noTrustReason: 'no-trusted-operator-keys-configured',
  });
}

/** Payload without the signing envelope — what a handler may act on. */
export function stripOperatorEnvelope(params) {
  if (!params || typeof params !== 'object') return {};
  const out = { ...params };
  for (const k of OPERATOR_ENVELOPE_FIELDS) delete out[k];
  return out;
}

/**
 * The authorization matrix, in one place.
 *
 * @param {object} args
 * @param {string} args.action — for the reason string
 * @param {object} args.params — parsed request (may carry node_id and/or a signature)
 * @param {object|null} [args.task] — the task being mutated (needed for owner checks)
 * @param {boolean} [args.allowOwner=false] — task.owner may perform this
 * @param {boolean} [args.allowOperator=true] — a signed operator request may perform this
 * @param {Function} [args.verify] — override verifyOperatorRequest (tests)
 * @returns {{ ok: boolean, via?: 'owner'|'operator', reason?: string }}
 */
export function authorizeTaskMutation({ action, params, task = null, allowOwner = false, allowOperator = true, verify } = {}) {
  const p = params && typeof params === 'object' ? params : {};

  if (allowOwner) {
    const owner = task && task.owner;
    if (owner && p.node_id && p.node_id === owner) {
      // Fencing (P4-5): a task under lease accepts its owner only with the
      // CURRENT lease token. A worker that stalled, lost the lease, and comes
      // back after the task was re-claimed still has the right node_id — and
      // the wrong token.
      if (task.lease_token && p.lease_token !== task.lease_token) {
        return { ok: false, reason: `${action}: stale lease (node ${owner} no longer holds the current lease token)` };
      }
      return { ok: true, via: 'owner' };
    }
  }

  if (allowOperator) {
    const r = (verify || verifyOperatorRequest)(p);
    if (r.ok) return { ok: true, via: 'operator' };
    const ownerNote = allowOwner
      ? (task && task.owner ? `not-owner(${p.node_id || 'no node_id'}!=${task.owner}); ` : 'not-owner(unclaimed); ')
      : '';
    return { ok: false, reason: `${action}: ${ownerNote}operator:${r.reason}` };
  }

  return { ok: false, reason: `${action}: ${allowOwner ? 'not-owner' : 'not-authorized'}` };
}
