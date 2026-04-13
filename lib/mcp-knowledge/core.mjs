/**
 * @openclaw/mcp-knowledge — core logic
 *
 * Scanner, chunker, embedder, indexer, search.
 * Transport-agnostic: imported by server.mjs, test.mjs, bench.mjs.
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { pipeline } from '@huggingface/transformers';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

// ─── Configuration ───────────────────────────────────────────────────────────

export const WORKSPACE = process.env.KNOWLEDGE_ROOT || process.cwd();
export const DB_PATH = process.env.KNOWLEDGE_DB || join(WORKSPACE, '.knowledge.db');
export const MODEL_NAME = process.env.KNOWLEDGE_MODEL || 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;
// all-MiniLM-L6-v2 truncates at 256 word-piece tokens (~1000 chars).
// We chunk at 1800 chars; tail content beyond ~256 tokens is truncated at embed time.
// This is acceptable: headings and opening sentences carry the most semantic signal.
export const MAX_CHUNK_CHARS = 1800;
export const POLL_INTERVAL_MS = parseInt(process.env.KNOWLEDGE_POLL_MS || '300000', 10);
export const SNIPPET_LENGTH = 250;

const INCLUDE_DIRS_DEFAULT = [
  'memory/',
  'projects/arcane/lore/',
  'projects/arcane/knowledge_base/',
  'projects/arcane/notes/',
  'projects/arcane/geoblar/',
  '.learnings/',
  'SOUL.md',
  'PRINCIPLES.md',
  'AGENTS.md',
  'MEMORY.md',
  'ARCHITECTURE.md',
];
export const INCLUDE_DIRS = process.env.KNOWLEDGE_INCLUDE
  ? process.env.KNOWLEDGE_INCLUDE.split(',').map(s => s.trim()).filter(Boolean)
  : INCLUDE_DIRS_DEFAULT;

export const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.sol$/,
  /\.pdf$/,
  /\.json$/,
  /\.lock$/,
  /\.png$/,
  /\.jpg$/,
  /\.gif$/,
  /\.svg$/,
  /active-tasks\.md$/,
  /task-backlog\.md$/,
  /\.bak$/,
  /\.smart-env/,
  /\.obsidian/,
  /cache\//,
  /artifacts\//,
];

// ─── Markdown Scanner ────────────────────────────────────────────────────────

export function scanMarkdownFiles(root, includePaths, excludePatterns) {
  const files = [];
  for (const inc of includePaths) {
    const fullPath = join(root, inc);
    if (!existsSync(fullPath)) continue;
    const stat = statSync(fullPath);
    if (stat.isFile() && fullPath.endsWith('.md')) {
      const rel = relative(root, fullPath);
      if (!excludePatterns.some(p => p.test(rel))) {
        files.push({ path: fullPath, rel });
      }
    } else if (stat.isDirectory()) {
      walkDir(fullPath, root, excludePatterns, files);
    }
  }
  return files;
}

function walkDir(dir, root, excludePatterns, results) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (excludePatterns.some(p => p.test(rel))) continue;
    if (entry.isDirectory()) {
      walkDir(full, root, excludePatterns, results);
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      results.push({ path: full, rel });
    }
  }
}

// ─── Heading-Based Chunker ───────────────────────────────────────────────────

export function chunkMarkdown(text, filePath) {
  const lines = text.split('\n');
  const chunks = [];
  let currentSection = '';
  let currentBody = [];
  let currentLevel = 0;

  function flushChunk() {
    const body = currentBody.join('\n').trim();
    if (!body) return;
    const fullText = currentSection ? `${currentSection}\n${body}` : body;
    if (fullText.length <= MAX_CHUNK_CHARS) {
      chunks.push({ section: currentSection || '(top)', text: fullText });
    } else {
      splitOversized(currentSection, body, currentLevel, chunks);
    }
  }

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      flushChunk();
      currentLevel = headerMatch[1].length;
      currentSection = line.trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  flushChunk();

  return chunks.length > 0 ? chunks : [{ section: '(document)', text: text.slice(0, MAX_CHUNK_CHARS) }];
}

export function splitOversized(section, body, level, chunks) {
  const nextLevel = level + 1;
  if (nextLevel <= 6) {
    const subPattern = new RegExp(`^#{${nextLevel}}\\s+.+$`, 'm');
    if (subPattern.test(body)) {
      const subLines = body.split('\n');
      let subSection = section;
      let subBody = [];

      for (const line of subLines) {
        const subMatch = line.match(new RegExp(`^(#{${nextLevel}})\\s+(.+)$`));
        if (subMatch) {
          const subText = subBody.join('\n').trim();
          if (subText) {
            const full = subSection ? `${subSection}\n${subText}` : subText;
            if (full.length <= MAX_CHUNK_CHARS) {
              chunks.push({ section: subSection || '(top)', text: full });
            } else {
              splitOversized(subSection, subText, nextLevel, chunks);
            }
          }
          subSection = line.trim();
          subBody = [];
        } else {
          subBody.push(line);
        }
      }
      const remaining = subBody.join('\n').trim();
      if (remaining) {
        const full = subSection ? `${subSection}\n${remaining}` : remaining;
        if (full.length <= MAX_CHUNK_CHARS) {
          chunks.push({ section: subSection || '(top)', text: full });
        } else {
          splitByParagraphs(subSection, remaining, chunks);
        }
      }
      return;
    }
  }
  splitByParagraphs(section, body, chunks);
}

export function splitByParagraphs(section, text, chunks) {
  const paragraphs = text.split(/\n\n+/);
  let buffer = '';
  let idx = 0;
  for (const para of paragraphs) {
    if (buffer.length + para.length + 2 > MAX_CHUNK_CHARS && buffer) {
      chunks.push({ section: `${section} [part ${++idx}]`, text: buffer.trim() });
      buffer = '';
    }
    buffer += (buffer ? '\n\n' : '') + para;
  }
  if (buffer.trim()) {
    chunks.push({
      section: idx > 0 ? `${section} [part ${++idx}]` : (section || '(document)'),
      text: buffer.trim(),
    });
  }
}

// ─── SHA-256 Content Hashing ─────────────────────────────────────────────────

export function hashContent(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ─── SQLite + sqlite-vec Storage ─────────────────────────────────────────────

export function initDatabase(dbPath) {
  const db = new Database(dbPath);
  sqliteVec.load(db);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      last_indexed INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_path TEXT NOT NULL,
      section TEXT NOT NULL,
      text TEXT NOT NULL,
      snippet TEXT NOT NULL,
      FOREIGN KEY (doc_path) REFERENCES documents(path) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
      embedding float[${EMBEDDING_DIM}]
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_doc_path ON chunks(doc_path);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  return db;
}

// ─── Embedding Pipeline ──────────────────────────────────────────────────────

let embedder = null;

export async function getEmbedder() {
  if (!embedder) {
    try {
      embedder = await pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'fp32',
      });
    } catch (err) {
      throw new Error(
        `Embedding model not cached. Run with internet access to download ${MODEL_NAME} (~17MB, one-time).\n` +
        `Original error: ${err.message}`
      );
    }
  }
  return embedder;
}

export async function embed(text) {
  const model = await getEmbedder();
  const result = await model(text, { pooling: 'mean', normalize: true, truncation: true, max_length: 256 });
  return new Float32Array(result.data);
}

export async function embedBatch(texts) {
  const results = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

// ─── Indexer ─────────────────────────────────────────────────────────────────

export async function indexWorkspace(db, root, opts = {}) {
  const force = opts.force || false;
  const files = scanMarkdownFiles(root, INCLUDE_DIRS, EXCLUDE_PATTERNS);

  const getDoc = db.prepare('SELECT content_hash FROM documents WHERE path = ?');
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE doc_path = ?');
  const deleteDoc = db.prepare('DELETE FROM documents WHERE path = ?');
  const insertDoc = db.prepare(
    'INSERT OR REPLACE INTO documents (path, content_hash, last_indexed, chunk_count) VALUES (?, ?, ?, ?)'
  );
  const insertChunk = db.prepare(
    'INSERT INTO chunks (doc_path, section, text, snippet) VALUES (?, ?, ?, ?)'
  );
  const deleteVec = db.prepare('DELETE FROM chunk_vectors WHERE rowid = ?');
  const getChunkIds = db.prepare('SELECT id FROM chunks WHERE doc_path = ?');

  const existingPaths = new Set(
    db.prepare('SELECT path FROM documents').all().map(r => r.path)
  );
  const currentPaths = new Set(files.map(f => f.rel));

  let indexed = 0;
  let skipped = 0;
  let deleted = 0;

  // Delete removed files
  for (const existingPath of existingPaths) {
    if (!currentPaths.has(existingPath)) {
      const chunkIds = getChunkIds.all(existingPath);
      for (const { id } of chunkIds) {
        deleteVec.run(id);
      }
      deleteChunks.run(existingPath);
      deleteDoc.run(existingPath);
      deleted++;
    }
  }

  // Index new/changed files
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file.path, 'utf-8');
    } catch {
      continue;
    }

    const hash = hashContent(content);
    const existing = getDoc.get(file.rel);

    if (!force && existing && existing.content_hash === hash) {
      skipped++;
      continue;
    }

    // Remove old chunks + vectors for this doc
    if (existing) {
      const oldChunkIds = getChunkIds.all(file.rel);
      for (const { id } of oldChunkIds) {
        deleteVec.run(id);
      }
      deleteChunks.run(file.rel);
    }

    // Chunk and embed
    const chunks = chunkMarkdown(content, file.rel);
    const texts = chunks.map(c => c.text);
    const vectors = await embedBatch(texts);

    // sqlite-vec quirk: rowid must be literal, not bound param with better-sqlite3.
    const doInsert = db.transaction(() => {
      insertDoc.run(file.rel, hash, Date.now(), chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        const snippet = chunks[i].text.slice(0, SNIPPET_LENGTH).replace(/\n/g, ' ');
        const info = insertChunk.run(file.rel, chunks[i].section, chunks[i].text, snippet);
        const vecBuf = Buffer.from(vectors[i].buffer);
        db.prepare(`INSERT INTO chunk_vectors VALUES (${info.lastInsertRowid}, ?)`).run(vecBuf);
      }
    });
    doInsert();
    indexed++;
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'last_index_time', Date.now().toString()
  );

  return { indexed, skipped, deleted, total: files.length };
}

// ─── Search Functions ────────────────────────────────────────────────────────

export async function semanticSearch(db, query, limit = 10) {
  const count = db.prepare('SELECT COUNT(*) as c FROM chunk_vectors').get().c;
  if (count === 0) return [];

  const queryVec = await embed(query);
  const vecBuf = Buffer.from(queryVec.buffer);

  const results = db.prepare(`
    SELECT
      cv.rowid,
      cv.distance,
      c.doc_path,
      c.section,
      c.snippet
    FROM chunk_vectors cv
    JOIN chunks c ON c.id = cv.rowid
    WHERE embedding MATCH ? AND k = ${limit}
    ORDER BY distance
  `).all(vecBuf);

  return results.map(r => ({
    path: r.doc_path,
    section: r.section,
    score: parseFloat((1 - r.distance * r.distance / 2).toFixed(4)),
    snippet: r.snippet,
  }));
}

export async function findRelated(db, docPath, limit = 10) {
  const chunkIds = db.prepare('SELECT id FROM chunks WHERE doc_path = ?').all(docPath);

  if (chunkIds.length === 0) {
    return { error: `Document not found in index: ${docPath}` };
  }

  const vectors = [];
  for (const { id } of chunkIds) {
    const row = db.prepare('SELECT embedding FROM chunk_vectors WHERE rowid = ?').get(id);
    if (row) {
      vectors.push(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, EMBEDDING_DIM));
    }
  }

  if (vectors.length === 0) {
    return { error: `No embeddings found for: ${docPath}` };
  }

  // Average the vectors
  const avg = new Float32Array(EMBEDDING_DIM);
  for (const vec of vectors) {
    for (let i = 0; i < EMBEDDING_DIM; i++) avg[i] += vec[i];
  }
  for (let i = 0; i < EMBEDDING_DIM; i++) avg[i] /= vectors.length;

  // Normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += avg[i] * avg[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) avg[i] /= norm;
  }

  const vecBuf = Buffer.from(avg.buffer);

  const rawResults = db.prepare(`
    SELECT
      cv.rowid,
      cv.distance,
      c.doc_path,
      c.section,
      c.snippet
    FROM chunk_vectors cv
    JOIN chunks c ON c.id = cv.rowid
    WHERE embedding MATCH ? AND k = ${limit * 3}
    ORDER BY distance
  `).all(vecBuf);

  const results = rawResults.filter(r => r.doc_path !== docPath);

  // Deduplicate by document (keep best score per doc)
  const seen = new Map();
  for (const r of results) {
    if (!seen.has(r.doc_path) || r.distance < seen.get(r.doc_path).distance) {
      seen.set(r.doc_path, r);
    }
  }

  return [...seen.values()].slice(0, limit).map(r => ({
    path: r.doc_path,
    section: r.section,
    score: parseFloat((1 - r.distance * r.distance / 2).toFixed(4)),
    snippet: r.snippet,
  }));
}

export function getStats(db) {
  const docs = db.prepare('SELECT COUNT(*) as count FROM documents').get();
  const chunks = db.prepare('SELECT COUNT(*) as count FROM chunks').get();
  const lastIndex = db.prepare('SELECT value FROM meta WHERE key = ?').get('last_index_time');

  return {
    documents: docs.count,
    chunks: chunks.count,
    embedding_dim: EMBEDDING_DIM,
    model: MODEL_NAME,
    workspace: WORKSPACE,
    db_path: DB_PATH,
    last_indexed: lastIndex ? new Date(parseInt(lastIndex.value)).toISOString() : null,
  };
}

// ─── Background Polling ──────────────────────────────────────────────────────

export function startPolling(db, root) {
  if (POLL_INTERVAL_MS <= 0) return;
  async function poll() {
    try {
      await indexWorkspace(db, root);
    } catch (err) {
      process.stderr.write(`[mcp-knowledge] poll error: ${err.message}\n`);
    }
    setTimeout(poll, POLL_INTERVAL_MS);
  }
  setTimeout(poll, POLL_INTERVAL_MS);
}

// ─── Engine Factory ──────────────────────────────────────────────────────────

export async function createKnowledgeEngine(opts = {}) {
  const workspace = opts.workspace || WORKSPACE;
  const dbPath = opts.dbPath || DB_PATH;

  process.stderr.write(`[mcp-knowledge] workspace: ${workspace}\n`);
  process.stderr.write(`[mcp-knowledge] database: ${dbPath}\n`);
  process.stderr.write(`[mcp-knowledge] model: ${MODEL_NAME}\n`);

  const db = initDatabase(dbPath);

  process.stderr.write('[mcp-knowledge] initial indexing...\n');
  const result = await indexWorkspace(db, workspace);
  process.stderr.write(
    `[mcp-knowledge] indexed: ${result.indexed}, skipped: ${result.skipped}, deleted: ${result.deleted}, total: ${result.total}\n`
  );

  startPolling(db, workspace);

  return {
    db,
    search: (query, limit) => semanticSearch(db, query, limit),
    related: (docPath, limit) => findRelated(db, docPath, limit),
    reindex: (force) => indexWorkspace(db, workspace, { force }),
    stats: () => getStats(db),
  };
}
