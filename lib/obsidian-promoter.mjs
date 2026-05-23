/**
 * obsidian-promoter.mjs — Promote selected concepts to the shared vault.
 *
 * Queries the extraction store for entities meeting the promotion policy's
 * concept_mention_count threshold, generates concept notes with provenance
 * frontmatter, and writes them to projects/arcane-vault/concepts-shared/.
 *
 * Depends on:
 *   - lib/obsidian-summarizer.mjs (queryConceptData, slugifyName, buildConceptBody)
 *   - lib/promotion-policy.mjs (loadPromotionPolicy)
 *   - lib/obsidian-vault.mjs (getVaultPath)
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { queryConceptData, slugifyName, buildConceptBody, generateConceptSummary } from './obsidian-summarizer.mjs';
import { loadPromotionPolicy } from './promotion-policy.mjs';
import { getVaultPath } from './obsidian-vault.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Shared concepts directory — inside the repo for cross-node visibility. */
export const SHARED_CONCEPTS_DIR = join(__dirname, '..', 'projects', 'arcane-vault', 'concepts-shared');

/**
 * Resolve the node ID from env or hostname.
 * Consistent with the rest of the codebase.
 *
 * @returns {string}
 */
export function getNodeId() {
  return process.env.OPENCLAW_NODE_ID || hostname();
}

/**
 * Build YAML frontmatter for a promoted concept note.
 * Includes standard concept fields plus provenance fields per Block 5 §0.
 *
 * @param {object} entity — entity row from extraction store
 * @param {string} nodeId — source node identifier
 * @param {string[]} relatedEntities — names of co-mentioned entities
 * @param {number} [avgSalience] — average salience across mentions
 * @returns {string} YAML frontmatter block (including --- delimiters)
 */
export function buildPromotedFrontmatter(entity, nodeId, relatedEntities = [], avgSalience) {
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

  // Provenance fields per Block 5 §0
  lines.push(`source_node: ${nodeId}`);
  const localVaultPath = getVaultPath();
  const slug = slugifyName(entity.name);
  lines.push(`original_path: ${localVaultPath}/concepts/${slug}.md`);
  lines.push(`promoted_at: ${new Date().toISOString()}`);

  lines.push('---');
  return lines.join('\n');
}

/**
 * Query the extraction store for concepts meeting the promotion threshold.
 * Reuses queryConceptData from obsidian-summarizer with the policy threshold.
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {number} threshold — minimum mention_count for promotion
 * @returns {Array<object>} concept data objects (same shape as queryConceptData)
 */
export function queryPromotableConcepts(db, threshold) {
  return queryConceptData(db, threshold);
}

/**
 * Promote qualifying concepts to the shared vault directory.
 *
 * @param {object} opts
 * @param {object} opts.db — better-sqlite3 database instance (extraction store)
 * @param {object} [opts.client] — LLM client (null = data-only body)
 * @param {string} [opts.sharedDir] — shared concepts directory override
 * @param {object} [opts.policy] — pre-loaded policy (skips file read if provided)
 * @param {string} [opts.nodeId] — node ID override
 * @returns {Promise<{ promoted: number, sharedDir: string, notes: string[] }>}
 */
export async function promoteConceptNotes(opts) {
  const { db, client = null } = opts;
  const sharedDir = opts.sharedDir || SHARED_CONCEPTS_DIR;
  const nodeId = opts.nodeId || getNodeId();

  // Load policy to get the promotion threshold
  let policy;
  if (opts.policy) {
    policy = opts.policy;
  } else {
    policy = await loadPromotionPolicy();
  }

  const threshold = policy.threshold?.concept_mention_count ?? 10;

  // Ensure shared directory exists
  await mkdir(sharedDir, { recursive: true });

  // Query concepts meeting the promotion threshold
  const conceptData = queryPromotableConcepts(db, threshold);
  const notes = [];

  for (const data of conceptData) {
    const { entity, avgSalience, relatedEntities, mentions, decisions, recentSessions } = data;

    // Build promoted frontmatter with provenance
    const frontmatter = buildPromotedFrontmatter(entity, nodeId, relatedEntities, avgSalience);

    // Generate LLM summary (or null)
    const summary = await generateConceptSummary(client, entity.name, mentions);

    // Build body (same format as local concept notes)
    const body = buildConceptBody(entity.name, { summary, decisions, recentSessions });

    // Compose full note
    const noteContent = `${frontmatter}\n\n${body}`;

    // Write to shared concepts directory
    const filename = `${slugifyName(entity.name)}.md`;
    const filePath = join(sharedDir, filename);
    await writeFile(filePath, noteContent, 'utf-8');

    notes.push(filename);
  }

  return { promoted: notes.length, sharedDir, notes };
}
