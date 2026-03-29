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

describe('createBudget', () => {
  it('creates budget with correct file path', () => {
    const mb = createBudget(tmpDir);
    assert.equal(mb.filePath, path.join(tmpDir, 'MEMORY.md'));
  });
});
