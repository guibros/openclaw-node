/**
 * mesh-sign.ts — sign operator actions Mission Control publishes on the mesh bus.
 *
 * The task daemon now refuses unsigned cancel/complete/approve/reject (review
 * H-1/H-10: one unsigned message approved any task). Mission Control performs
 * those actions on the operator's behalf (abort, force-converge, cancel), so it
 * signs them with the node identity — the same key the CLI uses.
 *
 * There is exactly ONE signing implementation, lib/operator-auth.mjs at the
 * repo/workspace root. It is loaded at runtime by absolute path rather than
 * re-implemented here in TypeScript: a second ed25519 + canonicalization copy
 * is the twin-divergence pattern the review traced the exec bypass to. The
 * import is deliberately dynamic and outside the bundle.
 *
 * Where it is found is openclaw-lib.ts's rule, shared with the other root
 * module Mission Control loads. Fails closed: if none exists, signing throws and
 * the caller reports it — the daemon would refuse the unsigned request anyway.
 */

import { loadOpenclawLib } from "./openclaw-lib";

interface OperatorAuthModule {
  signOperatorRequest: <T extends object>(payload: T, opts?: Record<string, unknown>) => T & {
    node_id: string;
    timestamp: number;
    event_id: string;
    operator_action: true;
    signature: string;
    signer_pubkey: string;
  };
}

const loadOperatorAuth = () => loadOpenclawLib<OperatorAuthModule>("operator-auth.mjs");

/** Sign an operator request with the local node identity. Throws when signing is unavailable. */
export async function signOperatorRequest<T extends object>(payload: T) {
  const mod = await loadOperatorAuth();
  return mod.signOperatorRequest(payload);
}
