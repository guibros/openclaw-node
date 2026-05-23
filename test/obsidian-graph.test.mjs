import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  walkVault,
  parseNote,
  extractWikilinks,
  buildGraph,
} from '../lib/obsidian-graph.mjs';

describe('walkVault', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'obsidian-graph-walk-'));
    await mkdir(join(tmpDir, 'concepts'), { recursive: true });
    await mkdir(join(tmpDir, 'decisions'), { recursive: true });
    await writeFile(join(tmpDir, 'concepts', 'nats.md'), '# NATS\n');
    await writeFile(join(tmpDir, 'concepts', 'sqlite.md'), '# SQLite\n');
    await writeFile(join(tmpDir, 'decisions', 'use-nats.md'), '# Use NATS\n');
    await writeFile(join(tmpDir, 'not-markdown.txt'), 'ignored');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('finds .md files across subdirectories', async () => {
    const notes = await walkVault(tmpDir);
    assert.equal(notes.length, 3);
    const ids = notes.map(n => n.id).sort();
    assert.deepStrictEqual(ids, ['nats', 'sqlite', 'use-nats']);
  });

  it('assigns correct subdirectory to each file', async () => {
    const notes = await walkVault(tmpDir);
    const nats = notes.find(n => n.id === 'nats');
    assert.equal(nats.subdirectory, 'concepts');
    const decision = notes.find(n => n.id === 'use-nats');
    assert.equal(decision.subdirectory, 'decisions');
  });

  it('returns empty array for non-existent vault', async () => {
    const notes = await walkVault(join(tmpDir, 'nonexistent'));
    assert.deepStrictEqual(notes, []);
  });
});

describe('parseNote', () => {
  it('parses frontmatter and body', () => {
    const content = `---
type: concept
mention_count: 12
related: [\"[[SQLite]]\", \"[[JetStream]]\"]
---

# NATS

Some body text with a [[wikilink]].
`;
    const { frontmatter, body } = parseNote(content);
    assert.equal(frontmatter.type, 'concept');
    assert.equal(frontmatter.mention_count, 12);
    assert.ok(Array.isArray(frontmatter.related));
    assert.ok(body.includes('# NATS'));
    assert.ok(body.includes('[[wikilink]]'));
  });

  it('returns null frontmatter for notes without frontmatter', () => {
    const content = '# Plain Note\n\nNo frontmatter here.\n';
    const { frontmatter, body } = parseNote(content);
    assert.equal(frontmatter, null);
    assert.ok(body.includes('# Plain Note'));
  });

  it('handles malformed YAML gracefully', () => {
    const content = '---\n: invalid: yaml: [\n---\n\nBody text.\n';
    const { frontmatter, body } = parseNote(content);
    assert.equal(frontmatter, null);
    assert.ok(body.includes('Body text.'));
  });
});

describe('extractWikilinks', () => {
  it('extracts simple [[target]] wikilinks', () => {
    const text = 'See [[NATS]] and [[SQLite]] for details.';
    const links = extractWikilinks(text);
    assert.deepStrictEqual(links, ['NATS', 'SQLite']);
  });

  it('handles [[target|display text]] form', () => {
    const text = 'See [[NATS JetStream|JetStream]] for messaging.';
    const links = extractWikilinks(text);
    assert.deepStrictEqual(links, ['NATS JetStream']);
  });

  it('returns empty array for text with no wikilinks', () => {
    const links = extractWikilinks('No links here.');
    assert.deepStrictEqual(links, []);
  });
});

describe('buildGraph', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'obsidian-graph-build-'));
    await mkdir(join(tmpDir, 'concepts'), { recursive: true });

    // Note 1: NATS with frontmatter and body wikilinks
    await writeFile(
      join(tmpDir, 'concepts', 'nats.md'),
      `---
type: concept
mention_count: 15
related: [\"[[SQLite]]\"]
---

# NATS

Used with [[JetStream]] for event streaming.
`
    );

    // Note 2: SQLite with no wikilinks
    await writeFile(
      join(tmpDir, 'concepts', 'sqlite.md'),
      `---
type: concept
mention_count: 8
---

# SQLite

Local database engine.
`
    );

    // Note 3: JetStream with edge_types in frontmatter
    await writeFile(
      join(tmpDir, 'concepts', 'jetstream.md'),
      `---
type: concept
mention_count: 10
edge_types:
  NATS: derived_from
---

# JetStream

Built on [[NATS]]. See also [[SQLite]].
`
    );
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('builds nodes from all notes', async () => {
    const { nodes } = await buildGraph(tmpDir);
    assert.equal(nodes.size, 3);
    assert.ok(nodes.has('nats'));
    assert.ok(nodes.has('sqlite'));
    assert.ok(nodes.has('jetstream'));
  });

  it('node includes frontmatter fields', async () => {
    const { nodes } = await buildGraph(tmpDir);
    const nats = nodes.get('nats');
    assert.equal(nats.type, 'concept');
    assert.equal(nats.mention_count, 15);
    assert.equal(nats.subdirectory, 'concepts');
  });

  it('creates edges from body wikilinks', async () => {
    const { edges } = await buildGraph(tmpDir);
    const natsToJetstream = edges.find(
      e => e.source === 'nats' && e.target === 'JetStream'
    );
    assert.ok(natsToJetstream, 'Expected edge from nats to JetStream');
    assert.equal(natsToJetstream.type, 'mentions');
  });

  it('creates edges from frontmatter related field', async () => {
    const { edges } = await buildGraph(tmpDir);
    const natsToSqlite = edges.find(
      e => e.source === 'nats' && e.target === 'SQLite'
    );
    assert.ok(natsToSqlite, 'Expected edge from nats to SQLite via related');
  });

  it('uses edge_types from frontmatter when present', async () => {
    const { edges } = await buildGraph(tmpDir);
    const jsToNats = edges.find(
      e => e.source === 'jetstream' && e.target === 'NATS'
    );
    assert.ok(jsToNats, 'Expected edge from jetstream to NATS');
    assert.equal(jsToNats.type, 'derived_from');
  });

  it('defaults to mentions type when no edge_types mapping', async () => {
    const { edges } = await buildGraph(tmpDir);
    const jsToSqlite = edges.find(
      e => e.source === 'jetstream' && e.target === 'SQLite'
    );
    assert.ok(jsToSqlite, 'Expected edge from jetstream to SQLite');
    assert.equal(jsToSqlite.type, 'mentions');
  });

  it('returns empty graph for empty vault', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'obsidian-graph-empty-'));
    try {
      const { nodes, edges } = await buildGraph(emptyDir);
      assert.equal(nodes.size, 0);
      assert.equal(edges.length, 0);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
