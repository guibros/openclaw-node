/**
 * memory-archive.mjs — where decayed memory goes, and how it comes back.
 *
 * Decay takes an entity or a decision out of the live tables once its salience
 * falls below the drop threshold. Until 2026-09-26 that removal destroyed data:
 * decisions were hard-deleted, an archived entity lost its mention rows and (by
 * FK cascade) its aliases, and the archive kept a fixed subset of columns — no
 * privacy flag, no reinforcement credit, no embedding. Archival is now a move:
 *   - every live column is mirrored into the archive table, so a column a later
 *     migration adds is archived without touching this file;
 *   - an entity takes its mention rows and aliases with it;
 *   - resurrection restores the row under its original id when that id is free
 *     (published_items and cooccurrence_state keep pointing at it), with its
 *     mentions and aliases, at RESURRECTED_SALIENCE.
 *
 * consolidation.mjs archives (decayWeights, pruneStale); extraction-store.mjs
 * resurrects on re-mention. Both run ensureArchiveTables, which is idempotent.
 */

// Salience an archived row returns with when re-mentioned (P5-2): above
// consolidation's DECAY_DROP_THRESHOLD (0.05) so it is not archived again on
// the next cycle, well below the 0.5 a fresh row starts at — it has to earn
// recall again like any stale item.
export const RESURRECTED_SALIENCE = 0.15;

const quote = (name) => `"${name}"`;

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columnsOf(db, table) {
  return db.pragma(`table_info(${table})`).map((c) => c.name);
}

// Declared type only: an archive row is a copy and carries no constraints,
// defaults or foreign keys of its own.
function mirrorColumns(db, live, archive) {
  const have = new Set(columnsOf(db, archive));
  for (const col of db.pragma(`table_info(${live})`)) {
    if (!have.has(col.name)) db.exec(`ALTER TABLE ${archive} ADD COLUMN ${quote(col.name)} ${col.type || ''}`);
  }
}

/**
 * Create the archive tables and mirror every live column into them. The
 * entities_archived DDL is the pre-2026-09-26 one, so existing archives are
 * extended in place rather than rebuilt; the caller owns the transaction.
 *
 * @param {object} db — better-sqlite3 database instance
 */
