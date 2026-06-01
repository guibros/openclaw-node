import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseFrontmatter,
  parseBody,
  readVaultDir,
  isOnDate,
  isInDateRange,
  extractConceptNames,
  extractDecisionsFromBody,
  buildDigestFrontmatter,
  buildDigestBody,
  generateDailyDigest,
  generateWeeklyDigest,
} from '../lib/obsidian-digest.mjs';

describe('obsidian-digest', () => {
  let vaultDir;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), 'digest-test-'));
    await mkdir(join(vaultDir, 'sessions'), { recursive: true });
    await mkdir(join(vaultDir, 'concepts'), { recursive: true });
    await mkdir(join(vaultDir, 'daily'), { recursive: true });
    await mkdir(join(vaultDir, 'decisions'), { recursive: true });
    await mkdir(join(vaultDir, 'themes'), { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  describe('parseFrontmatter', () => {
    it('parses YAML frontmatter', () => {
      const content = '---\ntype: session\ndate: 2026-06-01\n---\n\n# Body';
      const fm = parseFrontmatter(content);
      assert.equal(fm.type, 'session');
      // js-yaml converts bare dates to Date objects
      assert.ok(fm.date instanceof Date || typeof fm.date === 'string');
    });

    it('returns null for no frontmatter', () => {
      assert.equal(parseFrontmatter('# Just a heading'), null);
    });

    it('returns null for malformed YAML', () => {
      const content = '---\n: invalid: yaml: [\n---\n';
      assert.equal(parseFrontmatter(content), null);
    });
  });

  describe('parseBody', () => {
    it('extracts body after frontmatter', () => {
      const content = '---\ntype: test\n---\n\n# Heading\ntext';
      assert.equal(parseBody(content).trim(), '# Heading\ntext');
    });

    it('returns full content when no frontmatter', () => {
      const content = '# Just text';
      assert.equal(parseBody(content), '# Just text');
    });
  });

  describe('isOnDate', () => {
    it('matches ISO timestamp to date', () => {
      assert.equal(isOnDate('2026-06-01T14:30:00.000Z', '2026-06-01'), true);
    });

    it('rejects different date', () => {
      assert.equal(isOnDate('2026-06-02T00:00:00.000Z', '2026-06-01'), false);
    });

    it('handles null/undefined', () => {
      assert.equal(isOnDate(null, '2026-06-01'), false);
      assert.equal(isOnDate(undefined, '2026-06-01'), false);
    });

    it('handles plain date strings', () => {
      assert.equal(isOnDate('2026-06-01', '2026-06-01'), true);
    });
  });

  describe('isInDateRange', () => {
    it('matches within range', () => {
      assert.equal(isInDateRange('2026-06-01T12:00:00Z', '2026-05-30', '2026-06-02'), true);
    });

    it('matches boundary dates', () => {
      assert.equal(isInDateRange('2026-05-30T00:00:00Z', '2026-05-30', '2026-06-02'), true);
      assert.equal(isInDateRange('2026-06-02T23:59:59Z', '2026-05-30', '2026-06-02'), true);
    });

    it('rejects outside range', () => {
      assert.equal(isInDateRange('2026-05-29T23:59:59Z', '2026-05-30', '2026-06-02'), false);
    });
  });

  describe('extractConceptNames', () => {
    it('extracts from wikilink format', () => {
      const concepts = ['[[foo]]', '[[bar-baz]]'];
      assert.deepEqual(extractConceptNames(concepts), ['foo', 'bar-baz']);
    });

    it('passes through plain strings', () => {
      assert.deepEqual(extractConceptNames(['plain']), ['plain']);
    });

    it('handles empty/non-array', () => {
      assert.deepEqual(extractConceptNames(null), []);
      assert.deepEqual(extractConceptNames([]), []);
    });
  });

  describe('extractDecisionsFromBody', () => {
    it('extracts decisions under ## Decisions', () => {
      const body = '# Session\n\n## Decisions\n- Decision one\n- Decision two\n\n## Other\n- Not this';
      const decs = extractDecisionsFromBody(body);
      assert.deepEqual(decs, ['Decision one', 'Decision two']);
    });

    it('returns empty for no decisions section', () => {
      assert.deepEqual(extractDecisionsFromBody('# Session\ntext'), []);
    });
  });

  describe('buildDigestFrontmatter', () => {
    it('builds daily digest frontmatter', () => {
      const fm = buildDigestFrontmatter({
        type: 'daily-digest',
        date: '2026-06-01',
        sessionCount: 3,
        conceptCount: 10,
      });
      assert.ok(fm.includes('type: daily-digest'));
      assert.ok(fm.includes('date: 2026-06-01'));
      assert.ok(fm.includes('sessions: 3'));
      assert.ok(fm.includes('concepts_active: 10'));
      assert.ok(fm.includes('generated_at:'));
      assert.ok(fm.startsWith('---'));
      assert.ok(fm.endsWith('---'));
    });

    it('includes start_date for weekly', () => {
      const fm = buildDigestFrontmatter({
        type: 'weekly-digest',
        date: '2026-06-07',
        startDate: '2026-06-01',
        sessionCount: 5,
        conceptCount: 20,
      });
      assert.ok(fm.includes('start_date: 2026-06-01'));
    });
  });

  describe('buildDigestBody', () => {
    it('builds body with sessions, concepts, decisions', () => {
      const body = buildDigestBody({
        title: 'Daily Digest — 2026-06-01',
        sessions: [
          {
            filename: '2026-06-01-topic-abc12345.md',
            frontmatter: { message_count: 50, concepts: ['[[foo]]', '[[bar]]'] },
            body: '',
          },
        ],
        concepts: [
          {
            filename: 'foo.md',
            frontmatter: { entity_type: 'project', salience: 0.85, mention_count: 10 },
          },
        ],
        allDecisions: ['Use NATS for events'],
      });

      assert.ok(body.includes('# Daily Digest — 2026-06-01'));
      assert.ok(body.includes('[[sessions/2026-06-01-topic-abc12345]]'));
      assert.ok(body.includes('(50 messages)'));
      assert.ok(body.includes('[[foo]]'));
      assert.ok(body.includes('(project, salience: 0.85, mentions: 10)'));
      assert.ok(body.includes('Use NATS for events'));
    });

    it('handles no sessions', () => {
      const body = buildDigestBody({
        title: 'Test',
        sessions: [],
        concepts: [],
        allDecisions: [],
      });
      assert.ok(body.includes('No sessions recorded.'));
    });
  });

  describe('readVaultDir', () => {
    it('reads and parses vault notes', async () => {
      const noteContent = '---\ntype: session\ndate: 2026-06-01\n---\n\n# Session';
      await writeFile(join(vaultDir, 'sessions', 'test.md'), noteContent);

      const notes = await readVaultDir(join(vaultDir, 'sessions'));
      assert.equal(notes.length, 1);
      assert.equal(notes[0].filename, 'test.md');
      assert.equal(notes[0].frontmatter.type, 'session');
      assert.ok(notes[0].body.includes('# Session'));
    });

    it('returns empty for missing directory', async () => {
      const notes = await readVaultDir(join(vaultDir, 'nonexistent'));
      assert.deepEqual(notes, []);
    });

    it('skips non-md files', async () => {
      await writeFile(join(vaultDir, 'sessions', 'notes.txt'), 'text');
      const notes = await readVaultDir(join(vaultDir, 'sessions'));
      assert.equal(notes.length, 0);
    });
  });

  describe('generateDailyDigest', () => {
    it('generates a daily digest from vault notes', async () => {
      const sessionNote = [
        '---',
        'type: session',
        'date: 2026-06-01',
        'session_id: abc-123',
        'message_count: 42',
        'concepts: [[[openclaw]], [[nats]]]',
        '---',
        '',
        '# Session: 2026-06-01',
        '',
        '## Decisions',
        '- Use local NATS',
        '- Keep all 5 stores',
      ].join('\n');
      await writeFile(join(vaultDir, 'sessions', '2026-06-01-test-abc12345.md'), sessionNote);

      const conceptNote = [
        '---',
        'type: concept',
        'entity_type: technology',
        'last_seen: 2026-06-01T14:00:00.000Z',
        'mention_count: 15',
        'salience: 0.9',
        '---',
        '',
        '# NATS',
      ].join('\n');
      await writeFile(join(vaultDir, 'concepts', 'nats.md'), conceptNote);

      const result = await generateDailyDigest({ vaultPath: vaultDir, date: '2026-06-01' });

      assert.equal(result.generated, true);
      assert.equal(result.sessions, 1);
      assert.equal(result.concepts, 1);
      assert.ok(result.filePath.endsWith('2026-06-01.md'));

      const content = await readFile(result.filePath, 'utf-8');
      assert.ok(content.includes('type: daily-digest'));
      assert.ok(content.includes('date: 2026-06-01'));
      assert.ok(content.includes('sessions: 1'));
      assert.ok(content.includes('[[sessions/2026-06-01-test-abc12345]]'));
      assert.ok(content.includes('[[nats]]'));
      assert.ok(content.includes('Use local NATS'));
      assert.ok(content.includes('Keep all 5 stores'));
    });

    it('generates empty digest for date with no sessions', async () => {
      const result = await generateDailyDigest({ vaultPath: vaultDir, date: '2026-06-01' });

      assert.equal(result.generated, true);
      assert.equal(result.sessions, 0);
      assert.equal(result.concepts, 0);

      const content = await readFile(result.filePath, 'utf-8');
      assert.ok(content.includes('No sessions recorded.'));
    });

    it('is idempotent — regenerating overwrites cleanly', async () => {
      const sessionNote = '---\ntype: session\ndate: 2026-06-01\n---\n\n# S';
      await writeFile(join(vaultDir, 'sessions', 'test.md'), sessionNote);

      const r1 = await generateDailyDigest({ vaultPath: vaultDir, date: '2026-06-01' });
      const c1 = await readFile(r1.filePath, 'utf-8');

      const r2 = await generateDailyDigest({ vaultPath: vaultDir, date: '2026-06-01' });
      const c2 = await readFile(r2.filePath, 'utf-8');

      // generated_at will differ but structure should be same
      assert.equal(r1.sessions, r2.sessions);
      assert.equal(r1.concepts, r2.concepts);
    });
  });

  describe('generateWeeklyDigest', () => {
    it('generates a weekly digest covering 7 days', async () => {
      for (const date of ['2026-05-26', '2026-05-28', '2026-06-01']) {
        const note = `---\ntype: session\ndate: ${date}\n---\n\n# Session: ${date}`;
        await writeFile(join(vaultDir, 'sessions', `${date}-test.md`), note);
      }

      const concept = [
        '---',
        'type: concept',
        'entity_type: project',
        'last_seen: 2026-05-28T10:00:00Z',
        'salience: 0.8',
        'mention_count: 5',
        '---',
        '',
        '# Project',
      ].join('\n');
      await writeFile(join(vaultDir, 'concepts', 'project.md'), concept);

      const result = await generateWeeklyDigest({ vaultPath: vaultDir, endDate: '2026-06-01' });

      assert.equal(result.generated, true);
      assert.equal(result.sessions, 3);
      assert.equal(result.concepts, 1);
      assert.ok(result.filePath.endsWith('2026-06-01-weekly.md'));

      const content = await readFile(result.filePath, 'utf-8');
      assert.ok(content.includes('type: weekly-digest'));
      assert.ok(content.includes('start_date: 2026-05-26'));
      assert.ok(content.includes('Weekly Digest'));
    });

    it('excludes sessions outside the 7-day window', async () => {
      const oldNote = '---\ntype: session\ndate: 2026-05-20\n---\n\n# Old';
      await writeFile(join(vaultDir, 'sessions', '2026-05-20-old.md'), oldNote);

      const result = await generateWeeklyDigest({ vaultPath: vaultDir, endDate: '2026-06-01' });
      assert.equal(result.sessions, 0);
    });
  });
});
