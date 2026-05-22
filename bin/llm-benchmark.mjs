#!/usr/bin/env node

/**
 * LLM latency benchmark for the local extraction LLM (default: Qwen3-8B via Ollama).
 *
 * Generates a synthetic 40-turn session and measures structured-output extraction
 * latency. Target: total ≤30 seconds (per Block 3 frozen decisions).
 *
 * Usage:
 *   node bin/llm-benchmark.mjs [--base-url URL] [--model NAME] [--turns N]
 *
 * Requires a local OpenAI-compatible LLM server running. Default is Ollama:
 *   brew install ollama && ollama pull qwen3:8b-instruct-q4_K_M
 *   ollama serve  # listens on http://localhost:11434
 * Operators may also use mlx-lm, llama-server, or vLLM by passing --base-url.
 */

import { parseArgs } from 'node:util';
import { createLlmClient, DEFAULT_BASE_URL, DEFAULT_MODEL } from '../lib/llm-client.mjs';

// --- Synthetic session generator ---

const TURN_TEMPLATES = [
  { role: 'user', content: 'Can you look at the NATS JetStream configuration? I think the R=3 replication is failing on the Ubuntu node.' },
  { role: 'assistant', content: 'I\'ll check the JetStream cluster status. Let me query the stream info for OPENCLAW_SHARED.' },
  { role: 'user', content: 'The error says "insufficient peers" — we only have 2 nodes online right now.' },
  { role: 'assistant', content: 'That explains it. R=3 requires 3 nodes for a quorum. The stream can\'t replicate until the third node comes back. The local R=1 stream is unaffected.' },
  { role: 'user', content: 'Should we temporarily drop to R=1 for the shared stream?' },
  { role: 'assistant', content: 'I\'d recommend keeping R=3 as the target config but adding a health check that warns when the cluster is degraded. Dropping replication loses durability guarantees.' },
  { role: 'user', content: 'What about the memory budget? I noticed MEMORY.md isn\'t updating after compaction.' },
  { role: 'assistant', content: 'I found the issue. The reload() call in the daemon flush path isn\'t awaited. The compaction finishes but the budget still has stale content. Let me fix that.' },
  { role: 'user', content: 'Also, the entity extraction is pulling way too many low-salience items. We need a threshold.' },
  { role: 'assistant', content: 'I\'ll add a salience threshold of 0.3 to the extraction pipeline. Entities below that get logged but not promoted to the entity store.' },
  { role: 'user', content: 'How\'s the embedding performance on the M4? The migration script seems slow.' },
  { role: 'assistant', content: 'The BGE-M3 model runs at about 200-300ms per embedding on M4. For 10K turns that\'s roughly 30-50 minutes. The checkpoint file lets you resume if it\'s interrupted.' },
  { role: 'user', content: 'Let\'s look at the spreading activation parameters. The decay of 0.7 seems too aggressive.' },
  { role: 'assistant', content: 'I ran tests with decay values from 0.5 to 0.9. At 0.7, useful associations 3 hops away are below the 0.1 threshold. I\'d suggest 0.8 with threshold 0.05.' },
  { role: 'user', content: 'The daily log writer is still using the old companion-state path. Did the migration miss it?' },
  { role: 'assistant', content: 'I noticed that too. The variable name was renamed but the actual path computation still uses the old format. Let me trace through daily-log-writer.mjs line by line.' },
  { role: 'user', content: 'Can you run the hybrid search benchmark? I want to see if FTS5 is keeping up with semantic on the new query set.' },
  { role: 'assistant', content: 'Running now. FTS5 returned 2/25 hits (it fails on natural language queries). Semantic returned 25/25 with on-target snippets. Hybrid matches semantic on all queries.' },
  { role: 'user', content: 'That confirms the Gulf 1 result. FTS5 is fundamentally broken for natural language. Semantic is the way forward.' },
  { role: 'assistant', content: 'Agreed. The FTS5 tokenizer treats spaces as AND operators, so multi-word queries become intersection searches. That\'s why "where did we discuss NATS" returns nothing — it needs all tokens present in one chunk.' },
  { role: 'user', content: 'Let\'s move on to the extraction schema. What fields do we need for the ExtractionResult?' },
  { role: 'assistant', content: 'Based on the reference plan: entities (name, type, salience), themes (label, hierarchy), actions, decisions (decision, rationale, confidence), friction_signals (signal, severity), and relationships (source, target, type).' },
  { role: 'user', content: 'Add a "context" field to decisions — I want to know which part of the conversation led to each decision.' },
  { role: 'assistant', content: 'Good idea. I\'ll add a context field with the relevant turn indices. That also helps with provenance tracking when decisions are promoted to the shared stream.' },
  { role: 'user', content: 'The artifact store needs a cleanup job. Some of the .meta.json sidecars are orphaned.' },
  { role: 'assistant', content: 'I\'ll add a validateStore() function that walks the artifact tree, checks each hash against its sidecar, and reports orphans. We can run it as part of the consolidation cycle.' },
  { role: 'user', content: 'How do we handle the case where the LLM extraction fails mid-session? The daemon can\'t hang.' },
  { role: 'assistant', content: 'The extraction call should have a 60-second timeout. On failure, fall back to the regex extractor (feature flag USE_LLM_EXTRACTION). Log the failure for debugging but don\'t block the flush path.' },
  { role: 'user', content: 'Check if the session-store has the schema migration for the new entity tables.' },
  { role: 'assistant', content: 'Not yet — the entity/theme/mention/decision tables are part of Step 3.3. For now the session-store schema is unchanged. I\'ll make sure the migration is idempotent when we add it.' },
  { role: 'user', content: 'Last thing — the broadcast protocol needs rate limiting. We can\'t have nodes spamming context.broadcast every turn.' },
  { role: 'assistant', content: 'I\'ll add a cooldown per theme-set: if a broadcast with similar themes was sent in the last 60 minutes, skip. The consolidation cycle naturally throttles this since broadcasts only fire during quiet periods.' },
  { role: 'user', content: 'Great. Let\'s wrap up and commit what we have.' },
  { role: 'assistant', content: 'Summary of this session: fixed the reload() await issue, discussed extraction schema additions (context field on decisions), identified the daily-log-writer path bug, confirmed Gulf 1 results, and planned rate limiting for broadcasts.' },
  { role: 'user', content: 'One more — check if the Obsidian vault auto-generation is creating duplicate concept notes.' },
  { role: 'assistant', content: 'I\'ll add a dedup check in the concept note generator: before creating a new note, query the vault index for existing notes with the same canonical entity name. If found, update the existing note instead of creating a new one.' },
  { role: 'user', content: 'And make sure wikilinks use the canonical name, not aliases.' },
  { role: 'assistant', content: 'Right. The wikilink format should be [[Canonical Name|display text]] so the graph parser always resolves to the canonical node. Aliases go in the frontmatter for search.' },
  { role: 'user', content: 'OK I think we\'re good. Ship it.' },
  { role: 'assistant', content: 'All changes staged and committed. Session complete.' },
];

