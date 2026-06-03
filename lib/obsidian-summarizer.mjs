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
import { openStore } from './sqlite-store.mjs';
import { getVaultPath, ensureVaultStructure } from './obsidian-vault.mjs';
import { atomicWriteFile } from './atomic-write.mjs';

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
export async function generateConceptSummary(client, entityName, mentions, opts = {}) {
  if (!client) return null;
  if (opts.signal?.aborted) return null;

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

  // F-N101 fix: prefer generateAnalysis when available so the consolidation
  // cycle's per-concept summaries don't queue behind user extractions in the
  // shared extraction queue (which has no wait-timeout and can hang for 5+
  // minutes under contention). generateAnalysis has its own wait-timeout and
  // returns mode:'fallback' instead of blocking.
  try {
    if (typeof client.generateAnalysis === 'function') {
      // F-P209 fix: cold Ollama loads take 5-15s. 3s wait meant every
      // first concept of every cycle hit the fallback path → no summary
      // ever generated on idle nodes (the consolidation scheduler's whole
      // point is to run when idle). Default 12s, env-overridable.
      const envWait = Number(process.env.CONSOLIDATE_SUMMARY_WAIT_MS);
      const waitTimeoutMs = opts.waitTimeoutMs
        ?? (Number.isFinite(envWait) && envWait > 0 ? envWait : 12000);
      const result = await client.generateAnalysis(messages, {
        maxTokens: 256,
        temperature: 0.3,
        waitTimeoutMs,
      });
      if (result?.mode !== 'llm') return null;  // fallback: no summary this cycle
      const content = result.value?.content?.trim();
      return content && content.length > 10 ? content : null;
    }
    // Legacy path: client only has generate(). Kept for backward compat with
    // tests / older callers that don't construct a full LLM client.
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
 * @param {{ respectPrivacy?: boolean }} [opts] — D7 (repair 2.1): the local
 *   vault is trusted + fully transparent; filtering private entities/decisions
 *   is an explicit opt-IN for federation-era surfaces (`respectPrivacy: true`
 *   restores the F-N102 behavior). Cloud-sync exposure remark parked in
 *   repair Block P (R36).
 * @returns {Array<object>} concept data objects
 */
export function queryConceptData(db, threshold, opts = {}) {
  // D7: transparent by default. Federation-era callers opt IN to filtering.
  const respectPrivacy = opts.respectPrivacy === true;
  const entityPrivacy   = respectPrivacy ? ' AND COALESCE(private, 1) = 0' : '';
  const entityPrivacyE2 = respectPrivacy ? ' AND COALESCE(e2.private, 1) = 0' : '';
  const decisionPrivacy = respectPrivacy ? ' AND COALESCE(d.private, 1) = 0' : '';

  // Get entities above threshold.
  // F-N102: filter private entities so they never become vault notes.
  const entities = db.prepare(`
    SELECT id, name, type, first_seen, last_seen, mention_count
    FROM entities
    WHERE mention_count >= ?${entityPrivacy}
    ORDER BY mention_count DESC, id ASC
  `).all(threshold);

  const results = [];

  for (const entity of entities) {
    // Average salience from mentions
    const salienceRow = db.prepare(`
      SELECT AVG(salience) as avg_salience
      FROM mentions
      WHERE entity_id = ?
    `).get(entity.id);

    // Co-mentioned entities (entities that share sessions).
    // F-M14 fix: SELECT DISTINCT + ORDER BY non-selected column is
    // SQLite-permitted but produces non-deterministic "top 10 distinct"
    // (which row wins the DISTINCT collapse is implementation-defined).
    // GROUP BY + MAX(mention_count) makes the ordering by mention count
    // explicit + deterministic.
    // F-N102: also filter private co-mentioned entities so wikilinks in
    // a public concept's note can't reveal a private entity's existence.
    const coMentioned = db.prepare(`
      SELECT e2.name, MAX(e2.mention_count) AS mc
      FROM mentions m1
      JOIN mentions m2 ON m1.session_id = m2.session_id AND m1.entity_id != m2.entity_id
      JOIN entities e2 ON m2.entity_id = e2.id
      WHERE m1.entity_id = ?${entityPrivacyE2}
      GROUP BY e2.id
      ORDER BY mc DESC, e2.id ASC
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
    // F-N102: filter private decisions — they often quote verbatim from
    // private conversations.
    const decisions = db.prepare(`
      SELECT DISTINCT d.decision, d.rationale, d.session_id
      FROM decisions d
      JOIN mentions m ON d.session_id = m.session_id
      WHERE m.entity_id = ?${decisionPrivacy}
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
 * @param {boolean} [opts.respectPrivacy=false] — D7 (repair 2.1): the local
 *   vault is the trusted, fully-transparent referential surface; nothing is
 *   filtered by default. Pass true (federation-era opt-in) to restore the
 *   F-N102 exclusion of private entities + decisions. Cloud-sync exposure
 *   remark parked in repair Block P (R36).
 * @param {AbortSignal} [opts.signal] — F-N100 fix. If aborted mid-loop, the
 *   function returns the partial results processed so far rather than throwing.
 *   The consolidation hard-cap uses this so a cycle that overruns can stop
 *   cleanly instead of orphaning in-flight LLM calls.
 * @param {number} [opts.maxConcepts] — F-N101 fix. Cap the number of concepts
 *   processed in one call. Default from env CONSOLIDATE_MAX_SUMMARIES_PER_CYCLE
 *   or 25. Above this, the cycle finishes the top-N by mention_count and
 *   reports the deferral so the next cycle can pick up.
 * @returns {Promise<{
 *   generated: number, vaultPath: string, notes: string[],
 *   skipped: number, attempted: number, aborted: boolean
 * }>}
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
    db = openStore(opts.dbPath, { readonly: true });
    ownsDb = true;
  }
  const client = opts.client ?? opts.llmClient ?? null;
  const threshold = getConceptThreshold(opts);
  const vaultPath = opts.vaultPath || getVaultPath();
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  // D7 (repair 2.1): transparent by default; filtering is federation-era opt-in.
  const respectPrivacy = opts.respectPrivacy === true;
  const signal = opts.signal || null;
  // F-N101 fix: cap per-call concept count. Default 25 — enough to make
  // meaningful progress per cycle without blowing the 5-minute hard cap
  // when each summary takes 3-10s.
  const maxConcepts = opts.maxConcepts
    || Number(process.env.CONSOLIDATE_MAX_SUMMARIES_PER_CYCLE)
    || 25;

  try {
    await ensureVaultStructure(vaultPath);

    let allCandidates = queryConceptData(db, threshold, { respectPrivacy });
    // Targeted generation (repair 2.7): opts.names restricts to specific
    // concepts — the coverage-backfill path. Without it, the blind top-N
    // slice rewrites the same most-mentioned notes forever and the tail
    // below the cap never gets generated.
    if (Array.isArray(opts.names) && opts.names.length) {
      const wanted = new Set(opts.names);
      allCandidates = allCandidates.filter((c) => wanted.has(c.entity.name));
    }
    // queryConceptData already sorts by mention_count DESC, so slicing here
    // takes the top-N most-mentioned. Remaining concepts are deferred to
    // future cycles (they'll still be top-N then if no extraction has
    // since boosted others above them).
    const conceptData = allCandidates.slice(0, maxConcepts);
    const skipped = allCandidates.length - conceptData.length;
    const notes = [];
    const total = conceptData.length;
    let done = 0;
    let attempted = 0;
    let aborted = false;

    for (const data of conceptData) {
      // F-N100: cooperative cancellation between concepts. We never abort
      // mid-summary (the LLM call has its own timeout) but we stop enqueueing
      // new work when the cycle's hard cap fires.
      if (signal?.aborted) { aborted = true; break; }

      const { entity, avgSalience, relatedEntities, mentions, decisions, recentSessions } = data;
      attempted++;

      const frontmatter = buildConceptFrontmatter(entity, relatedEntities, avgSalience);
      const summary = await generateConceptSummary(client, entity.name, mentions, { signal });
      const body = buildConceptBody(entity.name, { summary, decisions, recentSessions });
      const noteContent = `${frontmatter}\n\n${body}`;

      const filename = `${slugifyName(entity.name)}.md`;
      const filePath = join(vaultPath, 'concepts', filename);
      // F-Q205/Q409 fix: atomic write via tmp+fsync+rename. The vault is
      // typically iCloud/Dropbox/Syncthing-synced; a torn write on SIGKILL
      // or OOM replicates a truncated .md to every device. The shared
      // atomicWriteFile helper closes that gap.
      await atomicWriteFile(filePath, noteContent);

      notes.push(filename);
      done++;
      if (onProgress) onProgress({ done, total, name: entity.name });
    }

    return {
      generated: notes.length, vaultPath, notes,
      attempted, skipped, aborted,
    };
  } finally {
    if (ownsDb) db.close();
  }
}
