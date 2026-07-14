// P0: extraction degradation must never silently corrupt the structured, LLM-owned
// MEMORY.md. When the LLM path is unavailable/fails, the regex fallback must divert its
// speaker-tagged facts to a sibling file and leave the structured index byte-intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFlush } from '../lib/pre-compression-flush.mjs';

const STRUCTURED = `# Memory

## Active Entities
- Arcane (project, mentioned 78×)

## Recent Decisions
- D11 — grappe workers require an advanced LLM

## Active Themes
- federation
`;
const JSONL =
  JSON.stringify({ type: 'user', message: { content: 'never use the local model as a grappe worker please' } }) + '\n' +
  JSON.stringify({ type: 'assistant', message: { content: "I'll wire the harness into the circling worker now" } }) + '\n';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'flush-p0-'));
  const jsonl = join(dir, 's.jsonl');
  const memoryMd = join(dir, 'MEMORY.md');
  writeFileSync(jsonl, JSONL);
  return { jsonl, memoryMd };
}

test('P0: regex fallback does NOT contaminate a structured MEMORY.md — it diverts', async () => {
  const { jsonl, memoryMd } = setup();
  writeFileSync(memoryMd, STRUCTURED);
  const result = await runFlush(jsonl, memoryMd, { charBudget: 2200 }); // no llmClient -> regex path
  const after = readFileSync(memoryMd, 'utf8');
  assert.ok(!/\[assistant\]|\[user\]/.test(after), 'no speaker-tagged lines leaked into MEMORY.md');
  assert.match(after, /## Active Entities/, 'structured headers preserved');
  assert.equal(after, STRUCTURED, 'structured MEMORY.md is byte-for-byte unchanged');
  assert.equal(result.mode, 'regex-diverted');
  const fallback = memoryMd.replace(/\.md$/, '') + '.regex-fallback.md';
  assert.ok(existsSync(fallback), 'regex facts diverted to a fallback file');
  assert.match(readFileSync(fallback, 'utf8'), /\[user\]|\[assistant\]/, 'the speaker-tagged facts live in the fallback');
});

test('P0: on a non-structured MEMORY.md the regex path writes normally (legacy preserved)', async () => {
  const { jsonl, memoryMd } = setup();
  writeFileSync(memoryMd, '# Memory\n\nsome freeform notes\n');
  const result = await runFlush(jsonl, memoryMd, { charBudget: 2200 });
  assert.equal(result.mode, 'regex');
  assert.match(readFileSync(memoryMd, 'utf8'), /\[user\]|\[assistant\]/, 'regex-only mode still merges into MEMORY.md');
});
