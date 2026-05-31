import { join } from 'node:path';
import { getVaultPath, ensureVaultStructure } from './obsidian-vault.mjs';
import { slugifyName } from './obsidian-summarizer.mjs';
import { atomicWriteFile } from './atomic-write.mjs';

/**
 * Query session metadata + the entities/decisions extracted for it.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 * @returns {{ session: object|null, entities: object[], decisions: object[] }}
 */
export function querySessionNoteData(db, sessionId) {
  const session = db.prepare(
    'SELECT id, source, start_time, end_time, summary, message_count FROM sessions WHERE id = ?'
  ).get(sessionId);

  const entities = db.prepare(`
    SELECT DISTINCT e.name, e.type, m.salience
    FROM mentions m
    JOIN entities e ON m.entity_id = e.id
    WHERE m.session_id = ?
    ORDER BY m.salience DESC, e.name ASC
  `).all(sessionId);

  const decisions = db.prepare(`
    SELECT decision, rationale, confidence
    FROM decisions
    WHERE session_id = ?
    ORDER BY created_at DESC
  `).all(sessionId);

  return { session: session || null, entities, decisions };
}

/**
 * Derive a short topic string from session summary or top entity names.
 *
 * @param {{ summary?: string|null }} session
 * @param {Array<{ name: string }>} entities
 * @returns {string}
 */
export function deriveSessionTopic(session, entities) {
  if (session?.summary) {
    const slug = slugifyName(session.summary);
    if (slug.length > 0) return slug.slice(0, 60);
  }
  if (entities.length > 0) {
    const names = entities.slice(0, 3).map(e => slugifyName(e.name));
    return names.join('-').slice(0, 60);
  }
  return 'session';
}

/**
 * Format a session date string for the filename (YYYY-MM-DD).
 *
 * @param {string|null|undefined} startTime — ISO 8601
 * @returns {string}
 */
export function formatSessionDate(startTime) {
  if (!startTime) return new Date().toISOString().slice(0, 10);
  try {
    return new Date(startTime).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Build YAML frontmatter for a session note.
 *
 * @param {{ id: string, source?: string, start_time?: string, message_count?: number }} session
 * @param {Array<{ name: string }>} entities
 * @returns {string}
 */
export function buildSessionFrontmatter(session, entities) {
  const date = formatSessionDate(session.start_time);
  const lines = [
    '---',
    'type: session',
    `date: ${date}`,
    `session_id: ${session.id}`,
  ];

  if (session.source) lines.push(`source: ${session.source}`);
  if (session.message_count != null) lines.push(`message_count: ${session.message_count}`);

  if (entities.length > 0) {
    const wikilinks = entities.map(e => `[[${slugifyName(e.name)}]]`);
    lines.push(`concepts: [${wikilinks.join(', ')}]`);
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Build the markdown body for a session note.
 *
 * @param {{ summary?: string|null, start_time?: string }} session
 * @param {Array<{ name: string, type?: string }>} entities
 * @param {Array<{ decision: string, rationale?: string }>} decisions
 * @returns {string}
 */
export function buildSessionBody(session, entities, decisions) {
  const date = formatSessionDate(session.start_time);
  const topic = deriveSessionTopic(session, entities);
  const sections = [];

  sections.push(`# Session: ${date}`);

  if (session.summary) {
    sections.push(session.summary);
  }

  if (entities.length > 0) {
    const lines = entities.map(e => `- [[${slugifyName(e.name)}]] (${e.type || 'unknown'})`);
    sections.push(`## Concepts Touched\n${lines.join('\n')}`);
  }

  if (decisions.length > 0) {
    const lines = decisions.map(d => `- ${d.decision}`);
    sections.push(`## Decisions\n${lines.join('\n')}`);
  }

  return sections.join('\n\n') + '\n';
}

/**
 * Generate a session note and write it to the vault.
 *
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {string} opts.sessionId
 * @param {string} [opts.vaultPath]
 * @returns {Promise<{ generated: boolean, filePath: string|null, filename: string|null }>}
 */
export async function generateSessionNote(opts) {
  const { db, sessionId } = opts;
  if (!db || !sessionId) return { generated: false, filePath: null, filename: null };

  const vaultPath = opts.vaultPath || getVaultPath();
  await ensureVaultStructure(vaultPath);

  const { session, entities, decisions } = querySessionNoteData(db, sessionId);

  const sessionForNote = session || { id: sessionId };

  const date = formatSessionDate(sessionForNote.start_time);
  const topic = deriveSessionTopic(sessionForNote, entities);
  const shortId = sessionId.slice(0, 8);
  const filename = `${date}-${topic}-${shortId}.md`;

  const frontmatter = buildSessionFrontmatter(sessionForNote, entities);
  const body = buildSessionBody(sessionForNote, entities, decisions);
  const noteContent = `${frontmatter}\n\n${body}`;

  const filePath = join(vaultPath, 'sessions', filename);
  await atomicWriteFile(filePath, noteContent);

  return { generated: true, filePath, filename };
}
