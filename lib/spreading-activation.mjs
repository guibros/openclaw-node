/**
 * Spreading activation algorithm for associative retrieval.
 * Propagates activation from seed nodes through a concept graph.
 *
 * @module lib/spreading-activation
 */

export const DEFAULT_STEPS = 3;
export const DEFAULT_DECAY = 0.7;
export const DEFAULT_THRESHOLD = 0.1;

/**
 * Resolve a numeric option: explicit > env var > fallback.
 * Handles 0 correctly (does not treat it as falsy).
 */
function resolveNum(explicit, envVar, fallback) {
  if (explicit != null) return Number(explicit);
  const env = process.env[envVar];
  if (env != null && env !== '') return Number(env);
  return fallback;
}

/**
 * Run spreading activation from seed nodes through a graph.
 *
 * @param {Map<string,number>|Object<string,number>} seeds - Initial activation values keyed by node ID.
 * @param {{ edgesFrom: (nodeId: string) => Array<{target: string, weight: number}> }} graph
 *   Graph interface. Must implement `edgesFrom(nodeId)`.
 * @param {{ steps?: number, decay?: number, threshold?: number }} opts
 * @returns {Array<[string, number]>} Sorted (descending) array of [nodeId, activation] above threshold.
 */
export function spreadingActivation(seeds, graph, opts = {}) {
  const steps = resolveNum(opts.steps, 'SPREAD_STEPS', DEFAULT_STEPS);
  const decay = resolveNum(opts.decay, 'SPREAD_DECAY', DEFAULT_DECAY);
  const threshold = resolveNum(opts.threshold, 'SPREAD_THRESHOLD', DEFAULT_THRESHOLD);

  // Normalize seeds to Map
  const activation = seeds instanceof Map
    ? new Map(seeds)
    : new Map(Object.entries(seeds));

  for (let step = 0; step < steps; step++) {
    const updates = new Map();

    for (const [nodeId, a] of activation) {
      const edges = graph.edgesFrom(nodeId);
      for (const edge of edges) {
        const contribution = a * (edge.weight ?? 1) * decay;
        const prev = updates.get(edge.target) ?? 0;
        updates.set(edge.target, Math.max(prev, contribution));
      }
    }

    // Merge updates into activation using Math.max
    for (const [nodeId, a] of updates) {
      const prev = activation.get(nodeId) ?? 0;
      activation.set(nodeId, Math.max(prev, a));
    }
  }

  return Array.from(activation.entries())
    .filter(([, a]) => a >= threshold)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Create a graph adapter from a graphCache (Step 5.4) for use with spreadingActivation.
 * Maps queryNeighbors('outgoing') → edgesFrom interface.
 *
 * @param {{ queryNeighbors: (nodeId: string, opts: {direction: string}) => Array<{target_id: string, weight: number}> }} graphCache
 * @returns {{ edgesFrom: (nodeId: string) => Array<{target: string, weight: number}> }}
 */
export function createGraphAdapter(graphCache) {
  return {
    edgesFrom(nodeId) {
      const rows = graphCache.queryNeighbors(nodeId, { direction: 'outgoing' });
      return rows.map(r => ({ target: r.target_id, weight: r.weight ?? 1 }));
    },
  };
}
