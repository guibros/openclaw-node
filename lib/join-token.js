/**
 * join-token.js — the one codec for mesh join tokens.
 *
 * A join token is `base64url(JSON({ p: payload, s: hmac }))`. The lead signs the
 * payload with its private `~/.openclaw/.mesh-secret` (HMAC-SHA256) so it can
 * recognise tokens it issued; a joining worker has no copy of that secret, so
 * for the worker the token is a bootstrap hint handed over by the operator on
 * a channel they trust. Nothing in the payload is secret — it carries URLs,
 * roles and PUBLIC keys only (see bin/mesh-join-token.js).
 *
 * Payload versions:
 *   v1  nats, role, provider, repo, lead, issued              (no expiry)
 *   v2  + expires
 *   v3  + ssh_pubkey                (lead's SSH public key)
 *   v4  + lead_node_id, lead_identity_pubkey (raw base64 ed25519), nats_auth
 *       — Phase 7: the worker seeds its deploy/operator trust allowlists and its
 *       identity registry from lead_identity_pubkey, and learns which NATS auth
 *       mode (token | nkey) the lead's bus expects.
 */

const crypto = require('crypto');

const CURRENT_VERSION = 4;

function hmacOf(payload, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

/** Sign and encode a payload. Returns { token, payload, hmac }. */
function encodeJoinToken(payload, secret) {
  const hmac = hmacOf(payload, secret);
  const token = Buffer.from(JSON.stringify({ p: payload, s: hmac })).toString('base64url');
  return { token, payload, hmac };
}

/**
 * Decode a token without verifying it. Throws on malformed input.
 * @returns {{ payload: object, hmac: string }}
 */
function decodeJoinToken(token) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(token).trim(), 'base64url').toString('utf8'));
  } catch {
    throw new Error('join token is not base64url JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.p || typeof parsed.p !== 'object') {
    throw new Error('join token has no payload');
  }
  return { payload: parsed.p, hmac: typeof parsed.s === 'string' ? parsed.s : '' };
}

/** v1 tokens carry no expiry and never expire; every later version does. */
function isJoinTokenExpired(payload, now = Date.now()) {
  return typeof payload.expires === 'number' && payload.expires < now;
}

/** Lead-side check: was this token issued with our secret? Constant-time compare. */
function verifyJoinTokenHmac(token, secret) {
  const { payload, hmac } = decodeJoinToken(token);
  const expected = hmacOf(payload, secret);
  if (hmac.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(expected, 'utf8'));
}

module.exports = {
  CURRENT_VERSION,
  encodeJoinToken,
  decodeJoinToken,
  isJoinTokenExpired,
  verifyJoinTokenHmac,
};
