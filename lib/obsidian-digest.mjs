import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { getVaultPath, ensureVaultStructure } from './obsidian-vault.mjs';
import { atomicWriteFile } from './atomic-write.mjs';

/**
 * Parse frontmatter from a markdown note. Returns null on failure.
 * @param {string} content
 * @returns {object|null}
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return yaml.load(match[1]) || null;
  } catch {
    return null;
  }
}

/**
 * Extract the body (everything after frontmatter) from a markdown note.
 * @param {string} content
 * @returns {string}
 */
export function parseBody(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : content;
}

/**
 * Read all .md files from a vault subdirectory and parse their frontmatter.
 * @param {string} dirPath
 * @returns {Promise<Array<{filename: string, frontmatter: object|null, body: string}>>}
 */
export async function readVaultDir(dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath);
  } catch {
    return [];
  }
  const results = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    try {
      const content = await readFile(join(dirPath, name), 'utf-8');
      results.push({
        filename: name,
        frontmatter: parseFrontmatter(content),
        body: parseBody(content),
      });
    } catch {
      // unreadable file — skip
    }
  }
  return results;
}

/**
 * Normalize a date value to YYYY-MM-DD string.
 * Handles Date objects (from js-yaml), ISO strings, and plain date strings.
 * @param {string|Date|null|undefined} value
 * @returns {string|null}
 */
export function toDateStr(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Check whether a date value falls on a given date (YYYY-MM-DD).
 * Handles Date objects, ISO strings, and plain date strings.
 * @param {string|Date|null|undefined} value
 * @param {string} dateStr — YYYY-MM-DD
 * @returns {boolean}
 */
export function isOnDate(value, dateStr) {
  const d = toDateStr(value);
  return d === dateStr;
}

/**
 * Check whether a date value falls within a date range [startDate, endDate] inclusive.
 * @param {string|Date|null|undefined} value
 * @param {string} startDate — YYYY-MM-DD
 * @param {string} endDate — YYYY-MM-DD
 * @returns {boolean}
 */
export function isInDateRange(value, startDate, endDate) {
  const d = toDateStr(value);
  if (!d) return false;
  return d >= startDate && d <= endDate;
}

/**
 * Extract wikilink targets from a concepts array (as stored in session frontmatter).
 * Handles both `[[name]]` strings and plain strings.
 * @param {Array} concepts
 * @returns {string[]}
 */
export function extractConceptNames(concepts) {
  if (!Array.isArray(concepts)) return [];
  return concepts.map(c => {
    if (typeof c !== 'string') return String(c);
    const m = c.match(/\[\[([^\]]+)\]\]/);
    return m ? m[1] : c;
  });
}

/**
 * Extract decisions from a session note body.
 * Looks for lines under "## Decisions" heading.
 * @param {string} body
 * @returns {string[]}
 */
