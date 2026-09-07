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
 * Location candidates, first that exists wins:
 *   $OPENCLAW_LIB_DIR/operator-auth.mjs             (explicit)
 *   <cwd>/../../lib/operator-auth.mjs               (installed: workspace/projects/mission-control)
 *   <cwd>/../lib/operator-auth.mjs                  (repo checkout: mission-control/)
 * Fails closed: if none exists, signing throws and the caller reports it —
 * the daemon would refuse the unsigned request anyway.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

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

let modulePromise: Promise<OperatorAuthModule> | null = null;

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.OPENCLAW_LIB_DIR) out.push(path.join(process.env.OPENCLAW_LIB_DIR, "operator-auth.mjs"));
  const cwd = process.cwd();
  out.push(path.resolve(cwd, "..", "..", "lib", "operator-auth.mjs"));
  out.push(path.resolve(cwd, "..", "lib", "operator-auth.mjs"));
  return out;
}

async function loadOperatorAuth(): Promise<OperatorAuthModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      for (const p of candidates()) {
        if (fs.existsSync(p)) {
          const url = pathToFileURL(p).href;
          // Runtime import by URL: not bundled, resolved by Node on the host.
          return (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as OperatorAuthModule;
        }
      }
      throw new Error(
        `operator-auth.mjs not found (tried: ${candidates().join(", ")}). ` +
          "Set OPENCLAW_LIB_DIR to the directory holding lib/operator-auth.mjs.",
      );
    })().catch((err) => {
      modulePromise = null; // allow retry after a fix
      throw err;
    });
  }
  return modulePromise;
}

/** Sign an operator request with the local node identity. Throws when signing is unavailable. */
export async function signOperatorRequest<T extends object>(payload: T) {
  const mod = await loadOperatorAuth();
  return mod.signOperatorRequest(payload);
}
