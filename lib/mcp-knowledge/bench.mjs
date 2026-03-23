#!/usr/bin/env node
/**
 * Benchmark: index real workspace files and run search queries
 */
import { pipeline } from '@huggingface/transformers';
import { statSync, rmSync } from 'node:fs';

import {
  scanMarkdownFiles,
  chunkMarkdown,
  hashContent,
  initDatabase,
  EMBEDDING_DIM,
  MAX_CHUNK_CHARS,
  INCLUDE_DIRS,
  EXCLUDE_PATTERNS,
  MODEL_NAME,
} from './core.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const WORKSPACE = process.env.KNOWLEDGE_ROOT || '/Users/moltymac/.openclaw/workspace';
const DB_PATH = '/tmp/mcp-knowledge-bench.db';

// Clean previous run
try { rmSync(DB_PATH); } catch {}

// Init DB
const db = initDatabase(DB_PATH);

const files = scanMarkdownFiles(WORKSPACE, INCLUDE_DIRS, EXCLUDE_PATTERNS);
console.log(`Scanning ${files.length} files...`);

console.log('Loading embedding model...');
const extractor = await pipeline('feature-extraction', MODEL_NAME, { dtype: 'fp32' });
console.log('Model loaded.\n');

const insertDoc = db.prepare('INSERT INTO documents (path, content_hash, last_indexed, chunk_count) VALUES (?, ?, ?, ?)');
const insertChunk = db.prepare('INSERT INTO chunks (doc_path, section, text, snippet) VALUES (?, ?, ?, ?)');

let totalChunks = 0;
let totalFiles = 0;
const start = Date.now();

for (const file of files) {
  let content;
  try { content = readFileSync(file.path, 'utf-8'); } catch { continue; }
  if (!content.trim()) continue;

  const hash = hashContent(content);
  const chunks = chunkMarkdown(content);
  const vectors = [];
  for (const c of chunks) {
    const r = await extractor(c.text, { pooling: 'mean', normalize: true, truncation: true, max_length: 256 });
    vectors.push(new Float32Array(r.data));
  }

  db.transaction(() => {
    insertDoc.run(file.rel, hash, Date.now(), chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      const snippet = chunks[i].text.slice(0, 250).replace(/\n/g, ' ');
      const info = insertChunk.run(file.rel, chunks[i].section, chunks[i].text, snippet);
      const vecBuf = Buffer.from(vectors[i].buffer);
      db.prepare(`INSERT INTO chunk_vectors VALUES (${info.lastInsertRowid}, ?)`).run(vecBuf);
    }
  })();
  totalChunks += chunks.length;
  totalFiles++;
  if (totalFiles % 50 === 0) console.log(`  ${totalFiles}/${files.length} files, ${totalChunks} chunks...`);
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nIndexed: ${totalFiles} files → ${totalChunks} chunks in ${elapsed}s`);

// Search queries
console.log('\n═══ Semantic Search Tests ═══');
async function search(query) {
  const t0 = Date.now();
  const r = await extractor(query, { pooling: 'mean', normalize: true, truncation: true, max_length: 256 });
  const buf = Buffer.from(new Float32Array(r.data).buffer);
  const results = db.prepare(`
    SELECT cv.distance, c.doc_path, c.section, c.snippet
    FROM chunk_vectors cv JOIN chunks c ON c.id = cv.rowid
    WHERE embedding MATCH ? AND k = 5 ORDER BY distance
  `).all(buf);
  const ms = Date.now() - t0;
  return { results, ms };
}

const queries = [
  'oracle threat model GPS spoofing',
  'faction lore verdant pact nature magic',
  'smart contract mana well architecture',
  'Daedalus identity soul companion',
  'what is the mana harvesting mechanism',
  'biome oracle location verification',
];

for (const q of queries) {
  const { results, ms } = await search(q);
  console.log(`\nQuery: "${q}" (${ms}ms)`);
  for (const r of results.slice(0, 3)) {
    const score = (1 - r.distance * r.distance / 2).toFixed(3);
    console.log(`  [${score}] ${r.doc_path} → ${r.section.slice(0, 60)}`);
  }
}

// Stats
const { size } = statSync(DB_PATH);
console.log(`\n═══ Stats ═══`);
console.log(`DB size: ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`Files: ${totalFiles}`);
console.log(`Chunks: ${totalChunks}`);
console.log(`Index time: ${elapsed}s`);
console.log(`Avg per file: ${(parseFloat(elapsed) * 1000 / totalFiles).toFixed(0)}ms`);

db.close();
setTimeout(() => process.exit(0), 200);
