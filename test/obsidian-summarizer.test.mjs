import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import {
  DEFAULT_CONCEPT_THRESHOLD,
  getConceptThreshold,
  slugifyName,
  buildConceptFrontmatter,
  buildConceptBody,
  extractExistingSummary,
  generateConceptSummary,
  queryConceptData,
  generateConceptNotes,
} from '../lib/obsidian-summarizer.mjs';

describe('slugifyName', () => {
  it('sanitizes entity names for filesystem use', () => {
    assert.equal(slugifyName('NATS JetStream'), 'nats-jetstream');
    assert.equal(slugifyName('The CAS Bug!'), 'the-cas-bug');
    assert.equal(slugifyName('lib/mcp-knowledge/core.mjs'), 'lib-mcp-knowledge-core-mjs');
    assert.equal(slugifyName('  spaces  '), 'spaces');
    assert.equal(slugifyName('café-résumé'), 'caf-r-sum');
  });
});

describe('getConceptThreshold', () => {
  it('returns default when no options or env', () => {
    const original = process.env.OBSIDIAN_CONCEPT_THRESHOLD;
    delete process.env.OBSIDIAN_CONCEPT_THRESHOLD;
    try {
      assert.equal(getConceptThreshold(), DEFAULT_CONCEPT_THRESHOLD);
      assert.equal(DEFAULT_CONCEPT_THRESHOLD, 5);
    } finally {
      if (original !== undefined) process.env.OBSIDIAN_CONCEPT_THRESHOLD = original;
    }
  });

  it('prefers explicit option over env and default', () => {
    const original = process.env.OBSIDIAN_CONCEPT_THRESHOLD;
    process.env.OBSIDIAN_CONCEPT_THRESHOLD = '10';
    try {
      assert.equal(getConceptThreshold({ threshold: 3 }), 3);
    } finally {
      if (original !== undefined) {
        process.env.OBSIDIAN_CONCEPT_THRESHOLD = original;
      } else {
        delete process.env.OBSIDIAN_CONCEPT_THRESHOLD;
      }
    }
  });
});

describe('buildConceptFrontmatter', () => {
  it('produces valid YAML frontmatter with all fields', () => {
    const entity = {
      name: 'NATS JetStream',
      type: 'technology',
      first_seen: '2026-05-10T10:00:00Z',
      last_seen: '2026-05-20T14:30:00Z',
      mention_count: 47,
    };
    const related = ['Mesh Coordination', 'The CAS Bug'];
    const fm = buildConceptFrontmatter(entity, related, 0.85);

    assert.ok(fm.startsWith('---'));
    assert.ok(fm.endsWith('---'));
    assert.ok(fm.includes('type: concept'));
    assert.ok(fm.includes('aliases: ["NATS JetStream"]'));
    assert.ok(fm.includes('entity_type: technology'));
    assert.ok(fm.includes('mention_count: 47'));
    assert.ok(fm.includes('salience: 0.85'));
    assert.ok(fm.includes('"[[mesh-coordination|Mesh Coordination]]"'));
    assert.ok(fm.includes('"[[the-cas-bug|The CAS Bug]]"'));
  });

  it('filters related links to resolvable targets when given the run set (repair 2.8)', () => {
    const entity = { name: 'Alpha', type: 'concept', first_seen: 't', last_seen: 't', mention_count: 9 };
    const fm = buildConceptFrontmatter(entity, ['Known Concept', 'Ghost Concept'], 0.5, {
      resolvableSlugs: new Set(['known-concept']),
    });
    assert.ok(fm.includes('"[[known-concept|Known Concept]]"'), 'related emits quoted piped slug links');
    assert.ok(!fm.includes('Ghost Concept'), 'unresolvable related links must be dropped');
  });
});

describe('buildConceptBody', () => {
  it('includes LLM summary when provided', () => {
    const body = buildConceptBody('NATS JetStream', {
      summary: 'NATS JetStream is the messaging backbone for inter-node communication.',
      decisions: [{ decision: 'Use NATS over RabbitMQ', rationale: 'Simpler ops', session_id: 's1' }],
      recentSessions: [{ session_id: '2026-05-13-debug', created_at: '2026-05-13' }],
    });

    assert.ok(body.includes('# NATS JetStream'));
    assert.ok(body.includes('messaging backbone'));
    assert.ok(body.includes('## Decisions'));
    assert.ok(body.includes('Use NATS over RabbitMQ'));
    assert.ok(body.includes('## Recent activity'));
    // Without a resolver, sessions render as plain text — never a dangling link (repair 2.8)
    assert.ok(body.includes('- session 2026-05-13-debug'));
    assert.ok(!body.includes('[[sessions/2026-05-13-debug]]'));
  });

  it('links the session note when the resolver finds one (repair 2.8)', () => {
    const body = buildConceptBody('NATS JetStream', {
      summary: null,
      recentSessions: [
        { session_id: 'e7ccaaf9-1111-2222-3333-444455556666', created_at: '2026-03-08' },
        { session_id: 'deadbeef-0000-0000-0000-000000000000', created_at: '2026-03-09' },
      ],
      sessionNoteResolver: (id) =>
        id.startsWith('e7ccaaf9') ? '2026-03-08-gui-openclaw-nats-jetstream-e7ccaaf9' : null,
    });
    assert.ok(body.includes('[[2026-03-08-gui-openclaw-nats-jetstream-e7ccaaf9]]'), 'basename link — path-style [[sessions/x]] never matched graph node ids');
    assert.ok(body.includes('- session deadbeef-0000-0000-0000-000000000000'));
  });

  it('falls back to placeholder when no summary', () => {
    const body = buildConceptBody('Test Entity', { summary: null });
    assert.ok(body.includes('# Test Entity'));
    assert.ok(body.includes('_Summary not yet generated._'));
  });
});