export function generateSyntheticSession(turnCount = 40) {
  const turns = [];
  for (let i = 0; i < turnCount; i++) {
    turns.push(TURN_TEMPLATES[i % TURN_TEMPLATES.length]);
  }
  return turns;
}

// --- Benchmark runner ---

const EXTRACTION_SYSTEM_PROMPT = `You are a structured data extraction assistant. Given a conversation transcript, extract the following as JSON:

{
  "entities": [{ "name": "string", "type": "person|project|technology|file|concept|company", "salience": 0.0-1.0 }],
  "themes": [{ "label": "string", "hierarchy": ["parent", "child"] }],
  "actions": ["debugging", "designing", "planning", "implementing", "reviewing", "researching"],
  "decisions": [{ "decision": "string", "rationale": "string", "confidence": 0.0-1.0 }],
  "friction_signals": [{ "signal": "string", "severity": "low|medium|high" }],
  "relationships": [{ "source": "string", "target": "string", "type": "depends_on|contradicts|instance_of|causes|follows" }]
}

Return ONLY valid JSON. No markdown, no explanation.`;

export async function runBenchmark(client, turns) {
  const transcript = turns.map(t => `[${t.role}]: ${t.content}`).join('\n');

  const messages = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: `Extract structured data from this conversation:\n\n${transcript}` },
  ];

  const start = performance.now();
  const result = await client.generate(messages, { jsonMode: true, maxTokens: 4096, temperature: 0.1 });
  const elapsed = performance.now() - start;

  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(result.content);
  } catch (e) {
    parseError = e.message;
  }

  return {
    elapsed_ms: Math.round(elapsed),
    elapsed_s: (elapsed / 1000).toFixed(1),
    content_length: result.content.length,
    finish_reason: result.finishReason,
    usage: result.usage,
    json_valid: parsed !== null,
    parse_error: parseError,
    has_entities: Array.isArray(parsed?.entities),
    has_themes: Array.isArray(parsed?.themes),
    has_decisions: Array.isArray(parsed?.decisions),
    pass: elapsed <= 30_000,
  };
}