export function ensureArchiveTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities_archived (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      canonical_name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      salience REAL DEFAULT 0.5,
      last_recalled TEXT,
      archived_at TEXT NOT NULL,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE IF NOT EXISTS decisions_archived (
      id INTEGER PRIMARY KEY,
      archived_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mentions_archived (
      id INTEGER PRIMARY KEY,
      archived_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entity_aliases_archived (
      alias_canonical TEXT NOT NULL,
      alias TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      created_at TEXT,
      archived_at TEXT NOT NULL,
      PRIMARY KEY (alias_canonical, entity_id)
    );
  `);
  for (const [live, archive] of [
    ['entities', 'entities_archived'],
    ['decisions', 'decisions_archived'],
    ['mentions', 'mentions_archived'],
  ]) {
    if (tableExists(db, live)) mirrorColumns(db, live, archive);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_entities_archived_canonical ON entities_archived(canonical_name);
    CREATE INDEX IF NOT EXISTS idx_entities_archived_lname ON entities_archived(lower(name));
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_archived_entity ON entity_aliases_archived(entity_id);
  `);
  if (columnsOf(db, 'mentions_archived').includes('entity_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_mentions_archived_entity ON mentions_archived(entity_id)');
  }
  const decisionCols = columnsOf(db, 'decisions_archived');
  if (decisionCols.includes('session_id') && decisionCols.includes('decision')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_archived_identity ON decisions_archived(session_id, decision)');
  }
}

/**
 * Archive/resurrect operations over one database. Every method runs inside
 * the caller's transaction. Archive statements are built from the columns at
 * creation time (consolidation creates one per pass); restores read columns
 * at call time, so a long-lived store never restores with a column list
 * captured before a later migration added one.
 *
 * @param {object} db — better-sqlite3 database instance
 */
export function createMemoryArchive(db) {
  ensureArchiveTables(db);
  const hasAliases = tableExists(db, 'entity_aliases');

  const once = (build) => { let v; return () => (v ??= build()); };

  const entityMoves = once(() => {
    const ent = columnsOf(db, 'entities').map(quote).join(', ');
    const men = columnsOf(db, 'mentions').map(quote).join(', ');
    return {
      copyEntity: db.prepare(`INSERT OR REPLACE INTO entities_archived (${ent}, archived_at) SELECT ${ent}, @at FROM entities WHERE id = @id`),
      copyMentions: db.prepare(`INSERT OR REPLACE INTO mentions_archived (${men}, archived_at) SELECT ${men}, @at FROM mentions WHERE entity_id = @id`),
      copyAliases: hasAliases && db.prepare(`
        INSERT OR REPLACE INTO entity_aliases_archived (alias_canonical, alias, entity_id, created_at, archived_at)
        SELECT alias_canonical, alias, entity_id, created_at, @at FROM entity_aliases WHERE entity_id = @id`),
      // mentions reference entities (F-C16): they leave before the entity row does
      dropMentions: db.prepare('DELETE FROM mentions WHERE entity_id = ?'),
      dropAliases: hasAliases && db.prepare('DELETE FROM entity_aliases WHERE entity_id = ?'),
      dropEntity: db.prepare('DELETE FROM entities WHERE id = ?'),
    };
  });

  const decisionMoves = once(() => {
    const dec = columnsOf(db, 'decisions').map(quote).join(', ');
    return {
      copy: db.prepare(`INSERT OR REPLACE INTO decisions_archived (${dec}, archived_at) SELECT ${dec}, @at FROM decisions WHERE id = @id`),
      // the decisions_fts delete trigger, where present, drops it from the index
      drop: db.prepare('DELETE FROM decisions WHERE id = ?'),
    };
  });

  // An archive row whose id is live again is an audit copy (the repair 1.7
  // restore left flagged rows behind), never a candidate for resurrection.
  const findEntityByName = once(() => db.prepare(`
    SELECT a.* FROM entities_archived a
    WHERE (a.canonical_name = @canonical OR lower(a.name) = lower(@name))
      AND NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = a.id)
    ORDER BY a.archived_at DESC LIMIT 1
  `));
  const findEntityByAlias = once(() => db.prepare(`
    SELECT a.* FROM entity_aliases_archived x
    JOIN entities_archived a ON a.id = x.entity_id
    WHERE x.alias_canonical = @canonical
      AND NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = a.id)
    ORDER BY a.archived_at DESC LIMIT 1
  `));
  const findDecisionByIdentity = once(() => db.prepare(`
    SELECT * FROM decisions_archived WHERE session_id = ? AND decision = ?
    ORDER BY archived_at DESC LIMIT 1
  `));

  // Archived columns the live table still has, overlaid with `overrides`,
  // inserted under the archived id when it is free.
  function insertRestored(table, archived, overrides = {}) {
    const live = columnsOf(db, table);
    const row = {};
    // Archived NULLs are left to the live default: v7 mirroring added its
    // columns to pre-v7 rows empty, and copying those NULLs failed the insert
    // on reinforcement_count NOT NULL — rolling back the whole extraction —
    // and restored private as NULL (F-C15).
    for (const c of live) if (c in archived && archived[c] !== null) row[c] = archived[c];
    for (const [c, v] of Object.entries(overrides)) if (live.includes(c)) row[c] = v;
    if (row.id != null && db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(row.id)) delete row.id;
    const cols = Object.keys(row);
    const info = db.prepare(
      `INSERT INTO ${table} (${cols.map(quote).join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
    ).run(row);
    return Number(info.lastInsertRowid);
  }

  /**
   * Move an entity out of the live tables with its mention rows and aliases.
   * @returns {{ mentions: number, aliases: number }} rows moved alongside
   */
  function archiveEntity(id, archivedAt) {
    const s = entityMoves();
    s.copyEntity.run({ id, at: archivedAt });
    const mentions = s.copyMentions.run({ id, at: archivedAt }).changes;
    const aliases = s.copyAliases ? s.copyAliases.run({ id, at: archivedAt }).changes : 0;
    s.dropMentions.run(id);
    if (s.dropAliases) s.dropAliases.run(id);
    s.dropEntity.run(id);
    return { mentions, aliases };
  }

  function archiveDecision(id, archivedAt) {
    const s = decisionMoves();
    s.copy.run({ id, at: archivedAt });
    s.drop.run(id);
  }

  /**
   * The archived entity a mention refers to — by canonical name (or, for rows
   * archived before names were canonicalized, case-insensitive name), else by
   * one of its archived aliases.
   */
  function findEntity(canonical, name) {
    return findEntityByName().get({ canonical, name }) ?? findEntityByAlias().get({ canonical });
  }

  function findDecision(sessionId, decision) {
    return findDecisionByIdentity().get(sessionId, decision);
  }

  /**
   * Bring an archived entity back with its mentions and aliases. An alias some
   * live entity has claimed since stays with that entity (an alias never steals
   * an identity). The caller recomputes mention_count once the new mention is in.
   * @returns {{ id: number, mentions: number, aliases: number, aliasesSkipped: number }}
   */
  function restoreEntity(archived, overrides) {
    const id = insertRestored('entities', archived, overrides);
    let mentions = 0;
    for (const m of db.prepare('SELECT * FROM mentions_archived WHERE entity_id = ? ORDER BY id').all(archived.id)) {
      insertRestored('mentions', m, { entity_id: id });
      mentions++;
    }
    let aliases = 0;
    let aliasesSkipped = 0;
    if (hasAliases) {
      const taken = db.prepare(`
        SELECT 1 FROM entities WHERE canonical_name = @c
        UNION ALL SELECT 1 FROM entity_aliases WHERE alias_canonical = @c`);
      const insertAlias = db.prepare(`
        INSERT INTO entity_aliases (alias_canonical, alias, entity_id, created_at)
        VALUES (@alias_canonical, @alias, @entity_id, @created_at)`);
      for (const a of db.prepare('SELECT * FROM entity_aliases_archived WHERE entity_id = ? ORDER BY created_at').all(archived.id)) {
        if (taken.get({ c: a.alias_canonical })) { aliasesSkipped++; continue; }
        insertAlias.run({
          alias_canonical: a.alias_canonical,
          alias: a.alias,
          entity_id: id,
          created_at: a.created_at ?? overrides.last_seen,
        });
        aliases++;
      }
    }
    db.prepare('DELETE FROM mentions_archived WHERE entity_id = ?').run(archived.id);
    db.prepare('DELETE FROM entity_aliases_archived WHERE entity_id = ?').run(archived.id);
    db.prepare('DELETE FROM entities_archived WHERE id = ?').run(archived.id);
    return { id, mentions, aliases, aliasesSkipped };
  }

  /** @returns {number} the restored decision's id */
  function restoreDecision(archived, overrides) {
    const id = insertRestored('decisions', archived, overrides);
    db.prepare('DELETE FROM decisions_archived WHERE id = ?').run(archived.id);
    return id;
  }

  return { archiveEntity, archiveDecision, findEntity, findDecision, restoreEntity, restoreDecision };
}
