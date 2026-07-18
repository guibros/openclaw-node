#!/usr/bin/env node
/**
 * knowledge-index-job.mjs — chunk + embed changed session-store sessions into
 * the knowledge DB, as a CHILD PROCESS of the memory daemon.
 *
 * Why a child process and not the flush worker: the @huggingface/transformers
 * embedder runs on onnxruntime-node, a native addon that fatally crashes the
 * WHOLE process when loaded inside a worker_thread (observed crash loop,
 * audits/inject_hang). Run inline it pins the daemon's microtask queue for
 * minutes per grown session and deafens :7893. A child process isolates both
 * failure modes: native inference gets its own main thread, and a crash kills
 * only the job.
 *
 * Usage: node knowledge-index-job.mjs <statePath> <knowledgePath> [batchLimit]
 * Prints JSON {indexed, chunks} to stdout; exit 0 on success.
 */
import { openStore } from '../lib/sqlite-store.mjs';
import { initDatabase, indexSessionTurns } from '../lib/mcp-knowledge/core.mjs';

const [statePath, knowledgePath, batchArg] = process.argv.slice(2);
const batchLimit = Number(batchArg) || 5;

const knowledgeDb = initDatabase(knowledgePath);
// R22 (repair 5.6): no integrity scan on the 10-min indexing path.
const stateDb = openStore(statePath, { readonly: true, integrityCheck: false });
try {
  const allSessions = stateDb.prepare(
    'SELECT id, source FROM sessions ORDER BY start_time ASC'
  ).all();
  let indexed = 0, chunks = 0;
  for (const session of allSessions) {
    if (indexed >= batchLimit) break;
    // R18 fix (repair 5.1): existence is not freshness — growth pre-filter via
    // turn_count; indexSessionTurns hash-verifies and delete+reinserts when
    // content actually changed.
    const existing = knowledgeDb.prepare(
      'SELECT content_hash, turn_count FROM session_documents WHERE session_id = ?'
    ).get(session.id);
    const liveCount = stateDb.prepare(
      'SELECT COUNT(*) AS n FROM messages WHERE session_id = ?'
    ).get(session.id).n;
    if (existing && existing.turn_count === liveCount) continue;
    const messages = stateDb.prepare(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY turn_index ASC'
    ).all(session.id);
    if (messages.length === 0) continue;
    const turns = messages.map(m => ({ role: m.role, content: m.content }));
    const result = await indexSessionTurns(knowledgeDb, session.id, `session-store://${session.id}`, turns);
    if (result.indexed) {
      indexed++;
      chunks += result.chunks;
    }
  }
  process.stdout.write(JSON.stringify({ indexed, chunks }) + '\n');
} finally {
  stateDb.close();
}
process.exit(0);