describe('generateConceptSummary', () => {
  it('calls LLM client and returns summary', async () => {
    const mockClient = {
      async generate(messages, opts) {
        assert.ok(messages[1].content.includes('NATS JetStream'));
        return { content: 'NATS JetStream provides durable message streaming for the mesh.' };
      },
    };
    const result = await generateConceptSummary(mockClient, 'NATS JetStream', [
      { session_id: 's1', salience: 0.9 },
    ]);
    assert.ok(result.includes('durable message streaming'));
  });

  it('returns null when client is null', async () => {
    const result = await generateConceptSummary(null, 'Test', []);
    assert.equal(result, null);
  });

  it('returns null on client error', async () => {
    const mockClient = {
      async generate() { throw new Error('timeout'); },
    };
    const result = await generateConceptSummary(mockClient, 'Test', []);
    assert.equal(result, null);
  });
});

describe('queryConceptData + generateConceptNotes integration', () => {
  let tmpDir;
  let dbPath;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'obs-sum-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function seedDb() {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    // Schema includes the `private` column (F-C15 migration) — entities/decisions/themes
    // are default-private; the seed rows below publish via private=0 so they
    // surface in queryConceptData under F-N102's privacy filter.
    db.exec(`
      CREATE TABLE entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        canonical_name TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 1,
        embedding BLOB,
        private INTEGER DEFAULT 1,
        source_type TEXT DEFAULT 'local',
        source_node TEXT,
        source_event_id TEXT
      );
      CREATE TABLE themes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL UNIQUE,
        hierarchy_path TEXT,
        parent_id INTEGER,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 1,
        private INTEGER DEFAULT 1,
        source_type TEXT DEFAULT 'local',
        source_node TEXT,
        source_event_id TEXT
      );
      CREATE TABLE mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        turn_index INTEGER,
        salience REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        source_type TEXT DEFAULT 'local',
        source_node TEXT,
        source_event_id TEXT
      );
      CREATE TABLE decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        private INTEGER DEFAULT 1,
        source_type TEXT DEFAULT 'local',
        source_node TEXT,
        source_event_id TEXT
      );
    `);

    // Insert entities — one above threshold, one below
    db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count) VALUES (?, ?, ?, ?, ?)`).run(
      'NATS JetStream', 'technology', '2026-05-10', '2026-05-20', 10
    );
    db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count) VALUES (?, ?, ?, ?, ?)`).run(
      'Minor Thing', 'concept', '2026-05-15', '2026-05-15', 2
    );
    db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count) VALUES (?, ?, ?, ?, ?)`).run(
      'Spreading Activation', 'algorithm', '2026-05-12', '2026-05-19', 7
    );

    // Insert mentions for NATS JetStream
    db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, ?, ?, ?)`).run(
      1, 'session-001', 0.9, '2026-05-10'
    );
    db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, ?, ?, ?)`).run(
      1, 'session-002', 0.8, '2026-05-15'
    );

    // Insert mentions for Spreading Activation (co-mentioned with NATS in session-002)
    db.prepare(`INSERT INTO mentions (entity_id, session_id, salience, created_at) VALUES (?, ?, ?, ?)`).run(
      3, 'session-002', 0.7, '2026-05-15'
    );

    // Insert a decision in session-001
    db.prepare(`INSERT INTO decisions (session_id, decision, rationale, confidence, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      'session-001', 'Use NATS over RabbitMQ', 'Simpler ops model', 0.95, '2026-05-10'
    );

    // F-N102: queryConceptData filters private entities + decisions by default.
    // The test exercises a successful-vault-generation path, so publish all
    // seeded rows. (A separate test below asserts that private rows ARE
    // filtered.)
    db.exec(`UPDATE entities  SET private = 0`);
    db.exec(`UPDATE decisions SET private = 0`);

    return db;
  }

  it('queryConceptData returns only entities above threshold', () => {
    const db = seedDb();
    try {
      const data = queryConceptData(db, 5);
      assert.equal(data.length, 2); // NATS JetStream (10) + Spreading Activation (7)
      assert.equal(data[0].entity.name, 'NATS JetStream');
      assert.equal(data[1].entity.name, 'Spreading Activation');

      // Check co-mentions: NATS and Spreading share session-002
      assert.ok(data[0].relatedEntities.includes('Spreading Activation'));

      // Check decisions linked via session
      assert.equal(data[0].decisions.length, 1);
      assert.equal(data[0].decisions[0].decision, 'Use NATS over RabbitMQ');

      // Check average salience
      assert.ok(data[0].avgSalience > 0.8); // (0.9 + 0.8) / 2 = 0.85
    } finally {
      db.close();
    }
  });

  it('generateConceptNotes writes notes to vault concepts/ directory', async () => {
    const db = seedDb();
    const vaultPath = join(tmpDir, 'vault');

    try {
      const result = await generateConceptNotes({
        db,
        vaultPath,
        threshold: 5,
        client: null, // data-only
      });

      assert.equal(result.generated, 2);
      assert.ok(result.notes.includes('nats-jetstream.md'));
      assert.ok(result.notes.includes('spreading-activation.md'));

      // Verify file content
      const natsContent = await readFile(join(vaultPath, 'concepts', 'nats-jetstream.md'), 'utf-8');
      assert.ok(natsContent.includes('type: concept'));
      assert.ok(natsContent.includes('entity_type: technology'));
      assert.ok(natsContent.includes('mention_count: 10'));
      assert.ok(natsContent.includes('# NATS JetStream'));
      assert.ok(natsContent.includes('[[spreading-activation|Spreading Activation]]'));
      assert.ok(natsContent.includes('Use NATS over RabbitMQ'));

      // Verify concepts/ directory was created
      const conceptFiles = await readdir(join(vaultPath, 'concepts'));
      assert.equal(conceptFiles.length, 2);
    } finally {
      db.close();
    }
  });

  it('generateConceptNotes returns zero when no entities above threshold', async () => {
    const db = seedDb();
    const vaultPath = join(tmpDir, 'vault-empty');

    try {
      const result = await generateConceptNotes({
        db,
        vaultPath,
        threshold: 100, // No entity has this many mentions
      });

      assert.equal(result.generated, 0);
      assert.deepEqual(result.notes, []);
    } finally {
      db.close();
    }
  });

  it('slug-colliding entities share one note carrying both names as aliases (repair 2.9)', async () => {
    const db = seedDb();
    db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen, mention_count)
      VALUES ('nats jetstream', 'technology', '2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z', 6)`).run();
    const vaultPath = join(tmpDir, 'vault-collide');

    try {
      const result = await generateConceptNotes({ db, vaultPath, threshold: 5, client: null });
      assert.equal(result.notes.filter((n) => n === 'nats-jetstream.md').length, 1,
        'one note for the colliding pair');
      const note = await readFile(join(vaultPath, 'concepts', 'nats-jetstream.md'), 'utf-8');
      assert.match(note, /aliases: \["NATS JetStream", "nats jetstream"\]/);
    } finally {
      db.close();
    }
  });

  it('opts.names restricts generation to the targeted concepts (repair 2.7)', async () => {
    const db = seedDb();
    const vaultPath = join(tmpDir, 'vault-targeted');

    try {
      const result = await generateConceptNotes({
        db, vaultPath, threshold: 5, client: null, names: ['NATS JetStream'],
      });
      assert.equal(result.generated, 1);
      assert.deepEqual(result.notes, ['nats-jetstream.md']);
    } finally {
      db.close();
    }
  });

  it('D7 (repair 2.1): private-flagged entities land in the vault by default', async () => {
    const db = seedDb();
    // NATS JetStream flagged private — under D7 the local vault is trusted
    // and transparent, so the flag is not consulted by default.
    db.exec(`UPDATE entities SET private = 1 WHERE name = 'NATS JetStream'`);
    const vaultPath = join(tmpDir, 'vault-transparent');

    try {
      const result = await generateConceptNotes({ db, vaultPath, threshold: 5, client: null });
      assert.equal(result.generated, 2,
        'D7: the local vault is fully transparent — private flags are not consulted');
      assert.ok(result.notes.includes('nats-jetstream.md'));
    } finally {
      db.close();
    }
  });

  it('regression_F-N102 (now opt-IN): respectPrivacy:true filters for federation-era surfaces', async () => {
    const db = seedDb();
    db.exec(`UPDATE entities SET private = 1 WHERE name = 'NATS JetStream'`);
    // Also private-ify the decision so it doesn't slip through coMentioned wikilinks.
    db.exec(`UPDATE decisions SET private = 1`);
    const vaultPath = join(tmpDir, 'vault-privacy');

    try {
      const result = await generateConceptNotes({
        db, vaultPath, threshold: 5, client: null, respectPrivacy: true,
      });

      // Only Spreading Activation should land in the vault.
      assert.equal(result.generated, 1, 'opt-in filtering must exclude private entities');
      assert.ok(result.notes.includes('spreading-activation.md'));
      assert.ok(!result.notes.includes('nats-jetstream.md'),
        'NATS is private — must NOT appear when filtering is opted in');

      const spreadingContent = await readFile(
        join(vaultPath, 'concepts', 'spreading-activation.md'), 'utf-8');
      assert.ok(!spreadingContent.includes('[[NATS JetStream]]'),
        'filtered note must not wikilink to a private entity');
      assert.ok(!spreadingContent.includes('Use NATS over RabbitMQ'),
        'private decision text must not leak into filtered note body');
    } finally {
      db.close();
    }
  });

  it('preserves an existing summary when the LLM returns nothing (prose is monotonic)', async () => {
    const db = seedDb();
    const vaultPath = join(tmpDir, 'vault-keep');
    const proseClient = {
      generate: async () => ({ content: 'NATS JetStream is the persistence layer of the mesh.' }),
    };

    try {
      await generateConceptNotes({ db, vaultPath, threshold: 5, client: proseClient });
      const withProse = await readFile(join(vaultPath, 'concepts', 'nats-jetstream.md'), 'utf-8');
      assert.ok(withProse.includes('persistence layer of the mesh'));

      // Next cycle: LLM unavailable. The note must keep its prose, not
      // regress to the placeholder.
      await generateConceptNotes({ db, vaultPath, threshold: 5, client: null });
      const afterOutage = await readFile(join(vaultPath, 'concepts', 'nats-jetstream.md'), 'utf-8');
      assert.ok(afterOutage.includes('persistence layer of the mesh'));
      assert.ok(!afterOutage.includes('_Summary not yet generated._'));
    } finally {
      db.close();
    }
  });

  it('skips byte-identical rewrites and reports them as unchanged', async () => {
    const db = seedDb();
    const vaultPath = join(tmpDir, 'vault-unchanged');

    try {
      const first = await generateConceptNotes({ db, vaultPath, threshold: 5, client: null });
      assert.equal(first.generated, 2);
      assert.equal(first.unchanged, 0);

      const second = await generateConceptNotes({ db, vaultPath, threshold: 5, client: null });
      assert.equal(second.generated, 0, 'identical data must not rewrite notes');
      assert.equal(second.unchanged, 2);
      assert.equal(second.attempted, 2);
    } finally {
      db.close();
    }
  });

  it('spends the budget frontier-first: a noteless concept beats an already-written hub', async () => {
    const db = seedDb();
    const vaultPath = join(tmpDir, 'vault-frontier');

    try {
      // Write only the hub (highest mentions) first.
      await generateConceptNotes({ db, vaultPath, threshold: 5, client: null, names: ['NATS JetStream'] });

      // Budget of 1: the old top-N-by-mentions slice would re-take the hub
      // forever; tier 0 (no note yet) must win the slot instead.
      const result = await generateConceptNotes({ db, vaultPath, threshold: 5, client: null, maxConcepts: 1 });
      assert.deepEqual(result.notes, ['spreading-activation.md']);
      assert.equal(result.skipped, 1);
    } finally {
      db.close();
    }
  });
});

describe('extractExistingSummary', () => {
  it('returns the prose between the H1 and the first section', () => {
    const note = [
      '---', 'type: concept', '---', '',
      '# NATS', '',
      'NATS is the mesh transport.', '',
      '## Related', '- [[openclaw]]', '',
    ].join('\n');
    assert.equal(extractExistingSummary(note), 'NATS is the mesh transport.');
  });

  it('returns null for the placeholder, empty prose, and unparseable bodies', () => {
    const placeholder = '---\ntype: concept\n---\n\n# NATS\n\n_Summary not yet generated._\n\n## Related\n- [[x]]\n';
    assert.equal(extractExistingSummary(placeholder), null);
    assert.equal(extractExistingSummary('---\ntype: concept\n---\n\n# NATS\n\n## Related\n- [[x]]\n'), null);
    assert.equal(extractExistingSummary('no heading at all'), null);
    assert.equal(extractExistingSummary(''), null);
  });

  it('round-trips the prose a data-only rewrite would carry forward', () => {
    const summary = 'Multi-line prose.\nStill the same paragraph block.';
    const note = `---\ntype: concept\n---\n\n${buildConceptBody('NATS', { summary, related: ['OpenClaw'] })}`;
    assert.equal(extractExistingSummary(note), summary);
  });
});