export function extractDecisionsFromBody(body) {
  const lines = body.split('\n');
  let inDecisions = false;
  const decisions = [];
  for (const line of lines) {
    if (line.match(/^##\s+Decisions/i)) {
      inDecisions = true;
      continue;
    }
    if (inDecisions && line.match(/^##\s/)) break;
    if (inDecisions && (line.startsWith('- ') || line.startsWith('* '))) {
      decisions.push(line.replace(/^[-*]\s*/, '').trim());
    }
  }
  return decisions;
}

/**
 * Build the frontmatter block for a digest note.
 * @param {object} opts
 * @param {string} opts.type — 'daily-digest' or 'weekly-digest'
 * @param {string} opts.date — YYYY-MM-DD
 * @param {number} opts.sessionCount
 * @param {number} opts.conceptCount
 * @param {string} [opts.startDate] — for weekly digests
 * @returns {string}
 */
export function buildDigestFrontmatter(opts) {
  const lines = [
    '---',
    `type: ${opts.type}`,
    `date: ${opts.date}`,
  ];
  if (opts.startDate) lines.push(`start_date: ${opts.startDate}`);
  lines.push(`sessions: ${opts.sessionCount}`);
  lines.push(`concepts_active: ${opts.conceptCount}`);
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * Build the markdown body for a daily/weekly digest.
 * @param {object} opts
 * @param {string} opts.title
 * @param {Array} opts.sessions — parsed session notes
 * @param {Array} opts.concepts — parsed concept notes
 * @param {string[]} opts.allDecisions — aggregated decisions
 * @returns {string}
 */
export function buildDigestBody(opts) {
  const { title, sessions, concepts, allDecisions } = opts;
  const sections = [];

  sections.push(`# ${title}`);

  // Sessions section
  if (sessions.length > 0) {
    const lines = sessions.map(s => {
      const fm = s.frontmatter || {};
      const conceptNames = extractConceptNames(fm.concepts);
      const conceptLinks = conceptNames.length > 0
        ? ` — concepts: ${conceptNames.map(c => `[[${c}]]`).join(', ')}`
        : '';
      const msgInfo = fm.message_count ? ` (${fm.message_count} messages)` : '';
      const sessionLink = `[[sessions/${s.filename.replace(/\.md$/, '')}]]`;
      return `- ${sessionLink}${msgInfo}${conceptLinks}`;
    });
    sections.push(`## Sessions\n\n${lines.join('\n')}`);
  } else {
    sections.push('## Sessions\n\nNo sessions recorded.');
  }

  // Active concepts section
  if (concepts.length > 0) {
    const sorted = [...concepts].sort((a, b) => {
      const sa = a.frontmatter?.salience ?? 0;
      const sb = b.frontmatter?.salience ?? 0;
      return sb - sa;
    });
    const lines = sorted.map(c => {
      const fm = c.frontmatter || {};
      const name = c.filename.replace(/\.md$/, '');
      const type = fm.entity_type || 'unknown';
      const salience = fm.salience != null ? `, salience: ${fm.salience}` : '';
      const mentions = fm.mention_count != null ? `, mentions: ${fm.mention_count}` : '';
      return `- [[${name}]] (${type}${salience}${mentions})`;
    });
    sections.push(`## Active Concepts\n\n${lines.join('\n')}`);
  }

  // Decisions section
  if (allDecisions.length > 0) {
    const lines = allDecisions.map(d => `- ${d}`);
    sections.push(`## Decisions\n\n${lines.join('\n')}`);
  }

  return sections.join('\n\n') + '\n';
}

/**
 * Generate a daily digest from vault notes for a given date.
 *
 * @param {object} [opts]
 * @param {string} [opts.vaultPath]
 * @param {string} [opts.date] — YYYY-MM-DD (defaults to today)
 * @returns {Promise<{generated: boolean, filePath: string|null, sessions: number, concepts: number}>}
 */
export async function generateDailyDigest(opts = {}) {
  const vaultPath = getVaultPath(opts);
  await ensureVaultStructure(vaultPath);

  const date = opts.date || new Date().toISOString().slice(0, 10);

  const sessionNotes = await readVaultDir(join(vaultPath, 'sessions'));
  const conceptNotes = await readVaultDir(join(vaultPath, 'concepts'));

  const daySessions = sessionNotes.filter(s =>
    isOnDate(s.frontmatter?.date, date)
  );

  const dayConcepts = conceptNotes.filter(c =>
    isOnDate(c.frontmatter?.last_seen, date)
  );

  const allDecisions = [];
  for (const s of daySessions) {
    const decs = extractDecisionsFromBody(s.body);
    allDecisions.push(...decs);
  }

  const frontmatter = buildDigestFrontmatter({
    type: 'daily-digest',
    date,
    sessionCount: daySessions.length,
    conceptCount: dayConcepts.length,
  });

  const body = buildDigestBody({
    title: `Daily Digest — ${date}`,
    sessions: daySessions,
    concepts: dayConcepts,
    allDecisions,
  });

  const content = `${frontmatter}\n\n${body}`;
  const filename = `${date}.md`;
  const filePath = join(vaultPath, 'daily', filename);
  await atomicWriteFile(filePath, content);

  return {
    generated: true,
    filePath,
    sessions: daySessions.length,
    concepts: dayConcepts.length,
  };
}

/**
 * Generate a weekly digest covering [endDate - 6 days, endDate].
 *
 * @param {object} [opts]
 * @param {string} [opts.vaultPath]
 * @param {string} [opts.endDate] — YYYY-MM-DD (defaults to today)
 * @returns {Promise<{generated: boolean, filePath: string|null, sessions: number, concepts: number}>}
 */
export async function generateWeeklyDigest(opts = {}) {
  const vaultPath = getVaultPath(opts);
  await ensureVaultStructure(vaultPath);

  const endDate = opts.endDate || new Date().toISOString().slice(0, 10);
  const startMs = new Date(endDate + 'T00:00:00Z').getTime() - 6 * 86400000;
  const startDate = new Date(startMs).toISOString().slice(0, 10);

  const sessionNotes = await readVaultDir(join(vaultPath, 'sessions'));
  const conceptNotes = await readVaultDir(join(vaultPath, 'concepts'));

  const weekSessions = sessionNotes.filter(s =>
    isInDateRange(s.frontmatter?.date, startDate, endDate)
  );

  const weekConcepts = conceptNotes.filter(c =>
    isInDateRange(c.frontmatter?.last_seen, startDate, endDate)
  );

  const allDecisions = [];
  for (const s of weekSessions) {
    const decs = extractDecisionsFromBody(s.body);
    allDecisions.push(...decs);
  }

  const frontmatter = buildDigestFrontmatter({
    type: 'weekly-digest',
    date: endDate,
    startDate,
    sessionCount: weekSessions.length,
    conceptCount: weekConcepts.length,
  });

  const body = buildDigestBody({
    title: `Weekly Digest — ${startDate} to ${endDate}`,
    sessions: weekSessions,
    concepts: weekConcepts,
    allDecisions,
  });

  const content = `${frontmatter}\n\n${body}`;
  const filename = `${endDate}-weekly.md`;
  const filePath = join(vaultPath, 'daily', filename);
  await atomicWriteFile(filePath, content);

  return {
    generated: true,
    filePath,
    sessions: weekSessions.length,
    concepts: weekConcepts.length,
  };
}
