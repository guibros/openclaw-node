/**
 * deploy-trigger-auth.mjs — sign/verify `mesh.deploy.trigger` payloads.
 *
 * Closes the fleet-RCE hole (deep review 2026-07-03, C2): the deploy listener
 * runs `git reset --hard` + deploy on ANY message to `mesh.deploy.trigger`,
 * trusting it purely because it arrived on NATS. Anyone with NATS publish
 * access could push arbitrary code to every node.
 *
 * This wraps the existing ed25519 layer (lib/node-identity.mjs) into two
 * deploy-specific helpers. It is OPT-IN and backward-compatible:
 *
 *   OPENCLAW_REQUIRE_SIGNED_DEPLOY unset/0 (default)
 *     — verifyDeployTrigger accepts everything (current behavior), but logs a
 *       warning when a trigger is unsigned so the exposure is visible.
 *   OPENCLAW_REQUIRE_SIGNED_DEPLOY=1 (strict)
 *     — a trigger must carry a cryptographically valid signature AND be fresh
 *       AND be signed by a key on the deploy-trust allowlist. Fail-closed: if
 *       no allowlist is configured, every trigger is rejected.
 *
 * The allowlist is OPENCLAW_DEPLOY_TRUSTED_KEYS: comma-separated base64 raw
 * ed25519 public keys (the `publicKeyBase64` from getOrCreateIdentity / the
 * `signer_pubkey` field signEvent stamps). Provision it with the lead's key
 * before enabling strict mode.
 *
 * NOTE: not runtime-verifiable against a live mesh in this repo (the mesh is
 * dormant); covered by unit tests at the sign/verify level.
 */
import { signEvent, verifyEvent, getOrCreateIdentity } from './node-identity.mjs';

/** True when strict signed-deploy enforcement is requested. */
export function requireSignedDeploy() {
  return process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY === '1';
}

/** Parse the deploy-trust allowlist (base64 raw pubkeys) from env. */
export function trustedDeployKeys() {
  return (process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sign a deploy trigger with this node's identity key. Ensures a `timestamp`
 * (freshness + replay). Returns a new signed trigger object.
 *
 * @param {object} trigger
 * @param {object} [opts] — { identityDir }
 */
export function signDeployTrigger(trigger, opts = {}) {
  const withTs = trigger.timestamp ? trigger : { ...trigger, timestamp: new Date().toISOString() };
  const { privateKey } = getOrCreateIdentity(opts.identityDir);
  return signEvent(withTs, privateKey);
}

/**
 * Best-effort sign: returns a signed trigger, or the original (logged) if the
 * identity key is unavailable. Publishers use this so a signing failure never
 * blocks a deploy in non-strict fleets.
 */
export function maybeSignDeployTrigger(trigger, opts = {}) {
  try {
    return signDeployTrigger(trigger, opts);
  } catch (err) {
    (opts.log || console.warn)(`[deploy-auth] could not sign trigger (${err.message}) — publishing unsigned`);
    return trigger;
  }
}

/**
 * Verify a deploy trigger. Returns { ok, reason }.
 *
 * @param {object} trigger
 * @param {object} [opts]
 *   - requireSigned: override env (default = requireSignedDeploy())
 *   - trustedKeys: override env allowlist (array of base64 pubkeys)
 *   - verifyOpts: passthrough to node-identity verifyEvent (e.g. freshness window, now)
 *   - log: warn sink for the non-strict unsigned notice
 */
export function verifyDeployTrigger(trigger, opts = {}) {
  const strict = opts.requireSigned ?? requireSignedDeploy();

  if (!strict) {
    if (!trigger || !trigger.signature) {
      (opts.log || console.warn)(
        '[deploy-auth] SECURITY: accepting UNSIGNED deploy trigger. ' +
        'Set OPENCLAW_REQUIRE_SIGNED_DEPLOY=1 (+ OPENCLAW_DEPLOY_TRUSTED_KEYS) to require signatures.'
      );
      return { ok: true, reason: 'unsigned-allowed' };
    }
    return { ok: true, reason: 'signed-not-required' };
  }

  // Strict: cryptographic validity + freshness first.
  const res = verifyEvent(trigger, { requireSigned: true, checkFreshness: true, ...(opts.verifyOpts || {}) });
  const ok = typeof res === 'boolean' ? res : res.ok;
  if (!ok) return { ok: false, reason: (res && res.reason) || 'invalid-signature' };

  // A valid signature only proves SOMEONE signed it. The allowlist proves it's
  // a key we deploy-trust. Fail closed when unconfigured.
  const allow = opts.trustedKeys || trustedDeployKeys();
  if (!allow.length) return { ok: false, reason: 'no-trusted-deploy-keys-configured' };
  if (!allow.includes(trigger.signer_pubkey)) return { ok: false, reason: 'untrusted-signer' };

  return { ok: true, reason: 'verified' };
}
