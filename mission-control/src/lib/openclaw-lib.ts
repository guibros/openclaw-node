/**
 * openclaw-lib.ts — load a root `lib/*.mjs` module from inside Mission Control.
 *
 * Several root modules have exactly one implementation by design (operator-auth's
 * signing, node-agent's tool loop). They are loaded at runtime by absolute path
 * rather than re-implemented in TypeScript: a second copy is the twin-divergence
 * pattern the 2026-08 review traced the exec bypass to.
 *
 * The resolution rule is the thing being shared here. It used to live inside
 * mesh-sign.ts; a second consumer means it either gets extracted or gets copied,
 * and a copied candidate list drifts the day the install layout changes.
 *
 * Candidates, first that exists wins:
 *   $OPENCLAW_LIB_DIR/<file>          (explicit)
 *   <cwd>/../../lib/<file>            (installed: workspace/projects/mission-control)
 *   <cwd>/../lib/<file>               (repo checkout: mission-control/)
 * Fails closed with a message naming every path tried.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

type Env = Record<string, string | undefined>;

export function libCandidates(file: string, env: Env = process.env, cwd = process.cwd()): string[] {
  const out: string[] = [];
  if (env.OPENCLAW_LIB_DIR) out.push(path.join(env.OPENCLAW_LIB_DIR, file));
  out.push(path.resolve(cwd, "..", "..", "lib", file));
  out.push(path.resolve(cwd, "..", "lib", file));
  return out;
}

const loaded = new Map<string, Promise<unknown>>();

/** Load (and memoize) a root lib module. Rejects with the candidate list when absent. */
export function loadOpenclawLib<T>(file: string): Promise<T> {
  const cached = loaded.get(file) as Promise<T> | undefined;
  if (cached) return cached;

  const promise = (async () => {
    const tried = libCandidates(file);
    for (const p of tried) {
      if (fs.existsSync(p)) {
        const url = pathToFileURL(p).href;
        // Runtime import by URL: not bundled, resolved by Node on the host.
        return (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as T;
      }
    }
    throw new Error(
      `${file} not found (tried: ${tried.join(", ")}). Set OPENCLAW_LIB_DIR to the directory holding lib/${file}.`,
    );
  })().catch((err) => {
    loaded.delete(file); // allow retry after a fix
    throw err;
  });

  loaded.set(file, promise);
  return promise as Promise<T>;
}
