/**
 * extraction-store.mjs — SQLite storage for LLM-extracted structured data.
 *
 * Manages four tables in the session-store database (~/.openclaw/state.db):
 *   - entities: named things (people, projects, technologies, etc.)
 *   - themes: hierarchical topic labels
 *   - mentions: per-session entity occurrences with salience
 *   - decisions: explicit decisions with rationale and confidence
 *
 * Also provides MEMORY.md generation from structured data — the new
 * replacement for regex-based fact extraction when USE_LLM_EXTRACTION=true.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_DB_PATH = path.join(os.homedir(), '.openclaw/state.db');

/**
 * Create an extraction store connected to the session database.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath] — path to SQLite database (default: ~/.openclaw/state.db)
 * @returns {object} extraction store API
 */
export function createExtractionStore(opts = {}) {
  const dbPath = opts.dbPath || DEFAULT_DB_PATH;

  // Ensure parent directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Schema Migration ────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      canonical_name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      embedding BLOB
    );

    CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      hierarchy_path TEXT,
      parent_id INTEGER REFERENCES themes(id),
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      session_id TEXT NOT NULL,
      turn_index INTEGER,
      salience REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mentions_entity ON mentions(entity_id);
    CREATE INDEX IF NOT EXISTS idx_mentions_session ON mentions(session_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_mention_count ON entities(mention_count DESC);
    CREATE INDEX IF NOT EXISTS idx_themes_mention_count ON themes(mention_count DESC);
  `);

  // ── Prepared Statements ────────────────────────────────

  const upsertEntity = db.prepare(`
    INSERT INTO entities (name, type, canonical_name, first_seen, last_seen, mention_count)
    VALUES (@name, @type, @canonical_name, @now, @now, 1)
    ON CONFLICT(name) DO UPDATE SET
      last_seen = @now,
      mention_count = mention_count + 1,
      type = @type
  `);

  const getEntityByName = db.prepare(`
    SELECT id FROM entities WHERE name = ?
  `);

  const upsertTheme = db.prepare(`
    INSERT INTO themes (label, hierarchy_path, first_seen, last_seen, mention_count)
    VALUES (@label, @hierarchy_path, @now, @now, 1)
    ON CONFLICT(label) DO UPDATE SET
      last_seen = @now,
      mention_count = mention_count + 1,
      hierarchy_path = @hierarchy_path
  `);

  const insertMention = db.prepare(`
    INSERT INTO mentions (entity_id, session_id, turn_index, salience, created_at)
    VALUES (@entity_id, @session_id, @turn_index, @salience, @created_at)
  `);

  const insertDecision = db.prepare(`
    INSERT INTO decisions (session_id, decision, rationale, confidence, created_at)
    VALUES (@session_id, @decision, @rationale, @confidence, @created_at)
  `);

  // ── Core API ────────────────────────────────

  /**
   * Store an ExtractionResult from LLM extraction into the database.
   * Upserts entities and themes (incrementing mention_count on repeat),
   * inserts mentions and decisions.
   *
   * @param {string} sessionId — session identifier
   * @param {object} result — validated ExtractionResult from extractStructured
   */
  function storeExtractionResult(sessionId, result) {
    const now = new Date().toISOString();

    const doStore = db.transaction(() => {
      // Store entities + mentions
      for (const entity of result.entities) {
        upsertEntity.run({
          name: entity.name,
          type: entity.type,
          canonical_name: entity.name,
          now,
        });

        const row = getEntityByName.get(entity.name);
        if (row) {
          insertMention.run({
            entity_id: row.id,
            session_id: sessionId,
            turn_index: null,
            salience: entity.salience,
            created_at: now,
          });
        }
      }

      // Store themes
      for (const theme of result.themes) {
        upsertTheme.run({
          label: theme.label,
          hierarchy_path: JSON.stringify(theme.hierarchy),
          now,
        });
      }

      // Store decisions
      for (const decision of result.decisions) {
        insertDecision.run({
          session_id: sessionId,
          decision: decision.decision,
          rationale: decision.rationale,
          confidence: decision.confidence,
          created_at: now,
        });
      }
    });

    doStore();
  }

  /**
   * Generate MEMORY.md content from structured data in the database.
   * Produces a formatted markdown document organized by section:
   *   - Active Entities (top by mention_count)
   *   - Recent Decisions (most recent, high confidence first)
   *   - Active Themes (top by mention_count)
   *
   * @param {number} [charBudget=2200] — maximum character budget
   * @returns {string} formatted markdown content
   */
  function generateMemoryContent(charBudget = 2200) {
    const sections = [];

    // Active Entities — top 10 by mention_count
    const topEntities = db.prepare(`
      SELECT name, type, mention_count, last_seen
      FROM entities
      ORDER BY mention_count DESC, last_seen DESC
      LIMIT 10
    `).all();

    if (topEntities.length > 0) {
      const lines = topEntities.map(e =>
        `- ${e.name} (${e.type}, mentioned ${e.mention_count}×)`
      );
      sections.push(`## Active Entities\n${lines.join('\n')}`);
    }

    // Recent Decisions — last 5, high confidence first
    const recentDecisions = db.prepare(`
      SELECT decision, rationale, confidence, created_at
      FROM decisions
      ORDER BY created_at DESC, confidence DESC
      LIMIT 5
    `).all();

    if (recentDecisions.length > 0) {
      const lines = recentDecisions.map(d =>
        `- ${d.decision} — ${d.rationale} (confidence: ${d.confidence})`
      );
      sections.push(`## Recent Decisions\n${lines.join('\n')}`);
    }

    // Active Themes — top 5 by mention_count
    const topThemes = db.prepare(`
      SELECT label, hierarchy_path, mention_count
      FROM themes
      ORDER BY mention_count DESC, last_seen DESC
      LIMIT 5
    `).all();

    if (topThemes.length > 0) {
      const lines = topThemes.map(t => {
        let hierarchy = '';
        try {
          const arr = JSON.parse(t.hierarchy_path);
          if (arr.length > 0) hierarchy = ` [${arr.join(' > ')}]`;
        } catch { /* ignore parse errors */ }
        return `- ${t.label}${hierarchy} (${t.mention_count}×)`;
      });
      sections.push(`## Active Themes\n${lines.join('\n')}`);
    }

    if (sections.length === 0) {
      return '# Memory\n\nNo structured data extracted yet.\n';
    }

    let content = `# Memory\n\n${sections.join('\n\n')}\n`;

    // Trim to budget — remove lines from the end if over budget
    while (content.length > charBudget && content.includes('\n- ')) {
      const lastBulletIdx = content.lastIndexOf('\n- ');
      content = content.slice(0, lastBulletIdx) + '\n';
    }

    return content;
  }

  /**
   * Get extraction store statistics.
   * @returns {{ entityCount: number, themeCount: number, mentionCount: number, decisionCount: number }}
   */
  function getExtractionStats() {
    const entities = db.prepare('SELECT COUNT(*) as count FROM entities').get();
    const themes = db.prepare('SELECT COUNT(*) as count FROM themes').get();
    const mentions = db.prepare('SELECT COUNT(*) as count FROM mentions').get();
    const decisions = db.prepare('SELECT COUNT(*) as count FROM decisions').get();

    return {
      entityCount: entities.count,
      themeCount: themes.count,
      mentionCount: mentions.count,
      decisionCount: decisions.count,
    };
  }

  /**
   * Close the database connection.
   */
  function close() {
    db.close();
  }

  return {
    storeExtractionResult,
    generateMemoryContent,
    getExtractionStats,
    close,
    get dbPath() { return dbPath; },
  };
}
