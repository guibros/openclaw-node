/**
 * memory-budget.test.mjs — Unit tests for lib/memory-budget.mjs
 *
 * Tests MemoryBudget: freeze/thaw lifecycle, character budget enforcement,
 * event emission, trimming, and stats.
 *
 * Run: node --test test/memory-budget.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MemoryBudget, createBudget } from '../lib/memory-budget.mjs';
import { extractFacts, mergeFacts, cleanParentheticalChains, stripSupersedes, stripSpeaker, truncateAtWord } from '../lib/pre-compression-flush.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-budget-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MemoryBudget', () => {
  it('initializes with correct defaults', () => {
    const mb = new MemoryBudget(path.join(tmpDir, 'MEMORY.md'));
    assert.equal(mb.charBudget, 2200);
    assert.equal(mb.isFrozen, false);
  });

  it('accepts custom char budget', () => {
    const mb = new MemoryBudget(path.join(tmpDir, 'MEMORY.md'), { charBudget: 500 });
    assert.equal(mb.charBudget, 500);
  });

  it('startSession freezes content', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n- entry one\n');

    const mb = new MemoryBudget(filePath);
    const frozen = mb.startSession();
    assert.equal(mb.isFrozen, true);
    assert.equal(frozen, '# Memory\n- entry one\n');
  });

  it('getRendered returns frozen content even after disk changes', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, 'original');

    const mb = new MemoryBudget(filePath);
    mb.startSession();

    // Modify file on disk
    fs.writeFileSync(filePath, 'modified on disk');

    // Rendered should still be the frozen version
    assert.equal(mb.getRendered(), 'original');
  });

  it('getRendered returns live content when not frozen', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, 'live content');

    const mb = new MemoryBudget(filePath);
    assert.equal(mb.getRendered(), 'live content');
  });

  it('reload updates frozen content from disk', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, 'v1');

    const mb = new MemoryBudget(filePath);
    mb.startSession();
    assert.equal(mb.getRendered(), 'v1');

    fs.writeFileSync(filePath, 'v2');
    mb.reload();
    assert.equal(mb.getRendered(), 'v2');
  });

  it('endSession clears frozen state', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, 'content');

    const mb = new MemoryBudget(filePath);
    mb.startSession();
    assert.equal(mb.isFrozen, true);
    mb.endSession();
    assert.equal(mb.isFrozen, false);
  });

  it('emits freeze event on startSession', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Mem\n- line\n');

    const mb = new MemoryBudget(filePath);
    let event = null;
    mb.on('freeze', (e) => { event = e; });
    mb.startSession();

    assert.ok(event);
    assert.equal(event.charCount, '# Mem\n- line\n'.length);
    assert.equal(event.lineCount, 3);
  });

  it('emits reload event on reload', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, 'reloaded');

    const mb = new MemoryBudget(filePath);
    mb.startSession();
    let event = null;
    mb.on('reload', (e) => { event = e; });
    mb.reload();
    assert.ok(event);
  });
});

describe('addEntry', () => {
  it('adds entry to file on disk', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n');

    const mb = new MemoryBudget(filePath, { charBudget: 500 });
    const result = mb.addEntry('new fact learned');

    assert.equal(result.added, true);
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('- new fact learned'));
  });

  it('creates section if missing', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n');

    const mb = new MemoryBudget(filePath, { charBudget: 500 });
    mb.addEntry('fact', { section: 'Context' });

    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('## Context'));
  });

  it('rejects entry when over budget and cannot trim', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    // Fill with non-bullet content so nothing can be trimmed
    // 490 chars of headers/text + new entry with section = well over 500
    fs.writeFileSync(filePath, '# Memory\n## Recent\n' + 'x'.repeat(480));

    const mb = new MemoryBudget(filePath, { charBudget: 500 });
    const result = mb.addEntry('this entry will not fit because budget is full');

    assert.equal(result.added, false);
  });

  it('trims oldest bullets to make room', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n- old entry one\n- old entry two\n');

    const mb = new MemoryBudget(filePath, { charBudget: 80 });
    const result = mb.addEntry('brand new entry');

    assert.equal(result.added, true);
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('- brand new entry'));
  });

  it('emits add event', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n');

    const mb = new MemoryBudget(filePath, { charBudget: 500 });
    let event = null;
    mb.on('add', (e) => { event = e; });
    mb.addEntry('test');

    assert.ok(event);
    assert.equal(event.entry, 'test');
    assert.ok(event.pctUsed >= 0);
    assert.ok(event.totalBudget === 500);
  });

  it('emits warning at 80% threshold', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, 'x'.repeat(75));

    const mb = new MemoryBudget(filePath, { charBudget: 100 });
    let warning = null;
    mb.on('warning', (e) => { warning = e; });
    mb.addEntry('push past 80%');

    assert.ok(warning);
    assert.ok(warning.pctUsed >= 80);
  });

  it('emits trim event when removing old entries', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    // "# Memory\n## Recent\n- old bullet entry\n" = 40 chars
    // Budget 55, so adding "- new entry here\n" (18 chars) => 58 > 55, triggers trim
    fs.writeFileSync(filePath, '# Memory\n## Recent\n- old bullet entry\n');

    const contentLen = fs.readFileSync(filePath, 'utf-8').length;
    const mb = new MemoryBudget(filePath, { charBudget: contentLen + 5 });
    let trimEvent = null;
    mb.on('trim', (e) => { trimEvent = e; });
    mb.addEntry('new entry that exceeds budget');

    assert.ok(trimEvent);
    assert.ok(trimEvent.removed.includes('old bullet'));
  });
});

describe('getStats', () => {
  it('returns correct usage stats', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n- item\n');

    const mb = new MemoryBudget(filePath, { charBudget: 100 });
    const stats = mb.getStats();

    assert.equal(stats.totalBudget, 100);
    assert.equal(stats.usedChars, '# Memory\n- item\n'.length);
    assert.ok(stats.pctUsed > 0);
    assert.ok(stats.charsRemaining > 0);
    assert.ok(stats.meterDisplay.includes('%'));
  });

  it('handles missing file gracefully', () => {
    const mb = new MemoryBudget(path.join(tmpDir, 'missing.md'));
    const stats = mb.getStats();
    assert.equal(stats.usedChars, 0);
    assert.equal(stats.pctUsed, 0);
  });
});

describe('reload after external write', () => {
  it('reload after external write updates getRendered in mid-session', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n- original fact\n');

    const mb = new MemoryBudget(filePath, { charBudget: 500 });
    mb.startSession();
    assert.equal(mb.getRendered(), '# Memory\n- original fact\n');

    // Simulate an external flush writing new facts to MEMORY.md on disk
    fs.writeFileSync(filePath, '# Memory\n- original fact\n- extracted-by-flush\n');

    // Without reload, frozen snapshot is stale
    assert.equal(mb.getRendered(), '# Memory\n- original fact\n');

    // After reload, snapshot picks up the flush output
    const reloaded = mb.reload();
    assert.equal(mb.getRendered(), '# Memory\n- original fact\n- extracted-by-flush\n');
    assert.equal(reloaded, '# Memory\n- original fact\n- extracted-by-flush\n');

    // Verify reload event carried correct stats
    let reloadEvent = null;
    mb.on('reload', (e) => { reloadEvent = e; });
    fs.writeFileSync(filePath, '# Memory\n- final version\n');
    mb.reload();
    assert.ok(reloadEvent);
    assert.equal(reloadEvent.charCount, '# Memory\n- final version\n'.length);
    assert.equal(reloadEvent.lineCount, 3);
  });
});

describe('createBudget', () => {
  it('creates budget with correct file path', () => {
    const mb = createBudget(tmpDir);
    assert.equal(mb.filePath, path.join(tmpDir, 'MEMORY.md'));
  });
});

describe('mergeFacts parenthetical regression', () => {
  it('10 sequential merges on similar facts stay clean (no parenthetical accumulation)', () => {
    // Use long facts with minimal variation so bigram similarity stays above 0.7
    let content = '# Memory\n\n## Recent\n- always prefer using the NATS JetStream cluster for all messaging needs, config round 1\n';

    for (let i = 0; i < 10; i++) {
      const result = mergeFacts(content, [
        { fact: `always prefer using the NATS JetStream cluster for all messaging needs, config round ${i + 2}`, category: 'preference', confidence: 85 },
      ], 5000);
      content = result.content;
      assert.equal(result.merged, 1, `Merge iteration ${i + 1} should merge`);
    }

    // The final content should NOT contain "(updated:" anywhere
    assert.ok(!content.includes('(updated:'), 'No parenthetical chains should remain');

    // Should contain the most recent version of the fact
    assert.ok(content.includes('config round 11'),
      'Should contain the most recent fact text');

    // Should contain exactly one supersedes comment (on the single entry)
    const supersedesCount = (content.match(/<!-- supersedes:/g) || []).length;
    assert.equal(supersedesCount, 1, 'Should have exactly one supersedes comment (on the single entry)');
  });

  it('cleanParentheticalChains strips nested chains', () => {
    const dirty = '# Memory\n- original fact (updated: newer fact (updated: newest fact))\n- clean entry\n';
    const cleaned = cleanParentheticalChains(dirty);

    assert.ok(!cleaned.includes('(updated:'), 'All parenthetical chains should be stripped');
    assert.ok(cleaned.includes('- newest fact'), 'Should keep the innermost (most recent) segment');
    assert.ok(cleaned.includes('- clean entry'), 'Non-chained entries should be untouched');
  });

  it('supersedes comment is present after merge', () => {
    // Use longer facts so bigram similarity exceeds 0.7 threshold
    const content = '# Memory\n\n## Recent\n- we decided to use the NATS JetStream cluster on port 4222 for messaging\n';
    const result = mergeFacts(content, [
      { fact: 'we decided to use the NATS JetStream cluster on port 8080 for messaging', category: 'environment', confidence: 75 },
    ], 5000);

    assert.equal(result.merged, 1);
    assert.ok(result.content.includes('<!-- supersedes:'), 'Merged entry should have supersedes comment');
    assert.ok(result.content.includes('port 8080'),
      'Merged entry should contain the new fact verbatim');
    assert.ok(!result.content.includes('(updated:'), 'Should not use parenthetical format');
  });

  it('stripSupersedes removes HTML comments for clean text', () => {
    const withComment = 'some fact text <!-- supersedes: abcd1234 -->';
    const cleaned = stripSupersedes(withComment);
    assert.equal(cleaned, 'some fact text');
  });

  it('cleanParentheticalChains handles content with no chains', () => {
    const clean = '# Memory\n- normal entry\n- another entry\n';
    const result = cleanParentheticalChains(clean);
    assert.equal(result, clean, 'Clean content should be unchanged');
  });
});

describe('extractFacts assistant extraction', () => {
  it('includes assistant-role messages in extraction', () => {
    const messages = [
      { role: 'assistant', content: "I found that the database config is in /etc/openclaw/db.conf and needs updating" },
      { role: 'user', content: "always use port 5433 for the database connection instead of default" },
    ];
    const facts = extractFacts(messages);
    // Should extract from both roles
    const assistantFacts = facts.filter(f => f.speaker === 'assistant');
    const userFacts = facts.filter(f => f.speaker === 'user');
    assert.ok(assistantFacts.length > 0, 'Should extract facts from assistant messages');
    assert.ok(userFacts.length > 0, 'Should extract facts from user messages');
  });

  it('speaker field is present on all extracted facts', () => {
    const messages = [
      { role: 'user', content: "don't use the old authentication endpoint for any API calls going forward" },
      { role: 'assistant', content: "I'll switch to the new OAuth2 endpoint at /api/v2/auth for all requests" },
    ];
    const facts = extractFacts(messages);
    assert.ok(facts.length > 0, 'Should extract at least one fact');
    for (const f of facts) {
      assert.ok(f.speaker === 'user' || f.speaker === 'assistant',
        `Speaker field must be 'user' or 'assistant', got '${f.speaker}'`);
    }
  });

  it('assistant-specific patterns match agent actions and findings', () => {
    const messages = [
      { role: 'assistant', content: "I'll switch to the new build pipeline using esbuild instead of webpack for faster builds" },
      { role: 'assistant', content: "I noticed that the memory daemon crashes when NATS is unavailable and needs a fallback" },
    ];
    const facts = extractFacts(messages);
    const categories = facts.map(f => f.category);
    assert.ok(categories.includes('agent_action'), 'Should detect agent_action category');
    assert.ok(categories.includes('finding'), 'Should detect finding category');
  });

  it('tool-role messages are excluded from extraction', () => {
    const messages = [
      { role: 'tool', content: "don't use this pattern, always prefer the other approach for consistency" },
      { role: 'system', content: "I found that the critical config is at /opt/openclaw/system.conf for reference" },
    ];
    const facts = extractFacts(messages);
    assert.equal(facts.length, 0, 'Tool and system role messages should produce no facts');
  });

  it('mergeFacts formats entries with speaker tag', () => {
    const content = '# Memory\n\n## Recent\n';
    const facts = [
      { fact: 'the API endpoint moved to port 8080 for all services', category: 'environment', confidence: 75, speaker: 'assistant' },
      { fact: 'always use dark mode in the editor for all development work', category: 'preference', confidence: 85, speaker: 'user' },
    ];
    const result = mergeFacts(content, facts, 5000);
    assert.equal(result.added, 2);
    assert.ok(result.content.includes('[assistant] the API endpoint'), 'Should prefix assistant fact with [assistant]');
    assert.ok(result.content.includes('[user] always use dark mode'), 'Should prefix user fact with [user]');
  });
});

describe('truncateAtWord', () => {
  it('returns short text unchanged', () => {
    const text = 'hello world';
    assert.equal(truncateAtWord(text, 120), text);
  });

  it('truncates at word boundary instead of mid-word', () => {
    const text = 'the quick brown fox jumps over the lazy dog and keeps running across the field until it reaches the distant mountain range beyond';
    const result = truncateAtWord(text, 80);
    assert.ok(result.length <= 80, `Result should be <= 80 chars, got ${result.length}`);
    assert.ok(!result.endsWith(' '), 'Should not end with a space');
    // Should end at a word boundary (no partial word at the end)
    const lastChar = result[result.length - 1];
    assert.ok(lastChar.match(/[a-z]/i), 'Last char should be a letter, not a mid-word cut');
    // Verify it chose a space-aligned boundary
    assert.ok(text.startsWith(result), 'Result should be a prefix of the original');
  });

  it('falls back to hard slice when last space is too early', () => {
    // A string where the only space is very early — "ab <100+ chars of no-space>"
    const text = 'ab ' + 'x'.repeat(120);
    const result = truncateAtWord(text, 80);
    // lastSpace = 2, which is < 80 * 0.7 = 56, so falls back to hard slice
    assert.equal(result.length, 80, 'Should hard-slice to exactly maxLen');
  });

  it('returns text unchanged when exactly at maxLen', () => {
    const text = 'a'.repeat(120);
    assert.equal(truncateAtWord(text, 120), text);
  });
});

describe('extractFacts confidence removal', () => {
  it('returned fact objects do NOT have a confidence property', () => {
    const messages = [
      { role: 'user', content: "don't use the old authentication endpoint for any API calls going forward" },
      { role: 'assistant', content: "I found that the database config is in /etc/openclaw/db.conf and needs updating" },
    ];
    const facts = extractFacts(messages);
    assert.ok(facts.length > 0, 'Should extract at least one fact');
    for (const f of facts) {
      assert.equal('confidence' in f, false, `Fact should not have confidence property, but found confidence=${f.confidence}`);
    }
  });
});
