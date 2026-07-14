// P2: LLM-extracted relationships were parsed + schema-validated then DISCARDED, so the
// concept graph ran on vault wikilinks only (all edges 'mentions'). Now they are persisted
// in state.db concept_edges and merged into the graph so spreading-activation gets typed edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExtractionStore } from '../lib/extraction-store.mjs';
import { createGraphCache } from '../bin/obsidian-graph-cache.mjs';

const tmpDb = () => join(mkdtempSync(join(tmpdir(), 'p2-')), 'state.db');

test('P2: LLM relationships are persisted (not discarded) and queryable', () => {
  const store = createExtractionStore({ dbPath: tmpDb() });
  store.storeExtractionResult('s1', {
    entities: [], themes: [], mentions: [], decisions: [],
    relationships: [
      { source: 'circling', target: 'mesh-collab', type: 'depends_on' },
      { source: 'D11', target: 'qwen-worker', type: 'contradicts' },
    ],
  });
  const edges = store.getConceptEdges();
  assert.equal(edges.length, 2);
  assert.deepEqual(edges.map(e => e.edge_type).sort(), ['contradicts', 'depends_on']);
  store.close && store.close();
});

test('P2: graph refresh merges the typed relationships as edges (not mentions-only)', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'vault-'));
  writeFileSync(join(vault, 'note.md'), '# note\n'); // minimal vault so buildGraph runs
  const mockStore = { getConceptEdges: () => [
    { source: 'A', target: 'B', edge_type: 'depends_on' },
    { source: 'B', target: 'C', edge_type: 'causes' },
  ] };
  const gc = createGraphCache({ dbPath: tmpDb(), vaultPath: vault, extractionStore: mockStore });
  const res = await gc.refreshCache();
  assert.ok(res.mergedEdges >= 2, `typed edges merged (got ${res.mergedEdges})`);
  const typed = gc.getEdges().filter(e => e.edge_type && e.edge_type !== 'mentions');
  assert.ok(typed.length >= 2, 'graph now carries non-mentions typed edges');
  gc.close && gc.close();
});
