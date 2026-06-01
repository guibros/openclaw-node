/**
 * session-store.mjs — SQLite Session Archive with FTS5
 *
 * Standalone episodic recall database for OpenClaw.
 * Replaces grepping daily markdown files with ranked, structured search.
 *
 * Architecture:
 *   - SQLite with WAL mode (concurrent read/write)
 *   - FTS5 on messages.content for full-text search
 *   - Session-grouped results ranked by (match_count × recency_weight)
 *   - Context windows around matches with merged overlapping ranges
 *
 * Database location: ~/.openclaw/state.db
 * External dependency: better-sqlite3
 *
 * Tables:
 *   - sessions: id, source, start_time, end_time, summary, message_count
 *   - messages: session_id, role, content, timestamp, turn_index
 *   - messages_fts: FTS5 virtual table for full-text search
 */

import { openStore, closeStore, getVersion, setVersion } from './sqlite-store.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseJsonlFile, detectFormat } from './transcript-parser.mjs';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { createTracer } = _require('./tracer');
const tracer = createTracer('session-store');

const DEFAULT_DB_PATH = path.join(os.homedir(), '.openclaw/state.db');

export class SessionStore {
  #db;
  #dbPath;

  /**
   * @param {Object} opts
   * @param {string} opts.dbPath - Database path (default: ~/.openclaw/state.db)
   */
  constructor(opts = {}) {
    this.#dbPath = opts.dbPath || DEFAULT_DB_PATH;
    this.#db = openStore(this.#dbPath);

    this.#runMigrations();
  }