// --- CLI entry point ---

async function main() {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: DEFAULT_BASE_URL },
      'model': { type: 'string', default: DEFAULT_MODEL },
      'turns': { type: 'string', default: '40' },
    },
  });

  const baseUrl = values['base-url'];
  const model = values['model'];
  const turnCount = parseInt(values['turns'], 10);

  console.log(`LLM Benchmark — Structured Output Extraction`);
  console.log(`Server:  ${baseUrl}`);
  console.log(`Model:   ${model}`);
  console.log(`Turns:   ${turnCount}`);
  console.log(`Target:  ≤30 seconds total`);
  console.log('---');

  const client = createLlmClient({ baseUrl, model, timeout: 120_000 });

  // Health check
  console.log('Health check...');
  const health = await client.healthCheck();
  if (!health.ok) {
    console.error(`FAIL: server not reachable at ${baseUrl}`);
    console.error(`Error: ${health.error}`);
    console.error('\nMake sure a local OpenAI-compatible LLM server is running.');
    console.error('Ollama (default):');
    console.error(`  ollama pull ${model}`);
    console.error('  ollama serve');
    console.error('Or override --base-url to point at mlx-lm / llama-server / vLLM.');
    process.exit(1);
  }
  console.log(`Server OK — model loaded: ${health.model}`);
  console.log('---');

  // Generate synthetic session
  const turns = generateSyntheticSession(turnCount);
  console.log(`Generated ${turns.length}-turn synthetic session`);
  console.log(`Transcript length: ${turns.map(t => t.content).join('').length} chars`);
  console.log('---');

  // Run benchmark
  console.log('Running extraction...');
  const result = await runBenchmark(client, turns);

  // Report
  console.log('');
  console.log('=== RESULTS ===');
  console.log(`Total time:      ${result.elapsed_s}s (${result.elapsed_ms}ms)`);
  console.log(`Target:          ≤30s`);
  console.log(`Pass:            ${result.pass ? 'YES' : 'NO'}`);
  console.log(`Finish reason:   ${result.finish_reason}`);
  console.log(`Output length:   ${result.content_length} chars`);
  console.log(`JSON valid:      ${result.json_valid}`);
  if (result.parse_error) console.log(`Parse error:     ${result.parse_error}`);
  if (result.json_valid) {
    console.log(`Has entities:    ${result.has_entities}`);
    console.log(`Has themes:      ${result.has_themes}`);
    console.log(`Has decisions:   ${result.has_decisions}`);
  }
  if (result.usage) {
    console.log(`Prompt tokens:   ${result.usage.prompt_tokens}`);
    console.log(`Output tokens:   ${result.usage.completion_tokens}`);
    console.log(`Total tokens:    ${result.usage.total_tokens}`);
    if (result.usage.completion_tokens && result.elapsed_ms) {
      const tps = (result.usage.completion_tokens / (result.elapsed_ms / 1000)).toFixed(1);
      console.log(`Tokens/sec:      ${tps}`);
    }
  }
  console.log('================');

  process.exit(result.pass ? 0 : 1);
}

main().catch(err => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
