/**
 * obsidian-summarizer.mjs — Auto-generate concept notes from the extraction store.
 *
 * For each entity exceeding the mention-count threshold, generates an
 * Obsidian-compatible markdown note in the vault's concepts/ directory with:
 *   - Data-driven YAML frontmatter (type, entity_type, created, last_seen,
 *     mention_count, salience, related wikilinks)
 *   - LLM-generated body (2-3 sentence summary) with fallback to data-only
 *
 * Depends on:
 *   - lib/obsidian-vault.mjs (vault path + structure)
 *   - lib/extraction-store.mjs (entity/mention/decision data)
 *   - lib/llm-client.mjs (optional, for LLM summaries)
 */

import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { getVaultPath, ensureVaultStructure } from './obsidian-vault.mjs';

/** Default concept-note threshold — entities need this many mentions to get a note. */
export const DEFAULT_CONCEPT_THRESHOLD = 5;

/**
 * Resolve the concept threshold from options, env var, or default.
 * @param {{ threshold?: number }} [opts]
 * @returns {number}
 */
export function getConceptThreshold(opts = {}) {
  if (opts.threshold != null) return opts.threshold;
  const env = process.env.OBSIDIAN_CONCEPT_THRESHOLD;
  if (env != null && !isNaN(Number(env))) return Number(env);
  return DEFAULT_CONCEPT_THRESHOLD;
}

/**
 * Sanitize an entity name for use as a filesystem-safe filename.
 * Lowercases, replaces whitespace and special characters with hyphens,
 * collapses consecutive hyphens, trims leading/trailing hyphens.
 *
 * @param {string} name
 * @returns {string}
 */
export function slugifyName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build YAML frontmatter for a concept note.
 *
 * @param {object} entity — entity row from extraction store
 * @param {string[]} relatedEntities — names of co-mentioned entities
 * @param {number} [avgSalience] — average salience across mentions
 * @returns {string} YAML frontmatter block (including --- delimiters)
 */
