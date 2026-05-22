/**
 * test/embed-benchmark.test.mjs — Embedding model identity + latency benchmark
 *
 * Step 2.2 deliverable: validates the frozen embedding model choice
 * (Xenova/bge-m3, 1024-dim, multilingual — upgraded 2026-05-22 from
 * MiniLM-L6-v2 per operator decision for worldwide node deployment).
 * Validates dimension, L2 normalization, and proves latency meets the
 * 500ms/turn target on representative session turn data.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  embed,
  chunkSessionTurns,
  getEmbedder,
  MODEL_NAME,
  EMBEDDING_DIM,
} from '../lib/mcp-knowledge/core.mjs';

// ── Synthetic turns representative of real session patterns ──────────────────

const SYNTHETIC_TURNS = [
  { role: 'user', content: 'How do I configure NATS JetStream for local event logging with file-backed storage?' },
  { role: 'assistant', content: 'Create a JetStream stream with R=1 replication for local-only durability. Use file-backed storage and a subject filter like `local.>` to isolate local events from shared federation subjects. The stream config should specify FileStorage and set max_bytes based on your retention needs.' },
  { role: 'user', content: 'What embedding model should we use for the semantic search layer?' },
  { role: 'assistant', content: 'The current stack uses Xenova/all-MiniLM-L6-v2 via @huggingface/transformers. It produces 384-dimensional embeddings with mean pooling and L2 normalization. The model truncates at 256 word-piece tokens, roughly 1000 characters. For most session turns this is sufficient since the semantic signal concentrates in the opening sentences.' },
  { role: 'user', content: 'Can you review the pre-compression flush logic in memory-daemon?' },
  { role: 'assistant', content: 'The extractFacts function scans both user and assistant messages for patterns like preferences, decisions, technical facts, and project references. Each match produces a { fact, category, speaker } object. The mergeFacts step deduplicates via cosine similarity with a 0.7 threshold, using the supersedes-comment model for audit trails.' },
  { role: 'user', content: 'I need to debug the sqlite-vec distance calculation — results seem wrong.' },
  { role: 'assistant', content: 'The vec0 virtual table returns raw L2 distance, not cosine similarity. The score formula is `1 - distance² / 2` which converts L2 distance to cosine similarity for normalized vectors. Make sure your query embeddings are normalized — if they are not, the distance values will be unreliable. Check with: `SELECT vec_length(embedding) FROM chunk_vectors LIMIT 1`.' },
  { role: 'user', content: 'How does the content-addressed artifact store handle concurrent writes?' },
  { role: 'assistant', content: 'putArtifact computes SHA-256 first, then checks if the target path exists. If the file already exists the write is skipped — idempotent by design. The sharded directory layout (sha256/<2>/<2>/<hash>) prevents filesystem bottlenecks from too many files in one directory. Concurrent writes to different hashes are safe; concurrent writes to the same hash are also safe since the content is identical.' },
  { role: 'user', content: 'Explain the memory budget reload mechanism.' },
  { role: 'assistant', content: 'MemoryBudget.reload() re-reads MEMORY.md from disk and updates the in-memory state. It fires after both daemon flush paths: pre-compression at the 30-minute mark and end-of-session cleanup. There is also an optional NATS subscription on mesh.memory.compaction_completed that triggers reload when a peer node signals compaction.' },
  { role: 'user', content: 'What is the session-store FTS5 ranking formula?' },
  { role: 'assistant', content: 'Session search uses BM25 ranking via FTS5 with a recency weight multiplier. The formula combines match_count (number of FTS5 hits within a session) with a time-decay factor: sessions from the last 7 days get full weight, older sessions decay exponentially. Results are grouped by session_id and ranked by the combined score.' },
  { role: 'user', content: 'How do I add a new event type to the schema package?' },
  { role: 'assistant', content: 'Create a new file in packages/event-schemas/src/memory/ following the existing pattern. Define a Zod schema that extends EventEnvelopeSchema with a literal event_type discriminator and a typed data payload. Then add it to the discriminated union in src/events.ts and re-export from src/memory/index.ts. Run the build before testing: the pretest hook compiles TypeScript.' },
  { role: 'user', content: 'The daily log writer is crashing on startup — something about .companion-state.md.' },
  { role: 'assistant', content: 'The file was renamed in Step 0.2 from .companion-state.md to .daemon-state-${NODE_ID}.md. Check that daily-log-writer.mjs uses the new path pattern. The NODE_ID is derived from process.env.OPENCLAW_NODE_ID or os.hostname(). If the old file still exists, run scripts/migrate-companion-state.mjs to rename it.' },
  { role: 'user', content: 'Can you show me how the spreading activation algorithm works conceptually?' },
  { role: 'assistant', content: 'Spreading activation starts with seed nodes (concepts mentioned in the query) and propagates activation through the concept graph. Each step multiplies the current activation by edge weight and a decay factor (0.7 default), then takes the max at each target node. After 3 steps, nodes below a threshold (0.1 default) are pruned. The result is a ranked list of associated concepts that may not share keywords but are semantically connected through the graph structure.' },
];

// Generate 100 turns by cycling through the synthetic data
function generateTurns(count) {
  const turns = [];
  for (let i = 0; i < count; i++) {
    const src = SYNTHETIC_TURNS[i % SYNTHETIC_TURNS.length];
    turns.push({ role: src.role, content: src.content });
  }
  return turns;
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('embedding model identity', () => {
  it('model name matches Block 2 frozen decision (Xenova/bge-m3)', () => {
    assert.strictEqual(MODEL_NAME, 'Xenova/bge-m3',
      'MODEL_NAME must match frozen decision (upgraded 2026-05-22 from MiniLM-L6-v2)');
  });

  it('embedding dimension is 1024', async () => {
    const vec = await embed('test sentence for dimension check');
    assert.strictEqual(vec.length, EMBEDDING_DIM, `expected ${EMBEDDING_DIM}-dim vector`);
    assert.strictEqual(EMBEDDING_DIM, 1024, 'EMBEDDING_DIM constant is 1024 (BGE-M3)');
  });

  it('embedding output is L2-normalized (norm ≈ 1.0)', async () => {
    const vec = await embed('The artifact store uses SHA-256 content addressing');
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
    const norm = Math.sqrt(sumSq);
    assert.ok(Math.abs(norm - 1.0) < 0.01,
      `L2 norm should be ≈1.0, got ${norm.toFixed(4)}`);
  });
});

describe('embedding latency benchmark', () => {
  before(async () => {
    // Warm up the model (first call loads ONNX weights from cache)
    await getEmbedder();
    await embed('warm-up sentence to load model weights');
  });

  it('per-turn embedding latency under 500ms (mean of 50 turns)', async () => {
    const turns = generateTurns(50);
    const chunks = chunkSessionTurns(turns);
    assert.ok(chunks.length >= 50, `expected ≥50 chunks, got ${chunks.length}`);

    const latencies = [];
    for (const chunk of chunks) {
      const t0 = performance.now();
      await embed(chunk.text);
      latencies.push(performance.now() - t0);
    }

    latencies.sort((a, b) => a - b);
    const mean = latencies.reduce((s, v) => s + v, 0) / latencies.length;
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    // Log benchmark results (captured in tick stdout)
    console.log(`  Embedding benchmark (${chunks.length} chunks):`);
    console.log(`    Mean: ${mean.toFixed(1)}ms | P50: ${p50.toFixed(1)}ms | P95: ${p95.toFixed(1)}ms`);

    // BGE-M3 latency target: 500ms mean (vs MiniLM's 100ms). ~3-5x larger
    // model, ONNX CPU inference; acceptable for interactive use.
    assert.ok(mean < 500,
      `mean latency ${mean.toFixed(1)}ms exceeds 500ms/turn target`);
  });

  it('batch of 100 turns completes in under 60 seconds', async () => {
    const turns = generateTurns(100);
    const chunks = chunkSessionTurns(turns);
    assert.ok(chunks.length >= 100, `expected ≥100 chunks, got ${chunks.length}`);

    const t0 = performance.now();
    for (const chunk of chunks) {
      await embed(chunk.text);
    }
    const elapsed = performance.now() - t0;
    const throughput = (chunks.length / (elapsed / 1000)).toFixed(1);

    console.log(`  Batch benchmark (${chunks.length} chunks):`);
    console.log(`    Total: ${(elapsed / 1000).toFixed(2)}s | Throughput: ${throughput} chunks/s`);

    assert.ok(elapsed < 60000,
      `batch of ${chunks.length} turns took ${(elapsed / 1000).toFixed(2)}s, exceeds 60s limit`);
  });
});
