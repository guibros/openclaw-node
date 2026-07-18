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

import {
  validateExtractionResult,
  ENTITY_TYPES,
  ACTION_TYPES,
  SEVERITY_LEVELS,
  RELATIONSHIP_TYPES,
} from './extraction-schema.mjs';
import { useJsonFormat, DEFAULT_MODEL } from './llm-client.mjs';

// ── Tolerant Enum Coercion ─────────────────────────────
//
// Local models (Qwen3-8B and similar) frequently emit free-form enum values
// even with JSON-mode + schema-explicit prompts: "Security" instead of
// "concept", "research" instead of "researching", etc. Rejecting the entire
// extraction over one bad enum wastes the whole 1-15 min LLM call. This
// normalizer maps common variants to known values and drops un-mappable items.

const ENTITY_TYPE_ALIASES = {
  // Direct synonyms / common variants
  'people': 'person',
  'individual': 'person',
  'user': 'person',
  'org': 'company',
  'organization': 'company',
  'corp': 'company',
  'business': 'company',
  'team': 'company',
  'product': 'project',
  'app': 'project',
  'application': 'project',
  'service': 'project',
  'tech': 'technology',
  'tool': 'technology',
  'library': 'technology',
  'framework': 'technology',
  'language': 'technology',
  'protocol': 'technology',
  'platform': 'technology',
  'security': 'technology',
  'cryptography': 'technology',
  'crypto': 'technology',
  'imaging': 'technology',
  'imaging/3d': 'technology',
  'ar/vr': 'technology',
  'ai/ml': 'technology',
  'document': 'file',
  'doc': 'file',
  'path': 'file',
  'directory': 'file',
  'folder': 'file',
  'topic': 'concept',
  'subject': 'concept',
  'idea': 'concept',
  'theory': 'concept',
  'pattern': 'concept',
  'method': 'concept',
  'technique': 'concept',
  // F-L9 fix: extend alias coverage. Common types Qwen3-8B emits that
  // previously got dropped silently.
  'event': 'concept',
  'meeting': 'concept',
  'date': 'concept',
  'location': 'concept',
  'place': 'concept',
  'document_name': 'file',
  'identifier': 'concept',
  'standard': 'technology',
  'algorithm': 'concept',
  'process': 'concept',
};

const ACTION_ALIASES = {
  'debug': 'debugging',
  'fix': 'debugging',
  'troubleshoot': 'debugging',
  'design': 'designing',
  'architect': 'designing',
  'plan': 'planning',
  'planning_session': 'planning',
  'implement': 'implementing',
  'code': 'implementing',
  'coding': 'implementing',
  'build': 'implementing',
  'develop': 'implementing',
  'review': 'reviewing',
  'audit': 'reviewing',
  'inspect': 'reviewing',
  'research': 'researching',
  'investigate': 'researching',
  'explore': 'researching',
  'study': 'researching',
};

const SEVERITY_ALIASES = {
  'mild': 'low',
  'minor': 'low',
  'trivial': 'low',
  'moderate': 'medium',
  'normal': 'medium',
  'severe': 'high',
  'major': 'high',
  'critical': 'high',
  'blocker': 'high',
};

const RELATIONSHIP_ALIASES = {
  'depends': 'depends_on',
  'dependency': 'depends_on',
  'requires': 'depends_on',
  'uses': 'depends_on',
  'opposes': 'contradicts',
  'conflicts': 'contradicts',
  'conflicts_with': 'contradicts',
  'is_a': 'instance_of',
  'instanceOf': 'instance_of',
  'subtype_of': 'instance_of',
  'caused_by': 'causes',
  'leads_to': 'causes',
  'triggers': 'causes',
  'precedes': 'follows',
  'after': 'follows',
};

function normalizeEnum(value, validValues, aliases) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase().trim();
  if (validValues.includes(lower)) return lower;
  if (aliases[lower]) return aliases[lower];
  // Last resort: snake-case the value (e.g. "Depends On" → "depends_on")
  const snake = lower.replace(/\s+/g, '_').replace(/[^a-z_]/g, '');
  if (validValues.includes(snake)) return snake;
  if (aliases[snake]) return aliases[snake];
  return null;
}

/**
 * Coerce raw LLM output into the strict schema shape, dropping items whose
 * enum values can't be normalized. Returns a cleaned object that should
 * validate cleanly against ExtractionResultSchema.
 */