  get dbPath() { return this.#dbPath; }

  // ── Schema ────────────────────────────────────

  #runMigrations() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,          -- source identifier: 'gateway', 'discord', 'claude-code', etc.
        start_time TEXT NOT NULL,      -- ISO 8601
        end_time TEXT,                 -- ISO 8601 (null = still active)
        summary TEXT,                  -- optional one-line summary
        message_count INTEGER DEFAULT 0,
        parent_session_id TEXT,        -- optional link to parent session
        metadata TEXT,                 -- JSON blob for extra data
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role TEXT NOT NULL,            -- 'user', 'assistant', 'system'
        content TEXT NOT NULL,
        timestamp TEXT,                -- ISO 8601
        turn_index INTEGER NOT NULL,   -- 0-based position in conversation
        metadata TEXT                  -- JSON: tool_calls, token_count, etc.
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);
      CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);
    `);

    // FTS5 virtual table for full-text search on message content
    this.#db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        role,
        session_id UNINDEXED,
        content='messages',
        content_rowid='id'
      );
    `);

    // F-H10 fix: use CREATE TRIGGER IF NOT EXISTS per-trigger instead of
    // gating ALL triggers on the presence of just `messages_ai`. If any
    // single trigger gets dropped or renamed in the future, the others
    // still get recreated. Also added `messages_au` for UPDATE — otherwise
    // edited message content silently desyncs from FTS.
    this.#db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content, role, session_id)
          VALUES (new.id, new.content, new.role, new.session_id);
        END;

        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content, role, session_id)
          VALUES ('delete', old.id, old.content, old.role, old.session_id);
        END;

        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content, role, session_id)
          VALUES ('delete', old.id, old.content, old.role, old.session_id);
          INSERT INTO messages_fts(rowid, content, role, session_id)
          VALUES (new.id, new.content, new.role, new.session_id);
        END;
    `);
    // F-H10 cont'd: if FTS has zero rows but messages has some (e.g. coming
    // from an old DB where triggers didn't exist), rebuild the FTS index.
    try {
      const msgCount = this.#db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
      const ftsCount = this.#db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get().n;
      if (msgCount > 0 && ftsCount === 0) {
        this.#db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild');`);
      }
    } catch { /* fts5 quirk on rebuild — ignore */ }

    if (getVersion(this.#db) < 1) setVersion(this.#db, 1);
  }

  // ── Import ────────────────────────────────────

  /**
   * Import a session from any JSONL transcript file.
   * Format-agnostic — auto-detects any registered transcript format.
   * Supports append-delta: if the session already exists with fewer
   * messages than the JSONL, only the new turns are inserted.
   *
   * @param {string} jsonlPath - Path to the JSONL session file
   * @param {Object} opts
   * @param {string} opts.source - Source identifier (e.g. 'gateway', 'claude-code'). Default: 'unknown'
   * @param {string} opts.format - Transcript format (auto-detected if omitted)
   * @returns {Promise<{ sessionId: string, messageCount: number, imported: boolean }>}
   */
  async importSession(jsonlPath, opts = {}) {
    const { source = 'unknown', format } = opts;
    const sessionId = path.basename(jsonlPath, '.jsonl');

    // Parse JSONL using format-agnostic transcript parser
    const parsed = await parseJsonlFile(jsonlPath, { format });

    if (parsed.length === 0) {
      return { sessionId, messageCount: 0, imported: false };
    }

    // Build message list with turn indices
    const messages = parsed.map((msg, i) => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp || null,
      turnIndex: i,
    }));

    // The parser's output for a given file can change between imports (e.g. an
    // upgrade that stops dropping tool entries re-counts the same file higher),
    // so the stored count cannot be trusted as a slice offset — slicing grafts
    // two different parses of the same conversation together. Instead: skip when
    // the stored count already matches (unchanged convo — the common case), else
    // replace this session's rows wholesale. Always correct, never misaligned.
    const existing = this.#db.prepare('SELECT message_count FROM sessions WHERE id = ?').get(sessionId);

    if (existing && existing.message_count === messages.length) {
      return { sessionId, messageCount: 0, imported: false };
    }

    const startTime = messages[0].timestamp || new Date().toISOString();
    const endTime = messages[messages.length - 1].timestamp;

    const upsertSession = this.#db.prepare(`
      INSERT INTO sessions (id, source, start_time, end_time, message_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        end_time = excluded.end_time,
        message_count = excluded.message_count
    `);

    const deleteMessages = this.#db.prepare('DELETE FROM messages WHERE session_id = ?');

    const insertMessage = this.#db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp, turn_index)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = this.#db.transaction(() => {
      upsertSession.run(sessionId, source, startTime || new Date().toISOString(), endTime, messages.length);
      deleteMessages.run(sessionId);
      for (const msg of messages) {
        insertMessage.run(sessionId, msg.role, msg.content, msg.timestamp, msg.turnIndex);
      }
    });

    transaction();

    return { sessionId, messageCount: messages.length, imported: true };
  }

  /**
   * Import multiple sessions from a directory of JSONL files.
   * @param {string} dirPath - Directory containing .jsonl files
   * @param {Object} opts - Options forwarded to importSession
   * @param {string} opts.source - Source identifier (e.g. 'gateway', 'claude-code')
   * @param {string} opts.format - Transcript format (auto-detected if omitted)
   * @param {function} opts.onImported - Callback fired per successfully imported session: (result) => void
   * @returns {Promise<{ imported: number, skipped: number, total: number }>}
   */
  async importDirectory(dirPath, opts = {}) {
    if (!fs.existsSync(dirPath)) return { imported: 0, skipped: 0, total: 0 };

    const { onImported, ...importOpts } = opts;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
    let imported = 0, skipped = 0;

    for (const f of files) {
      const result = await this.importSession(path.join(dirPath, f), importOpts);
      if (result.imported) {
        imported++;
        if (onImported) onImported(result);
      } else {
        skipped++;
      }
    }

    return { imported, skipped, total: files.length };
  }

  // ── Search ────────────────────────────────────

  /**
   * Search session transcripts using FTS5.
   *
   * Returns results grouped by session, ranked by:
   *   score = match_count × recency_weight
   *
   * Each result includes context windows around matches.
   *
   * @param {string} query - Search query (supports FTS5 syntax)
   * @param {Object} opts
   * @param {number} opts.limit - Max sessions to return (default: 10)
   * @param {string} opts.role - Filter by role: 'user', 'assistant', or null (default: null)
   * @param {number} opts.contextTurns - Number of surrounding turns for context (default: 2)
   * @param {number} opts.recencyDays - Recency decay period in days (default: 30)
   * @returns {Array<{ sessionId, source, startTime, matchCount, score, excerpts }>}
   */
  search(query, opts = {}) {
    const { limit = 10, role = null, contextTurns = 2, recencyDays = 30 } = opts;

    // Build FTS5 query
    const ftsQuery = this.#buildFtsQuery(query);
    if (!ftsQuery) return [];

    // Search with FTS5
    let sql = `
      SELECT
        m.id,
        m.session_id,
        m.role,
        m.content,
        m.turn_index,
        m.timestamp,
        rank
      FROM messages_fts
      JOIN messages m ON messages_fts.rowid = m.id
      WHERE messages_fts MATCH ?
    `;
    const params = [ftsQuery];

    if (role) {
      sql += ' AND m.role = ?';
      params.push(role);
    }

    sql += ' ORDER BY rank LIMIT 200'; // cap raw matches

    const matches = this.#db.prepare(sql).all(...params);

    if (matches.length === 0) return [];

    // Group by session
    const bySession = new Map();
    for (const match of matches) {
      if (!bySession.has(match.session_id)) {
        bySession.set(match.session_id, []);
      }
      bySession.get(match.session_id).push(match);
    }

    // Score and rank sessions
    const now = Date.now();
    const results = [];

    for (const [sessionId, sessionMatches] of bySession) {
      const session = this.#db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session) continue;

      const matchCount = sessionMatches.length;

      // Recency weight: exp(-daysOld / recencyDays)
      const sessionDate = session.start_time ? new Date(session.start_time).getTime() : 0;
      const daysOld = (now - sessionDate) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.exp(-daysOld / recencyDays);

      const score = matchCount * recencyWeight;

      // Build context excerpts
      const turnIndices = sessionMatches.map(m => m.turn_index);
      const contextRanges = this.#mergeTurnRanges(turnIndices, contextTurns);

      const excerpts = [];
      for (const [start, end] of contextRanges) {
        const turns = this.#db.prepare(`
          SELECT role, content, turn_index, timestamp
          FROM messages
          WHERE session_id = ? AND turn_index BETWEEN ? AND ?
          ORDER BY turn_index
        `).all(sessionId, start, end);

        const matchIndices = new Set(turnIndices.filter(i => i >= start && i <= end));

        excerpts.push({
          turns: turns.map(t => ({
            role: t.role,
            content: t.content.slice(0, 300), // truncate for context
            turnIndex: t.turn_index,
            isMatch: matchIndices.has(t.turn_index),
          })),
          startTurn: start,
          endTurn: end,
        });
      }

      results.push({
        sessionId,
        source: session.source,
        startTime: session.start_time,
        matchCount,
        score: Math.round(score * 1000) / 1000,
        excerpts,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // ── Session Management ────────────────────────────────────

  /**
   * Update a session's summary.
   */
  updateSummary(sessionId, summary) {
    this.#db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, sessionId);
  }

  /**
   * Get session by ID with message count.
   */
  getSession(sessionId) {
    return this.#db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  }

  /**
   * List recent sessions.
   */
  listSessions(opts = {}) {
    const { limit = 20, offset = 0, source = null } = opts;
    let sql = 'SELECT * FROM sessions';
    const params = [];
    if (source) {
      sql += ' WHERE source = ?';
      params.push(source);
    }
    sql += ' ORDER BY start_time DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return this.#db.prepare(sql).all(...params);
  }

  /**
   * Get database stats.
   */
  getStats() {
    const sessions = this.#db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    const messages = this.#db.prepare('SELECT COUNT(*) as count FROM messages').get();
    const dbSize = fs.statSync(this.#dbPath).size;

    return {
      sessionCount: sessions.count,
      messageCount: messages.count,
      dbSizeBytes: dbSize,
      dbSizeMb: Math.round(dbSize / 1024 / 1024 * 100) / 100,
    };
  }

  /**
   * Close the database connection.
   */
  close() {
    closeStore(this.#db);
  }

  // ── Private Helpers ────────────────────────────────────

  /**
   * Build an FTS5 query from a natural language search string.
   * - Single word → "word"* (prefix match)
   * - Multi-word → phrase + individual terms
   * - Escapes quotes
   */
  #buildFtsQuery(query) {
    if (!query || !query.trim()) return null;
    // F-H11 fix: strip MORE operators. FTS5 keywords (AND, OR, NOT, NEAR) are
    // case-sensitive (uppercase), so we don't accidentally clobber them inside
    // quoted phrases — but we DO need to strip them when bare. Also strip
    // ':' (column-scope), '~' (synonym), '-' (negation), and cap word count
    // to prevent DoS via runaway NEAR/9999 scans.
    const escaped = query.replace(/"/g, '""').trim();
    // Strip dangerous syntactic characters
    let safe = escaped.replace(/[*(){}^~:\-]/g, ' ');
    // Replace bare keyword operators with lowercase equivalents (FTS5 only
    // treats UPPERCASE as operators in unquoted context)
    safe = safe.replace(/\b(AND|OR|NOT|NEAR)\b/g, m => m.toLowerCase());
    if (!safe.trim()) return null;

    // F-H11: cap word count to prevent runaway query
    const words = safe.split(/\s+/).filter(w => w.length > 0).slice(0, 30);
    if (words.length === 0) return null;

    if (words.length === 1) {
      return `"${words[0]}"*`;
    }

    // Multi-word: phrase match OR individual prefix matches
    const phrase = `"${words.join(' ')}"`;
    const prefixes = words.map(w => `"${w}"*`).join(' OR ');
    return `(${phrase}) OR (${prefixes})`;
  }

  /**
   * Merge overlapping turn ranges to prevent duplicate excerpts.
   *
   * Given match turn indices [3, 5, 12, 14] with contextTurns=2:
   *   → ranges before merge: [1-5], [3-7], [10-14], [12-16]
   *   → after merge: [1-7], [10-16]
   *
   * @param {number[]} turnIndices - Array of matching turn indices
   * @param {number} context - Number of context turns on each side
   * @returns {Array<[number, number]>} Merged [start, end] ranges
   */
  #mergeTurnRanges(turnIndices, context) {
    if (turnIndices.length === 0) return [];

    // Build ranges
    const ranges = turnIndices
      .map(i => [Math.max(0, i - context), i + context])
      .sort((a, b) => a[0] - b[0]);

    // Merge overlapping
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = ranges[i];
      if (curr[0] <= prev[1] + 1) {
        prev[1] = Math.max(prev[1], curr[1]);
      } else {
        merged.push(curr);
      }
    }

    return merged;
  }
}

/**
 * Create a SessionStore instance with default path.
 * @param {Object} opts - Options forwarded to SessionStore
 */
const _createSessionStore = function createSessionStore(opts = {}) {
  const instance = new SessionStore(opts);
  tracer.wrapClass(instance, [
    'importSession', 'importDirectory', 'search',
    'updateSummary', 'getSession', 'listSessions', 'getStats', 'close',
  ], { tier: 3, category: 'io' });
  return instance;
};
export { _createSessionStore as createSessionStore };
