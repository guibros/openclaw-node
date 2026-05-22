/**
 * extraction-prompt.mjs — Prompt template and runner for LLM-driven extraction.
 *
 * Builds the system+user message pair that instructs Qwen3.5-27B to extract
 * structured data (entities, themes, actions, decisions, friction signals,
 * relationships) from a session tail. Validates the LLM response against
 * ExtractionResultSchema.
 *
 * Used by the daemon (Step 3.3 wiring) as a drop-in replacement for the
 * regex-based extractFacts in pre-compression-flush.mjs.
 */

import { validateExtractionResult } from './extraction-schema.mjs';

// ── Prompt Construction ────────────────────────────────

const SYSTEM_PROMPT = `You are a structured-data extractor for a software development assistant's memory system. Your job is to analyze a conversation transcript and extract key information into a JSON object.

Extract the following from the conversation:

1. **entities** — Named things mentioned: people, projects, technologies, files, concepts, companies. Each has a name, type, and salience score (0.0–1.0, where 1.0 = central to the conversation).

2. **themes** — Topics discussed, with a hierarchical path. Example: { "label": "JetStream configuration", "hierarchy": ["infrastructure", "messaging", "nats"] }

3. **actions** — What activities were performed. Choose from: debugging, designing, planning, implementing, reviewing, researching.

4. **decisions** — Explicit decisions made during the conversation. Each has the decision text, the rationale, and a confidence score (0.0–1.0).

5. **friction_signals** — Points of difficulty, confusion, or frustration. Each has a description and severity (low, medium, high).

6. **relationships** — Connections between entities. Types: depends_on, contradicts, instance_of, causes, follows.

Output a single JSON object matching this exact schema:
{
  "entities": [{ "name": "...", "type": "person|project|technology|file|concept|company", "salience": 0.0-1.0 }],
  "themes": [{ "label": "...", "hierarchy": ["top", "mid", "specific"] }],
  "actions": ["debugging"|"designing"|"planning"|"implementing"|"reviewing"|"researching"],
  "decisions": [{ "decision": "...", "rationale": "...", "confidence": 0.0-1.0 }],
  "friction_signals": [{ "signal": "...", "severity": "low|medium|high" }],
  "relationships": [{ "source": "...", "target": "...", "type": "depends_on|contradicts|instance_of|causes|follows" }]
}

Rules:
- Output ONLY the JSON object. No markdown fences, no commentary.
- If a category has no items, use an empty array.
- Entity names should be canonical (e.g., "NATS JetStream" not "jetstream" or "JS").
- Salience reflects how central the entity is to THIS conversation, not general importance.
- Only extract decisions that were explicitly made, not hypothetical ones.
- Friction signals capture real difficulties, not routine questions.
- Keep entity names concise but unambiguous.`;

/**
 * Format session messages into a readable transcript for the LLM.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string}
 */
function formatTranscript(messages) {
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n\n');
}

/**
 * Build the system + user message pair for extraction.
 *
 * @param {Array<{role: string, content: string}>} messages — session tail messages
 * @returns {Array<{role: string, content: string}>} — [systemMessage, userMessage]
 */
export function buildExtractionPrompt(messages) {
  const transcript = formatTranscript(messages);

  // `/no_think` is a Qwen3 directive that disables the model's internal reasoning
  // channel. Critical for extraction: we want structured JSON, not reasoning
  // narration. With thinking enabled, Qwen3-8B burns 500-2000 tokens reasoning
  // before producing JSON — pushes per-session extraction past 10 min on
  // consumer hardware. Non-Qwen models simply ignore this token.
  return [
    { role: 'system', content: SYSTEM_PROMPT + '\n\n/no_think' },
    {
      role: 'user',
      content: `Extract structured information from the following conversation:\n\n${transcript}`,
    },
  ];
}

// ── Extraction Runner ──────────────────────────────────

/**
 * Run structured extraction on session messages via the LLM client.
 *
 * Calls client.generate() with JSON mode, parses the response, and validates
 * against ExtractionResultSchema.
 *
 * @param {object} client — LLM client from createLlmClient()
 * @param {Array<{role: string, content: string}>} messages — session tail
 * @returns {Promise<import('./extraction-schema.mjs').ExtractionResultSchema>}
 * @throws {Error} on JSON parse failure or schema validation failure
 */
export async function extractStructured(client, messages) {
  const prompt = buildExtractionPrompt(messages);

  const result = await client.generate(prompt, { jsonMode: true });

  let parsed;
  try {
    parsed = JSON.parse(result.content);
  } catch (err) {
    throw new Error(`LLM response is not valid JSON: ${err.message}. Raw: ${result.content.slice(0, 200)}`);
  }

  return validateExtractionResult(parsed);
}