export function coerceExtractionResult(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  // Helper: normalize a single item's enum field, drop if un-mappable
  const filterMap = (arr, normFn) => {
    if (!Array.isArray(arr)) return [];
    return arr.map(normFn).filter(x => x !== null);
  };

  return {
    entities: filterMap(raw.entities, e => {
      if (!e || typeof e !== 'object') return null;
      const type = normalizeEnum(e.type, ENTITY_TYPES, ENTITY_TYPE_ALIASES);
      if (!type) return null;
      const salience = typeof e.salience === 'number' ? Math.max(0, Math.min(1, e.salience)) : 0.5;
      const name = typeof e.name === 'string' ? e.name.trim() : '';
      if (!name) return null;
      return { name, type, salience };
    }),
    themes: filterMap(raw.themes, t => {
      if (!t || typeof t !== 'object') return null;
      const label = typeof t.label === 'string' ? t.label.trim() : '';
      if (!label) return null;
      const hierarchy = Array.isArray(t.hierarchy)
        ? t.hierarchy.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean)
        : [];
      return { label, hierarchy };
    }),
    actions: filterMap(raw.actions, a => normalizeEnum(a, ACTION_TYPES, ACTION_ALIASES)),
    decisions: filterMap(raw.decisions, d => {
      if (!d || typeof d !== 'object') return null;
      const decision = typeof d.decision === 'string' ? d.decision.trim() : '';
      const rationale = typeof d.rationale === 'string' ? d.rationale.trim() : '';
      if (!decision || !rationale) return null;
      const confidence = typeof d.confidence === 'number' ? Math.max(0, Math.min(1, d.confidence)) : 0.5;
      return { decision, rationale, confidence };
    }),
    friction_signals: filterMap(raw.friction_signals, f => {
      if (!f || typeof f !== 'object') return null;
      const signal = typeof f.signal === 'string' ? f.signal.trim() : '';
      if (!signal) return null;
      const severity = normalizeEnum(f.severity, SEVERITY_LEVELS, SEVERITY_ALIASES) || 'medium';
      return { signal, severity };
    }),
    relationships: filterMap(raw.relationships, r => {
      if (!r || typeof r !== 'object') return null;
      const source = typeof r.source === 'string' ? r.source.trim() : '';
      const target = typeof r.target === 'string' ? r.target.trim() : '';
      const type = normalizeEnum(r.type, RELATIONSHIP_TYPES, RELATIONSHIP_ALIASES);
      if (!source || !target || !type) return null;
      return { source, target, type };
    }),
  };
}

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
export function buildExtractionPrompt(messages, opts = {}) {
  const transcript = formatTranscript(messages);

  // `/no_think` is a Qwen3 directive that disables the model's internal reasoning
  // channel. Critical for extraction: we want structured JSON, not reasoning
  // narration. With thinking enabled, Qwen3-8B burns 500-2000 tokens reasoning
  // before producing JSON — pushes per-session extraction past 10 min on
  // consumer hardware. Non-Qwen models simply ignore this token.
  const prompt = [
    { role: 'system', content: SYSTEM_PROMPT + '\n\n/no_think' },
    {
      role: 'user',
      content: `Extract structured information from the following conversation:\n\n${transcript}`,
    },
  ];
  // JSON primer: a trailing assistant turn that Ollama continues. On the
  // free-form path this pins the completion to JSON — without it, small
  // models fed a transcript ABOUT extraction/JSON slide into continuing the
  // `[role]: …` pattern instead of following the instruction (observed
  // 2026-07-18: extraction returned literal transcript lines,
  // audits/extraction_stall). NEVER combine with format:json — the grammar
  // expects a fresh `{` and the primer already consumed it.
  if (opts.jsonPrimer) prompt.push({ role: 'assistant', content: '{' });
  return prompt;
}

// ── Free-form Parser ───────────────────────────────────
//
// When format:json is disabled (LLM_FORCE_FREE_FORM=1), the model output may
// wrap the JSON in markdown fences, preamble text, or trailing commentary.
// This helper finds the outermost `{...}` block via brace-matching and returns
// just that substring. Falls back to the original text if no balanced block
// is found.

export function extractJsonFromText(text) {
  if (typeof text !== 'string' || !text.length) return text;
  // Fast path: already pure JSON. R42 fix (repair 3.4): VALIDATE before
  // returning — `{...}{...}` (concatenated objects, a known small-model
  // failure mode) starts with { and ends with } but isn't parseable; the
  // largest-balanced-block scanner below recovers it.
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return trimmed; } catch { /* fall through to scanner */ }
  }

  // Strip common markdown fences first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    const inner = fenced[1].trim();
    if (inner.startsWith('{') && inner.endsWith('}')) return inner;
  }

  // F-L7 fix: prefer the LARGEST balanced `{...}` block instead of the
  // first. Local models often emit preamble JSON-like text (e.g.
  // `{thinking}` or instruction-tuning artifacts) before the real
  // extraction. First-match captures the noise; largest-match captures
  // the actual schema-shaped payload.
  let bestStart = -1, bestEnd = -1, bestLen = 0;
  let i = 0;
  while (i < text.length) {
    const openIdx = text.indexOf('{', i);
    if (openIdx === -1) break;
    let depth = 0;
    let inString = false;
    let escape = false;
    let closeIdx = -1;
    for (let j = openIdx; j < text.length; j++) {
      const c = text[j];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { closeIdx = j; break; }
      }
    }
    if (closeIdx === -1) break; // unbalanced from here on
    const len = closeIdx - openIdx + 1;
    if (len > bestLen) {
      bestStart = openIdx;
      bestEnd = closeIdx;
      bestLen = len;
    }
    i = closeIdx + 1;
  }
  if (bestStart >= 0) return text.slice(bestStart, bestEnd + 1);
  return text; // unbalanced — let JSON.parse give the real error
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
export function parseWithPrimer(content, primed) {
  try {
    return JSON.parse(extractJsonFromText(content));
  } catch (err) {
    if (!primed) throw err;
    return JSON.parse(extractJsonFromText('{' + content));
  }
}

export async function extractStructured(client, messages) {
  const primer = !useJsonFormat(client.model || DEFAULT_MODEL);
  const prompt = buildExtractionPrompt(messages, { jsonPrimer: primer });

  const result = await client.generate(prompt, { jsonMode: true });

  let parsed;
  try {
    // Primed completions continue AFTER the seeded '{' — restore it before
    // parsing. Some backends echo the primer back, so try verbatim first.
    parsed = parseWithPrimer(result.content, primer);
  } catch (err) {
    throw new Error(`LLM response is not valid JSON: ${err.message}. Raw: ${result.content.slice(0, 200)}`);
  }

  // Coerce model output to schema shape (drop un-mappable enum values, etc.)
  // before strict validation. Saves the whole extraction when the model
  // emits "Security" instead of "concept" — a single bad enum used to fail
  // the entire 1-15 min LLM call.
  const coerced = coerceExtractionResult(parsed);
  return validateExtractionResult(coerced);
}