export function buildConceptFrontmatter(entity, relatedEntities = [], avgSalience) {
  const lines = [
    '---',
    'type: concept',
    `entity_type: ${entity.type}`,
    `created: ${entity.first_seen}`,
    `last_seen: ${entity.last_seen}`,
    `mention_count: ${entity.mention_count}`,
  ];

  if (avgSalience != null) {
    lines.push(`salience: ${Number(avgSalience.toFixed(2))}`);
  }

  if (relatedEntities.length > 0) {
    const wikilinks = relatedEntities.map(n => `[[${n}]]`);
    lines.push(`related: [${wikilinks.join(', ')}]`);
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Build the markdown body for a concept note.
 *
 * @param {string} entityName — display name for the heading
 * @param {object} [opts]
 * @param {string|null} [opts.summary] — LLM-generated summary (null = data-only fallback)
 * @param {Array<{decision: string, rationale: string, session_id: string}>} [opts.decisions]
 * @param {Array<{session_id: string, created_at: string}>} [opts.recentSessions]
 * @returns {string}
 */
export function buildConceptBody(entityName, opts = {}) {
  const { summary, decisions = [], recentSessions = [] } = opts;
  const sections = [];

  sections.push(`# ${entityName}`);

  if (summary) {
    sections.push(summary);
  } else {
    sections.push('_Summary not yet generated._');
  }

  if (decisions.length > 0) {
    const decLines = decisions.map(d => `- ${d.decision}`);
    sections.push(`## Decisions\n${decLines.join('\n')}`);
  }

  if (recentSessions.length > 0) {
    const sessLines = recentSessions.map(s => `- [[sessions/${s.session_id}]]`);
    sections.push(`## Recent activity\n${sessLines.join('\n')}`);
  }

  return sections.join('\n\n') + '\n';
}

/**
 * Generate an LLM summary for a concept entity.
 * Returns null on any failure (LLM unavailable, timeout, etc.).
 *
 * @param {object} client — LLM client with generate() method
 * @param {string} entityName
 * @param {Array<{session_id: string, salience: number}>} mentions
 * @returns {Promise<string|null>}
 */
export async function generateConceptSummary(client, entityName, mentions) {
  if (!client) return null;

  const mentionContext = mentions
    .slice(0, 10)
    .map(m => `- Session ${m.session_id} (salience: ${m.salience})`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content: '/no_think\nYou are a concise technical writer. Write a 2-3 sentence summary of the given concept based on its mention context. Output ONLY the summary text, no headers or formatting.',
    },
    {
      role: 'user',
      content: `Concept: ${entityName}\n\nMention context:\n${mentionContext}\n\nWrite a 2-3 sentence summary of what "${entityName}" is and why it matters in this project.`,
    },
  ];

  try {
    const result = await client.generate(messages, { maxTokens: 256, temperature: 0.3 });
    const content = result.content?.trim();
    if (content && content.length > 10) return content;
    return null;
  } catch {
    return null;
  }
}

/**
 * Query the extraction store for concept-note data.
 * Returns entities above threshold with their co-mentioned entities,
 * average salience, decisions, and recent sessions.
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {number} threshold — minimum mention_count
 * @returns {Array<object>} concept data objects
 */
export function queryConceptData(db, threshold) {
  // Get entities above threshold
  const entities = db.prepare(`
    SELECT id, name, type, first_seen, last_seen, mention_count
    FROM entities
    WHERE mention_count >= ?
    ORDER BY mention_count DESC
  `).all(threshold);

  const results = [];

  for (const entity of entities) {
    // Average salience from mentions
    const salienceRow = db.prepare(`
      SELECT AVG(salience) as avg_salience
      FROM mentions
      WHERE entity_id = ?
    `).get(entity.id);

    // Co-mentioned entities (entities that share sessions)
    const coMentioned = db.prepare(`
      SELECT DISTINCT e2.name
      FROM mentions m1
      JOIN mentions m2 ON m1.session_id = m2.session_id AND m1.entity_id != m2.entity_id
      JOIN entities e2 ON m2.entity_id = e2.id
      WHERE m1.entity_id = ?
      ORDER BY e2.mention_count DESC
      LIMIT 10
    `).all(entity.id);

    // Mentions for LLM context
    const mentions = db.prepare(`
      SELECT session_id, salience, created_at
      FROM mentions
      WHERE entity_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(entity.id);

    // Decisions from sessions this entity appears in
    const decisions = db.prepare(`
      SELECT DISTINCT d.decision, d.rationale, d.session_id
      FROM decisions d
      JOIN mentions m ON d.session_id = m.session_id
      WHERE m.entity_id = ?
      ORDER BY d.created_at DESC
      LIMIT 5
    `).all(entity.id);

    // Recent sessions
    const recentSessions = db.prepare(`
      SELECT DISTINCT session_id, created_at
      FROM mentions
      WHERE entity_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(entity.id);

    results.push({
      entity,
      avgSalience: salienceRow?.avg_salience ?? null,
      relatedEntities: coMentioned.map(r => r.name),
      mentions,
      decisions,
      recentSessions,
    });
  }

  return results;
}

/**
 * Generate concept notes and write them to the Obsidian vault.
 *
 * @param {object} opts
 * @param {object} [opts.db] — better-sqlite3 database instance (extraction store)
 * @param {string} [opts.dbPath] — path to SQLite DB; opened read-only if `db` not provided
 * @param {object} [opts.client] — LLM client (null = data-only body)
 * @param {object} [opts.llmClient] — alias for `client` (compatibility with backfill callers)
 * @param {string} [opts.vaultPath] — vault path override
 * @param {number} [opts.threshold] — mention count threshold
 * @param {(progress: {done: number, total: number, name: string}) => void} [opts.onProgress]
 * @returns {Promise<{ generated: number, vaultPath: string, notes: string[] }>}
 */
export async function generateConceptNotes(opts) {
  // Accept either { db } or { dbPath }, and either { client } or { llmClient }.
  // This tolerates the older backfill call shape and the test/internal shape.
  let db = opts.db;
  let ownsDb = false;
  if (!db) {
    if (!opts.dbPath) {
      throw new Error('generateConceptNotes: requires either opts.db (handle) or opts.dbPath (string)');
    }
    db = new Database(opts.dbPath, { readonly: true });
    ownsDb = true;
  }
  const client = opts.client ?? opts.llmClient ?? null;
  const threshold = getConceptThreshold(opts);
  const vaultPath = opts.vaultPath || getVaultPath();
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  try {
    await ensureVaultStructure(vaultPath);

    const conceptData = queryConceptData(db, threshold);
    const notes = [];
    const total = conceptData.length;
    let done = 0;

    for (const data of conceptData) {
      const { entity, avgSalience, relatedEntities, mentions, decisions, recentSessions } = data;

      // Build frontmatter
      const frontmatter = buildConceptFrontmatter(entity, relatedEntities, avgSalience);

      // Generate LLM summary (or null)
      const summary = await generateConceptSummary(client, entity.name, mentions);

      // Build body
      const body = buildConceptBody(entity.name, { summary, decisions, recentSessions });

      // Compose full note
      const noteContent = `${frontmatter}\n\n${body}`;

      // Write to concepts/ subdirectory
      const filename = `${slugifyName(entity.name)}.md`;
      const filePath = join(vaultPath, 'concepts', filename);
      await writeFile(filePath, noteContent, 'utf-8');

      notes.push(filename);
      done++;
      if (onProgress) onProgress({ done, total, name: entity.name });
    }

    return { generated: notes.length, vaultPath, notes };
  } finally {
    if (ownsDb) db.close();
  }
}
