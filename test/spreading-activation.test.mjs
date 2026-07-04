import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  spreadingActivation,
  createGraphAdapter,
  DEFAULT_STEPS,
  DEFAULT_DECAY,
  DEFAULT_THRESHOLD,
} from '../lib/spreading-activation.mjs';

// --- helpers ---

/** Build a simple graph from an adjacency list: { A: [{ target, weight? }] } */
function makeGraph(adj) {
  return {
    edgesFrom(nodeId) {
      return (adj[nodeId] || []).map(e =>
        typeof e === 'string' ? { target: e, weight: 1 } : e
      );
    },
  };
}

// --- tests ---

describe('constants', () => {
  it('exports correct defaults per Block 6 frozen decisions', () => {
    assert.equal(DEFAULT_STEPS, 3);
    assert.equal(DEFAULT_DECAY, 0.7);
    assert.equal(DEFAULT_THRESHOLD, 0.1);
  });
});

describe('spreadingActivation', () => {
  it('propagates through a linear chain with decay', () => {
    // A → B → C → D, seed A=1.0, decay=0.5, steps=3
    const graph = makeGraph({
      A: ['B'],
      B: ['C'],
      C: ['D'],
    });
    const result = spreadingActivation({ A: 1.0 }, graph, {
      steps: 3,
      decay: 0.5,
      threshold: 0.01,
    });
    const map = new Map(result);

    assert.equal(map.get('A'), 1.0);      // seed preserved
    assert.equal(map.get('B'), 0.5);      // 1.0 * 0.5
    assert.equal(map.get('C'), 0.25);     // 0.5 * 0.5
    assert.equal(map.get('D'), 0.125);    // 0.25 * 0.5
    // Sorted descending
    assert.deepEqual(result.map(([id]) => id), ['A', 'B', 'C', 'D']);
  });

  it('activates all neighbors from a hub', () => {
    // A → B, A → C, A → D
    const graph = makeGraph({
      A: ['B', 'C', 'D'],
    });
    const result = spreadingActivation({ A: 1.0 }, graph, {
      steps: 1,
      decay: 0.7,
      threshold: 0.01,
    });
    const map = new Map(result);

    assert.equal(map.get('B'), 0.7);
    assert.equal(map.get('C'), 0.7);
    assert.equal(map.get('D'), 0.7);
  });

  it('uses Math.max (not sum) for diamond merge', () => {
    // A → B (weight 1), A → C (weight 1), B → D (weight 1), C → D (weight 1)
    // Seed A=1.0, decay=0.5, steps=2
    // After step 1: B=0.5, C=0.5
    // After step 2: D should be max(0.5*0.5, 0.5*0.5) = 0.25, NOT sum 0.5
    const graph = makeGraph({
      A: ['B', 'C'],
      B: ['D'],
      C: ['D'],
    });
    const result = spreadingActivation({ A: 1.0 }, graph, {
      steps: 2,
      decay: 0.5,
      threshold: 0.01,
    });
    const map = new Map(result);

    assert.equal(map.get('D'), 0.25, 'Math.max merge, not sum');
  });

  it('filters nodes below threshold', () => {
    // A → B → C, seed A=1.0, decay=0.5, threshold=0.3
    // B=0.5 (above 0.3), C=0.25 (below 0.3)
    const graph = makeGraph({
      A: ['B'],
      B: ['C'],
    });
    const result = spreadingActivation({ A: 1.0 }, graph, {
      steps: 2,
      decay: 0.5,
      threshold: 0.3,
    });
    const ids = result.map(([id]) => id);

    assert.ok(ids.includes('A'));
    assert.ok(ids.includes('B'));
    assert.ok(!ids.includes('C'), 'C should be filtered by threshold');
  });

  it('returns empty for empty graph', () => {
    const graph = makeGraph({});
    const result = spreadingActivation({ A: 1.0 }, graph, {
      steps: 3,
      decay: 0.7,
      threshold: 2.0, // seed itself is below threshold
    });
    assert.deepEqual(result, []);
  });

  it('respects edge weights', () => {
    // A → B (weight 2.0), A → C (weight 0.5)
    const graph = makeGraph({
      A: [
        { target: 'B', weight: 2.0 },
        { target: 'C', weight: 0.5 },
      ],
    });
    const result = spreadingActivation({ A: 1.0 }, graph, {
      steps: 1,
      decay: 0.7,
      threshold: 0.01,
    });
    const map = new Map(result);

    assert.equal(map.get('B'), 1.4);  // 1.0 * 2.0 * 0.7
    assert.equal(map.get('C'), 0.35); // 1.0 * 0.5 * 0.7
  });

  it('accepts Map seeds', () => {
    const graph = makeGraph({ A: ['B'] });
    const seeds = new Map([['A', 1.0]]);
    const result = spreadingActivation(seeds, graph, {
      steps: 1,
      decay: 0.7,
      threshold: 0.01,
    });
    const map = new Map(result);
    assert.equal(map.get('B'), 0.7);
  });
});

describe('createGraphAdapter', () => {
  it('wraps queryNeighbors into edgesFrom interface (bidirectional)', () => {
    const mockCache = {
      queryNeighbors(nodeId, opts) {
        // vault links are citations, not arrows — the walk must see both ends
        assert.equal(opts.direction, 'both');
        if (nodeId === 'A') {
          return [
            { source_id: 'A', target_id: 'B', edge_type: 'mentions', weight: 1 },
            { source_id: 'A', target_id: 'C', edge_type: 'derived_from', weight: 0.8 },
          ];
        }
        return [];
      },
    };
    const adapter = createGraphAdapter(mockCache);
    const edges = adapter.edgesFrom('A');

    assert.equal(edges.length, 2);
    assert.deepEqual(edges[0], { target: 'B', weight: 1 });
    assert.deepEqual(edges[1], { target: 'C', weight: 0.8 });

    // Empty node
    assert.deepEqual(adapter.edgesFrom('Z'), []);
  });

  it('an INCOMING edge (session-note → concept seed) activates the session note', () => {
    // The exact shape that made channel 5 return [] for every query: the
    // vault's only resolved edges pointed session→concept, and an
    // outgoing-only walk from concept seeds saw nothing.
    const mockCache = {
      queryNeighbors(nodeId, opts) {
        assert.equal(opts.direction, 'both');
        if (nodeId === 'nats') {
          return [{ source_id: 'session-note-x', target_id: 'nats', edge_type: 'mentions', weight: 1 }];
        }
        return [];
      },
    };
    const adapter = createGraphAdapter(mockCache);
    assert.deepEqual(adapter.edgesFrom('nats'), [{ target: 'session-note-x', weight: 1 }]);
  });
});
