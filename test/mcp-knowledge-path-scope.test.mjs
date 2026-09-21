/**
 * test/mcp-knowledge-path-scope.test.mjs — path-prefix scoping on knowledge search
 * (openviking-adopt Block 1).
 *
 * Runs WITHOUT the embedding model: chunks are inserted with synthetic unit
 * vectors and searched through `precomputedEmbedding`, so the scoping logic
 * (prefix normalization, the LIKE clause, the over-fetch) is what's under test.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  initDatabase,
  normalizePathPrefix,
  pathPrefixClause,
  semanticSearch,
  findRelated,
  EMBEDDING_DIM,
} from '../lib/mcp-knowledge/core.mjs';

// A unit vector pointing along axis `axis`, nudged by `noise` on axis 0 so
// distances are distinct and deterministic.
function unitVec(axis, noise = 0) {
  const v = new Float32Array(EMBEDDING_DIM);
  v[axis] = 1;
  v[0] += noise;
  const n = Math.hypot(...v);
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function seed(db, docs) {
  const insertDoc = db.prepare('INSERT INTO documents (path, content_hash, last_indexed, chunk_count) VALUES (?, ?, ?, 1)');
  const insertChunk = db.prepare('INSERT INTO chunks (doc_path, section, text, snippet) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const d of docs) {
      insertDoc.run(d.path, 'h-' + d.path, Date.now());
      const info = insertChunk.run(d.path, '(top)', d.text, d.text.slice(0, 50));
      db.prepare(`INSERT INTO chunk_vectors VALUES (${info.lastInsertRowid}, ?)`).run(Buffer.from(d.vec.buffer));
    }
  });
  tx();
}

describe('normalizePathPrefix', () => {
  it('returns null for nothing to scope by', () => {
    assert.equal(normalizePathPrefix(undefined), null);
    assert.equal(normalizePathPrefix(''), null);
    assert.equal(normalizePathPrefix(['', '  ']), null);
  });
  it('strips ./ and trailing slashes, dedups, accepts arrays', () => {
    assert.deepEqual(normalizePathPrefix('./memory/'), ['memory']);
    assert.deepEqual(normalizePathPrefix(['memory', 'memory/', 'projects/arcane/lore/']), ['memory', 'projects/arcane/lore']);
  });
  it('refuses absolute paths and .. segments', () => {
    assert.throws(() => normalizePathPrefix('/etc'), /relative/);
    assert.throws(() => normalizePathPrefix('memory/../secrets'), /\.\./);
  });
});

describe('pathPrefixClause', () => {
  it('matches the directory itself and its subtree, escaping LIKE wildcards', () => {
    const { sql, params } = pathPrefixClause(['mem_ory'], 'p');
    assert.match(sql, /p = \? OR p LIKE \? ESCAPE/);
    assert.deepEqual(params, ['mem_ory', 'mem\\_ory/%']);
  });
  it('is empty for no prefixes', () => {
    assert.deepEqual(pathPrefixClause(null), { sql: '', params: [] });
  });
});

describe('semanticSearch with pathPrefix', () => {
  let db;
  before(() => {
    db = initDatabase(':memory:');
    seed(db, [
      { path: 'memory/2026-09-01.md', text: 'daily note one', vec: unitVec(1, 0.05) },
      { path: 'memory/2026-09-02.md', text: 'daily note two', vec: unitVec(1, 0.10) },
      { path: 'memory-plan/plans/x/ROADMAP.md', text: 'roadmap', vec: unitVec(1, 0.01) },
      { path: 'projects/arcane/lore/FACTIONS.md', text: 'factions', vec: unitVec(2, 0.02) },
      { path: 'projects/arcane/notes/todo.md', text: 'todo', vec: unitVec(2, 0.30) },
      { path: 'SOUL.md', text: 'soul', vec: unitVec(3) },
    ]);
  });
  after(() => db.close());

  it('unscoped search returns hits across directories', async () => {
    const hits = await semanticSearch(db, 'q', 10, { precomputedEmbedding: unitVec(1) });
    assert.equal(hits.length, 6);
    assert.ok(hits.some((h) => h.path.startsWith('memory/')));
    assert.ok(hits.some((h) => h.path.startsWith('projects/')));
  });

  it('scoped search returns only hits under the prefix, not lookalike siblings', async () => {
    const hits = await semanticSearch(db, 'q', 10, { precomputedEmbedding: unitVec(1), pathPrefix: 'memory/' });
    assert.equal(hits.length, 2);
    assert.ok(hits.every((h) => h.path.startsWith('memory/')), JSON.stringify(hits));
    // memory-plan/ shares the leading characters and must NOT match.
    assert.ok(!hits.some((h) => h.path.startsWith('memory-plan')));
  });

  it('over-fetches so a sparse subtree still fills the limit', async () => {
    // Nearest to axis 2 are the projects/ docs, but memory/ docs are farther:
    // a naive k=limit scan would miss them. The scope must still find both.
    const hits = await semanticSearch(db, 'q', 2, { precomputedEmbedding: unitVec(2), pathPrefix: ['memory'] });
    assert.equal(hits.length, 2);
    assert.ok(hits.every((h) => h.path.startsWith('memory/')));
  });

  it('accepts several prefixes', async () => {
    const hits = await semanticSearch(db, 'q', 10, { precomputedEmbedding: unitVec(1), pathPrefix: ['memory', 'projects/arcane/lore'] });
    assert.deepEqual(hits.map((h) => h.path).sort(), ['memory/2026-09-01.md', 'memory/2026-09-02.md', 'projects/arcane/lore/FACTIONS.md']);
  });

  it('findRelated honours the prefix', async () => {
    const rel = await findRelated(db, 'memory/2026-09-01.md', 10, { pathPrefix: 'projects' });
    assert.ok(Array.isArray(rel));
    assert.ok(rel.length >= 1);
    assert.ok(rel.every((h) => h.path.startsWith('projects/')));
  });
});
