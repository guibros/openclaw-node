/**
 * hyperagent-store.mjs — HyperAgent protocol persistence layer.
 *
 * SQLite tables in ~/.openclaw/state.db for the evidence-driven strategy loop:
 *   - ha_telemetry: per-task performance data with auto-detected pattern flags
 *   - ha_strategies: reusable approaches indexed by domain/subdomain
 *   - ha_reflections: periodic structured analysis (raw stats + LLM synthesis)
 *   - ha_proposals: strategy proposals with observation windows + human gate
 *   - ha_telemetry_proposals: junction for overlapping eval windows
 *
 * Follows session-store.mjs patterns: same DB, WAL mode, better-sqlite3, sync API.
 *
 * External dependency: better-sqlite3
 */

import { openStore, closeStore } from './sqlite-store.mjs';
import path from 'path';
import os from 'os';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { createTracer } = _require('./tracer');
const tracer = createTracer('hyperagent-store');

const DEFAULT_DB_PATH = path.join(os.homedir(), '.openclaw/state.db');
const PROPOSAL_TYPES = new Set(['strategy_update', 'strategy_new', 'harness_rule', 'workflow_change']);
const OUTCOMES = new Set(['success', 'partial', 'failure']);
// Cohort provenance (hyperagent-evidence 0.2): rows must be mechanically
// assignable to / excludable from an evidence cohort. Absent (NULL) reads as
// 'unknown' — historical rows stay queryable and cohort-INELIGIBLE.
const EXECUTION_CLASSES = new Set(['real', 'mock', 'chaos', 'synthetic']);

function requiredText(name, value, maxLength = 512) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${name} exceeds ${maxLength} characters`);
  return normalized;
}

function normalizeTaxonomy(name, value, required = false) {
  if (value == null || value === '') {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  return requiredText(name, value, 128).toLowerCase().replace(/\s+/g, '-');
}

function sqliteTimestamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function parseObject(name, value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); }
    catch { throw new Error(`${name} must be valid JSON`); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed;
}

export class HyperAgentStore {
  #db;
  #dbPath;

  constructor(opts = {}) {
    this.#dbPath = opts.dbPath || DEFAULT_DB_PATH;
    this.#db = openStore(this.#dbPath);

    this.#runMigrations();
  }

  get dbPath() { return this.#dbPath; }

  // ── Schema ────────────────────────────────────

  #runMigrations() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ha_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        soul_id TEXT NOT NULL,
        task_id TEXT,
        domain TEXT NOT NULL,
        subdomain TEXT,
        strategy_id INTEGER REFERENCES ha_strategies(id),
        outcome TEXT NOT NULL CHECK(outcome IN ('success','partial','failure')),
        iterations INTEGER DEFAULT 1,
        duration_minutes REAL,
        pattern_flags TEXT DEFAULT '[]',
        meta_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ha_tel_domain ON ha_telemetry(domain, subdomain);
      CREATE INDEX IF NOT EXISTS idx_ha_tel_node ON ha_telemetry(node_id);

      CREATE TABLE IF NOT EXISTS ha_strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        subdomain TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        version INTEGER DEFAULT 1,
        supersedes INTEGER REFERENCES ha_strategies(id),
        active INTEGER DEFAULT 1,
        node_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ha_strat_domain ON ha_strategies(domain, subdomain);
      CREATE INDEX IF NOT EXISTS idx_ha_strat_active ON ha_strategies(active);

      CREATE TABLE IF NOT EXISTS ha_reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        soul_id TEXT NOT NULL,
        telemetry_from_id INTEGER NOT NULL,
        telemetry_to_id INTEGER NOT NULL,
        telemetry_count INTEGER NOT NULL,
        raw_stats TEXT NOT NULL,
        hypotheses TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ha_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reflection_id INTEGER NOT NULL REFERENCES ha_reflections(id),
        node_id TEXT NOT NULL,
        soul_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        proposal_type TEXT NOT NULL CHECK(proposal_type IN ('strategy_update','strategy_new','harness_rule','workflow_change')),
        target_ref TEXT,
        diff_content TEXT,
        domain TEXT,
        subdomain TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','shadow','approved','rejected','expired')),
        eval_window_start TEXT,
        eval_window_end TEXT,
        eval_telemetry_count INTEGER DEFAULT 0,
        eval_result TEXT,
        reviewed_by TEXT,
        review_reason TEXT,
        reviewed_at TEXT,
        apply_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK(apply_status IN ('not_applicable','applied','manual_required')),
        applied_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ha_prop_status ON ha_proposals(status);

      CREATE TABLE IF NOT EXISTS ha_telemetry_proposals (
        telemetry_id INTEGER NOT NULL REFERENCES ha_telemetry(id),
        proposal_id INTEGER NOT NULL REFERENCES ha_proposals(id),
        PRIMARY KEY (telemetry_id, proposal_id)
      );
    `);

    for (const col of ['run_id', 'logical_task_id', 'session_id', 'execution_class',
                       'collaboration_mode', 'provider', 'model']) {
      this.#ensureColumn('ha_telemetry', col, 'TEXT');
    }
    this.#db.exec('CREATE INDEX IF NOT EXISTS idx_ha_tel_cohort ON ha_telemetry(run_id, execution_class)');

    this.#ensureColumn('ha_proposals', 'domain', 'TEXT');
    this.#ensureColumn('ha_proposals', 'subdomain', 'TEXT');
    this.#ensureColumn('ha_proposals', 'review_reason', 'TEXT');
    this.#ensureColumn('ha_proposals', 'apply_status', "TEXT NOT NULL DEFAULT 'not_applicable'");
    this.#ensureColumn('ha_proposals', 'applied_at', 'TEXT');

    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ha_tel_identity ON ha_telemetry(node_id, soul_id, id);
      CREATE INDEX IF NOT EXISTS idx_ha_ref_identity ON ha_reflections(node_id, soul_id, telemetry_to_id);
      CREATE INDEX IF NOT EXISTS idx_ha_tel_task
        ON ha_telemetry(node_id, soul_id, task_id) WHERE task_id IS NOT NULL;
    `);
  }

  #ensureColumn(table, column, definition) {
    const columns = this.#db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((entry) => entry.name === column)) {
      this.#db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // ── Telemetry ────────────────────────────────────

  /**
   * Log a telemetry entry. Pattern flags are auto-detected after insert.
   * Also links to any active observation windows via the junction table.
   *
   * @param {Object} entry
   * @returns {Object} The inserted row with auto-detected pattern_flags
   */
  logTelemetry(entry) {
    const node_id = requiredText('node_id', entry.node_id, 128);
    const soul_id = requiredText('soul_id', entry.soul_id, 128);
    const task_id = entry.task_id == null ? null : requiredText('task_id', entry.task_id, 256);
    const domain = normalizeTaxonomy('domain', entry.domain, true);
    const subdomain = normalizeTaxonomy('subdomain', entry.subdomain);
    const strategy_id = entry.strategy_id == null ? null : Number(entry.strategy_id);
    const outcome = entry.outcome;
    const iterations = entry.iterations ?? 1;
    const duration_minutes = entry.duration_minutes ?? null;
    const meta_notes = entry.meta_notes == null ? null : String(entry.meta_notes).trim();
    const execution_class = entry.execution_class == null ? null : String(entry.execution_class);
    const run_id = entry.run_id == null ? null : requiredText('run_id', entry.run_id, 128);
    const logical_task_id = entry.logical_task_id == null ? null : requiredText('logical_task_id', entry.logical_task_id, 256);
    const session_id = entry.session_id == null ? null : requiredText('session_id', entry.session_id, 256);
    const collaboration_mode = entry.collaboration_mode == null ? null : requiredText('collaboration_mode', entry.collaboration_mode, 64);
    const provider = entry.provider == null ? null : requiredText('provider', entry.provider, 64);
    const model = entry.model == null ? null : requiredText('model', entry.model, 128);

    if (execution_class != null && !EXECUTION_CLASSES.has(execution_class)) {
      throw new Error(`invalid execution_class: ${execution_class} (real|mock|chaos|synthetic; omit for unknown)`);
    }
    if (!OUTCOMES.has(outcome)) throw new Error(`invalid outcome: ${outcome}`);
    if (!Number.isInteger(iterations) || iterations < 1) throw new Error('iterations must be a positive integer');
    if (duration_minutes != null && (!Number.isFinite(duration_minutes) || duration_minutes < 0)) {
      throw new Error('duration_minutes must be a non-negative number');
    }
    if (strategy_id != null) {
      if (!Number.isInteger(strategy_id) || strategy_id < 1) throw new Error('strategy_id must be a positive integer');
      const strategy = this.getStrategyById(strategy_id);
      if (!strategy) throw new Error(`strategy ${strategy_id} not found`);
      if (strategy.domain !== domain) throw new Error(`strategy ${strategy_id} belongs to domain ${strategy.domain}`);
      if (strategy.node_id && strategy.node_id !== node_id) {
        throw new Error(`strategy ${strategy_id} belongs to node ${strategy.node_id}`);
      }
    }

    const transaction = this.#db.transaction(() => {
      if (task_id) {
        const existing = this.#db.prepare(
          'SELECT * FROM ha_telemetry WHERE node_id = ? AND soul_id = ? AND task_id = ? ORDER BY id LIMIT 1'
        ).get(node_id, soul_id, task_id);
        if (existing) return existing;
      }

      const result = this.#db.prepare(`
        INSERT INTO ha_telemetry (node_id, soul_id, task_id, domain, subdomain,
          strategy_id, outcome, iterations, duration_minutes, meta_notes,
          run_id, logical_task_id, session_id, execution_class, collaboration_mode, provider, model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        node_id, soul_id, task_id, domain, subdomain,
        strategy_id, outcome, iterations, duration_minutes, meta_notes,
        run_id, logical_task_id, session_id, execution_class, collaboration_mode, provider, model
      );
      const rowId = result.lastInsertRowid;
      const flags = this.#detectPatternFlags(rowId, {
        node_id, domain, subdomain, strategy_id, outcome, iterations, meta_notes, soul_id,
      });
      if (flags.length > 0) {
        this.#db.prepare('UPDATE ha_telemetry SET pattern_flags = ? WHERE id = ?')
          .run(JSON.stringify(flags), rowId);
      }
      this.#linkToObservations(rowId);
      return this.#db.prepare('SELECT * FROM ha_telemetry WHERE id = ?').get(rowId);
    });
    return transaction.immediate();
  }

  /**
   * Auto-detect pattern flags from telemetry history.
   */
  #detectPatternFlags(rowId, entry) {
    const flags = [];

    // repeated-approach: same strategy on last 3+ tasks in same domain
    if (entry.strategy_id != null) {
      const recent = this.#db.prepare(`
        SELECT strategy_id FROM ha_telemetry
        WHERE node_id = ? AND soul_id = ? AND domain = ? AND id <= ?
        ORDER BY id DESC LIMIT 3
      `).all(entry.node_id, entry.soul_id, entry.domain, rowId);
      if (recent.length === 3 && recent.every((row) => row.strategy_id === entry.strategy_id)) {
        flags.push('repeated-approach');
      }
    }

    // multiple-iterations: > 3 attempts
    if (entry.iterations > 3) flags.push('multiple-iterations');

    // no-meta-notes: empty or too short
    if (!entry.meta_notes || entry.meta_notes.trim().length < 20) {
      flags.push('no-meta-notes');
    }

    // always-escalated: failure with only 1 iteration (didn't really try)
    if (entry.outcome === 'failure' && entry.iterations <= 1) {
      flags.push('always-escalated');
    }

    return flags;
  }

  /**
   * Link a telemetry entry to matching active observation windows.
   */
  #linkToObservations(telemetryId) {
    const telemetry = this.#db.prepare('SELECT * FROM ha_telemetry WHERE id = ?').get(telemetryId);
    const observationProposals = this.#db.prepare(`
      SELECT id FROM ha_proposals
      WHERE status = 'shadow'
        AND node_id = ?
        AND soul_id = ?
        AND domain = ?
        AND (subdomain IS NULL OR subdomain = ?)
        AND eval_window_start IS NOT NULL
        AND eval_window_end IS NOT NULL
        AND datetime(?) BETWEEN datetime(eval_window_start) AND datetime(eval_window_end)
    `).all(telemetry.node_id, telemetry.soul_id, telemetry.domain, telemetry.subdomain, telemetry.created_at);

    const linkStmt = this.#db.prepare(
      'INSERT OR IGNORE INTO ha_telemetry_proposals (telemetry_id, proposal_id) VALUES (?, ?)'
    );

    for (const p of observationProposals) {
      linkStmt.run(telemetryId, p.id);
    }
  }

  /**
   * Get telemetry entries since a given ID.
   */
  getTelemetrySince(sinceId = 0, opts = {}) {
    const clauses = ['id > ?'];
    const params = [sinceId];
    if (opts.node_id) { clauses.push('node_id = ?'); params.push(opts.node_id); }
    if (opts.soul_id) { clauses.push('soul_id = ?'); params.push(opts.soul_id); }
    return this.#db.prepare(
      `SELECT * FROM ha_telemetry WHERE ${clauses.join(' AND ')} ORDER BY id`
    ).all(...params);
  }

  /**
   * Get recent telemetry with optional filters.
   */
  getTelemetry(opts = {}) {
    const last = Number(opts.last ?? 20);
    if (!Number.isInteger(last) || last < 1 || last > 1000) throw new Error('last must be between 1 and 1000');
    const clauses = [];
    const params = [];
    if (opts.domain) { clauses.push('domain = ?'); params.push(normalizeTaxonomy('domain', opts.domain, true)); }
    if (opts.node_id) { clauses.push('node_id = ?'); params.push(opts.node_id); }
    if (opts.soul_id) { clauses.push('soul_id = ?'); params.push(opts.soul_id); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.#db.prepare(
      `SELECT * FROM ha_telemetry ${where} ORDER BY id DESC LIMIT ?`
    ).all(...params, last);
  }

  /**
   * Count telemetry entries not yet covered by a reflection.
   */
  getUnreflectedCount(opts = {}) {
    const clauses = [];
    const params = [];
    if (opts.node_id) { clauses.push('t.node_id = ?'); params.push(opts.node_id); }
    if (opts.soul_id) { clauses.push('t.soul_id = ?'); params.push(opts.soul_id); }
    const extra = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    const row = this.#db.prepare(`
      SELECT COUNT(*) as n FROM ha_telemetry t
      WHERE t.id > COALESCE(
        (SELECT MAX(r.telemetry_to_id) FROM ha_reflections r
         WHERE r.node_id = t.node_id AND r.soul_id = t.soul_id),
        0
      )
      ${extra}
    `).get(...params);
    return row.n;
  }

  getUnreflectedGroups(minCount = 1) {
    if (!Number.isInteger(minCount) || minCount < 1) throw new Error('minCount must be a positive integer');
    return this.#db.prepare(`
      SELECT t.node_id, t.soul_id, COUNT(*) AS count,
        MIN(t.id) AS from_id, MAX(t.id) AS to_id,
        COALESCE(MAX((SELECT MAX(r.telemetry_to_id) FROM ha_reflections r
          WHERE r.node_id = t.node_id AND r.soul_id = t.soul_id)), 0) AS last_reflected_id
      FROM ha_telemetry t
      WHERE t.id > COALESCE(
        (SELECT MAX(r.telemetry_to_id) FROM ha_reflections r
         WHERE r.node_id = t.node_id AND r.soul_id = t.soul_id),
        0
      )
      GROUP BY t.node_id, t.soul_id
      HAVING COUNT(*) >= ?
      ORDER BY t.node_id, t.soul_id
    `).all(minCount);
  }

  /**
   * Compute aggregated stats from telemetry since a given ID.
   */
  computeStats(sinceId = 0, opts = {}) {
    const entries = this.getTelemetrySince(sinceId, opts);
    if (entries.length === 0) return null;

    const byDomain = {};
    const allFlags = {};
    let totalIterations = 0;
    let successCount = 0;

    for (const e of entries) {
      // Domain stats
      if (!byDomain[e.domain]) {
        byDomain[e.domain] = { count: 0, success: 0, totalIterations: 0, subdomains: {} };
      }
      const d = byDomain[e.domain];
      d.count++;
      if (e.outcome === 'success') d.success++;
      d.totalIterations += e.iterations;

      if (e.subdomain) {
        d.subdomains[e.subdomain] = (d.subdomains[e.subdomain] || 0) + 1;
      }

      // Global stats
      totalIterations += e.iterations;
      if (e.outcome === 'success') successCount++;

      // Flag frequencies
      const flags = JSON.parse(e.pattern_flags || '[]');
      for (const f of flags) {
        allFlags[f] = (allFlags[f] || 0) + 1;
      }
    }

    // Per-domain averages
    for (const d of Object.values(byDomain)) {
      d.successRate = d.count > 0 ? Math.round(d.success / d.count * 100) : 0;
      d.avgIterations = d.count > 0 ? Math.round(d.totalIterations / d.count * 10) / 10 : 0;
    }

    // Strategy hit rate
    const withStrategy = entries.filter(e => e.strategy_id != null).length;

    return {
      totalTasks: entries.length,
      successRate: Math.round(successCount / entries.length * 100),
      avgIterations: Math.round(totalIterations / entries.length * 10) / 10,
      strategyHitRate: Math.round(withStrategy / entries.length * 100),
      byDomain,
      flagFrequencies: allFlags,
      fromId: entries[0].id,
      toId: entries[entries.length - 1].id,
    };
  }

  // ── Strategies ────────────────────────────────────

  /**
   * Create or update a strategy. If supersedes is set, atomically deactivate the old one.
   */
  putStrategy({ domain, subdomain = null, title, content, source = 'manual', node_id = null, supersedes = null }) {
    domain = normalizeTaxonomy('domain', domain, true);
    subdomain = normalizeTaxonomy('subdomain', subdomain);
    title = requiredText('title', title, 256);
    content = requiredText('content', content, 20000);
    source = requiredText('source', source, 64);
    if (node_id != null) node_id = requiredText('node_id', node_id, 128);
    if (supersedes != null) {
      supersedes = Number(supersedes);
      if (!Number.isInteger(supersedes) || supersedes < 1) throw new Error('supersedes must be a positive integer');
      const previous = this.getStrategyById(supersedes);
      if (!previous || !previous.active) throw new Error(`active strategy ${supersedes} not found`);
      if (previous.node_id !== node_id) {
        throw new Error(`strategy ${supersedes} ownership does not match the replacement`);
      }
    }

    const transaction = this.#db.transaction(() => {
      if (supersedes != null) {
        this.#db.prepare('UPDATE ha_strategies SET active = 0, updated_at = datetime(\'now\') WHERE id = ?')
          .run(supersedes);
      }

      const result = this.#db.prepare(`
        INSERT INTO ha_strategies (domain, subdomain, title, content, source, node_id, supersedes,
          version)
        VALUES (?, ?, ?, ?, ?, ?, ?,
          COALESCE((SELECT version + 1 FROM ha_strategies WHERE id = ?), 1))
      `).run(domain, subdomain, title, content, source, node_id, supersedes, supersedes);

      return result.lastInsertRowid;
    });

    const id = transaction();
    return this.#db.prepare('SELECT * FROM ha_strategies WHERE id = ?').get(id);
  }

  /**
   * Get the best active strategy for a domain/subdomain.
   * Prefers exact subdomain match, falls back to domain-only.
   */
  getStrategy(domain, subdomain = null, nodeId = null) {
    domain = normalizeTaxonomy('domain', domain, true);
    subdomain = normalizeTaxonomy('subdomain', subdomain);
    if (nodeId != null) nodeId = requiredText('nodeId', nodeId, 128);
    if (subdomain) {
      const exact = this.#db.prepare(
        `SELECT * FROM ha_strategies
         WHERE domain = ? AND subdomain = ? AND active = 1
           AND (node_id IS NULL OR node_id = ?)
         ORDER BY CASE WHEN node_id = ? THEN 0 ELSE 1 END, version DESC, id DESC
         LIMIT 1`
      ).get(domain, subdomain, nodeId, nodeId);
      if (exact) return exact;
    }
    return this.#db.prepare(
      `SELECT * FROM ha_strategies
       WHERE domain = ? AND (subdomain IS NULL OR subdomain = ?) AND active = 1
         AND (node_id IS NULL OR node_id = ?)
       ORDER BY CASE WHEN node_id = ? THEN 0 ELSE 1 END, version DESC, id DESC
       LIMIT 1`
    ).get(domain, subdomain, nodeId, nodeId);
  }

  getStrategyById(id) {
    id = Number(id);
    if (!Number.isInteger(id) || id < 1) return null;
    return this.#db.prepare('SELECT * FROM ha_strategies WHERE id = ?').get(id) || null;
  }

  /**
   * List strategies with optional filters.
   */
  listStrategies(opts = {}) {
    const { domain, active = true } = opts;
    if (domain) {
      return this.#db.prepare(
        'SELECT * FROM ha_strategies WHERE domain = ? AND active = ? ORDER BY updated_at DESC'
      ).all(normalizeTaxonomy('domain', domain, true), active ? 1 : 0);
    }
    return this.#db.prepare(
      'SELECT * FROM ha_strategies WHERE active = ? ORDER BY domain, updated_at DESC'
    ).all(active ? 1 : 0);
  }

  /**
   * Archive (deactivate) a strategy.
   */
  archiveStrategy(id) {
    const result = this.#db.prepare('UPDATE ha_strategies SET active = 0, updated_at = datetime(\'now\') WHERE id = ? AND active = 1').run(id);
    if (result.changes !== 1) throw new Error(`active strategy ${id} not found`);
  }

  // ── Reflections ────────────────────────────────────

  /**
   * Create a reflection with raw stats. hypotheses filled later by --write-synthesis.
   */
  putReflection({ node_id, soul_id, telemetry_from_id, telemetry_to_id, telemetry_count, raw_stats }) {
    node_id = requiredText('node_id', node_id, 128);
    soul_id = requiredText('soul_id', soul_id, 128);
    if (!Number.isInteger(telemetry_from_id) || !Number.isInteger(telemetry_to_id) || telemetry_from_id < 1 || telemetry_to_id < telemetry_from_id) {
      throw new Error('invalid telemetry reflection window');
    }
    if (!Number.isInteger(telemetry_count) || telemetry_count < 1) throw new Error('telemetry_count must be positive');
    const existing = this.#db.prepare(`
      SELECT * FROM ha_reflections
      WHERE node_id = ? AND soul_id = ? AND telemetry_from_id = ? AND telemetry_to_id = ?
    `).get(node_id, soul_id, telemetry_from_id, telemetry_to_id);
    if (existing) return existing;

    const result = this.#db.prepare(`
      INSERT INTO ha_reflections (node_id, soul_id, telemetry_from_id, telemetry_to_id,
        telemetry_count, raw_stats)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(node_id, soul_id, telemetry_from_id, telemetry_to_id, telemetry_count,
      typeof raw_stats === 'string' ? raw_stats : JSON.stringify(raw_stats));

    return this.#db.prepare('SELECT * FROM ha_reflections WHERE id = ?').get(result.lastInsertRowid);
  }

  /**
   * Write LLM-generated synthesis to an existing reflection.
   */
  writeSynthesis(reflectionId, { hypotheses }) {
    if (!Array.isArray(hypotheses) || hypotheses.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error('hypotheses must be an array of non-empty strings');
    }
    const result = this.#db.prepare('UPDATE ha_reflections SET hypotheses = ? WHERE id = ? AND hypotheses IS NULL')
      .run(JSON.stringify(hypotheses.map((item) => item.trim())), reflectionId);
    if (result.changes !== 1) throw new Error(`pending reflection ${reflectionId} not found`);
    return this.#db.prepare('SELECT * FROM ha_reflections WHERE id = ?').get(reflectionId);
  }

  synthesizeReflection(reflectionId, { hypotheses, proposals = [] }) {
    if (!Array.isArray(proposals)) throw new Error('proposals must be an array');
    if (proposals.length > 2) throw new Error('at most 2 proposals may be created per reflection');
    const transaction = this.#db.transaction(() => {
      const reflection = this.#db.prepare(
        'SELECT * FROM ha_reflections WHERE id = ? AND hypotheses IS NULL'
      ).get(reflectionId);
      if (!reflection) throw new Error(`pending reflection ${reflectionId} not found`);
      this.writeSynthesis(reflectionId, { hypotheses });
      return proposals.map((proposal) => this.putProposal({
        ...proposal,
        reflection_id: reflectionId,
        node_id: reflection.node_id,
        soul_id: reflection.soul_id,
      }));
    });
    return transaction.immediate();
  }

  createPendingReflections(minCount = 5) {
    const transaction = this.#db.transaction(() => {
      const created = [];
      for (const group of this.getUnreflectedGroups(minCount)) {
        const stats = this.computeStats(group.last_reflected_id, {
          node_id: group.node_id,
          soul_id: group.soul_id,
        });
        if (!stats || stats.totalTasks < minCount) continue;
        created.push(this.putReflection({
          node_id: group.node_id,
          soul_id: group.soul_id,
          telemetry_from_id: stats.fromId,
          telemetry_to_id: stats.toId,
          telemetry_count: stats.totalTasks,
          raw_stats: stats,
        }));
      }
      return created;
    });
    return transaction.immediate();
  }

  /**
   * List recent reflections.
   */
  listReflections(opts = {}) {
    const { limit = 10 } = opts;
    const clauses = [];
    const params = [];
    if (opts.node_id) { clauses.push('node_id = ?'); params.push(opts.node_id); }
    if (opts.soul_id) { clauses.push('soul_id = ?'); params.push(opts.soul_id); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.#db.prepare(
      `SELECT * FROM ha_reflections ${where} ORDER BY id DESC LIMIT ?`
    ).all(...params, limit);
  }

  /**
   * Get the last reflection (for chaining previous_hypotheses).
   */
  getLastReflection(opts = {}) {
    if (opts.node_id && opts.soul_id) {
      return this.#db.prepare(`
        SELECT * FROM ha_reflections WHERE node_id = ? AND soul_id = ? ORDER BY id DESC LIMIT 1
      `).get(opts.node_id, opts.soul_id) || null;
    }
    return this.#db.prepare('SELECT * FROM ha_reflections ORDER BY id DESC LIMIT 1').get() || null;
  }

  /**
   * Get the oldest pending-synthesis reflection (< 24h old).
   * Returns null if none pending.
   */
  getPendingSynthesis(opts = {}) {
    const clauses = ['hypotheses IS NULL', "created_at > datetime('now', '-24 hours')"];
    const params = [];
    if (opts.node_id) { clauses.push('node_id = ?'); params.push(opts.node_id); }
    if (opts.soul_id) { clauses.push('soul_id = ?'); params.push(opts.soul_id); }
    return this.#db.prepare(`
      SELECT * FROM ha_reflections
      WHERE ${clauses.join(' AND ')}
      ORDER BY id ASC
      LIMIT 1
    `).get(...params) || null;
  }

  /**
   * Get the reflection immediately before a given one (for hypothesis chaining).
   */
  getPreviousReflection(reflectionId) {
    return this.#db.prepare(`
      SELECT previous.* FROM ha_reflections current
      JOIN ha_reflections previous
        ON previous.node_id = current.node_id AND previous.soul_id = current.soul_id
      WHERE current.id = ? AND previous.id < current.id AND previous.hypotheses IS NOT NULL
      ORDER BY previous.id DESC
      LIMIT 1
    `).get(reflectionId) || null;
  }

  /**
   * Expire stale pending reflections (> 24h without synthesis).
   */
  expireStalePending() {
    const result = this.#db.prepare(`
      UPDATE ha_reflections SET hypotheses = '["expired — no synthesis within 24h"]'
      WHERE hypotheses IS NULL
        AND created_at < datetime('now', '-24 hours')
    `).run();
    return result.changes;
  }

  // ── Proposals ────────────────────────────────────

  /**
   * Create a proposal linked to a reflection.
   */
  putProposal({ reflection_id, node_id, soul_id, title, description, proposal_type, target_ref = null, diff_content = null }) {
    // harness_rule/workflow_change have NO apply logic — approveProposal only
    // materializes strategy_* types. Accepting them meant "approved" silently
    // did nothing (audits/hyperagent_review). Fail at write time until an
    // apply path exists; the CHECK enum stays for existing rows.
    if (proposal_type === 'harness_rule' || proposal_type === 'workflow_change') {
      throw new Error(`proposal_type '${proposal_type}' has no apply implementation — only strategy_new/strategy_update are actionable`);
    }
    if (!PROPOSAL_TYPES.has(proposal_type)) throw new Error(`invalid proposal_type: ${proposal_type}`);
    const reflection = this.#db.prepare('SELECT * FROM ha_reflections WHERE id = ?').get(reflection_id);
    if (!reflection) throw new Error(`reflection ${reflection_id} not found`);
    if (node_id != null && node_id !== reflection.node_id) throw new Error('proposal node_id must match its reflection');
    if (soul_id != null && soul_id !== reflection.soul_id) throw new Error('proposal soul_id must match its reflection');
    title = requiredText('title', title, 256);
    description = requiredText('description', description, 4000);

    let domain;
    let subdomain;
    if (proposal_type === 'strategy_new') {
      const strategy = parseObject('diff_content', diff_content);
      domain = normalizeTaxonomy('domain', strategy.domain, true);
      subdomain = normalizeTaxonomy('subdomain', strategy.subdomain);
      requiredText('strategy content', strategy.content, 20000);
    } else {
      const strategy = this.getStrategyById(target_ref);
      if (!strategy || !strategy.active) throw new Error(`active strategy ${target_ref} not found`);
      if (strategy.node_id && strategy.node_id !== reflection.node_id) {
        throw new Error(`strategy ${target_ref} belongs to node ${strategy.node_id}`);
      }
      parseObject('diff_content', diff_content);
      domain = strategy.domain;
      subdomain = strategy.subdomain;
    }
    const result = this.#db.prepare(`
      INSERT INTO ha_proposals (reflection_id, node_id, soul_id, title, description,
        proposal_type, target_ref, diff_content, domain, subdomain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reflection_id, reflection.node_id, reflection.soul_id, title, description,
      proposal_type, target_ref, diff_content, domain, subdomain);

    return this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(result.lastInsertRowid);
  }

  /**
   * Start an observational telemetry window. The proposal is not applied.
   */
  startObservation(proposalId, windowMinutes = 60) {
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 10080) {
      throw new Error('windowMinutes must be between 1 and 10080');
    }
    const proposal = this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(proposalId);
    if (!proposal) throw new Error(`proposal ${proposalId} not found`);
    if (proposal.status !== 'pending') throw new Error(`proposal ${proposalId} is ${proposal.status}, expected pending`);
    if (!proposal.proposal_type.startsWith('strategy_') || !proposal.domain) {
      throw new Error('observation windows require a domain-scoped strategy proposal');
    }
    const start = sqliteTimestamp();
    const end = sqliteTimestamp(new Date(Date.now() + windowMinutes * 60 * 1000));

    const result = this.#db.prepare(`
      UPDATE ha_proposals SET status = 'shadow', eval_window_start = ?, eval_window_end = ?
      WHERE id = ? AND status = 'pending'
    `).run(start, end, proposalId);
    if (result.changes !== 1) throw new Error(`proposal ${proposalId} could not enter observation`);

    return this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(proposalId);
  }

  /**
   * Approve a proposal. If it's a strategy proposal, apply the change.
   */
  approveProposal(proposalId, reviewedBy = 'human') {
    const proposal = this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(proposalId);
    if (!proposal) throw new Error(`proposal ${proposalId} not found`);
    if (!['pending', 'shadow'].includes(proposal.status)) {
      throw new Error(`proposal ${proposalId} is ${proposal.status}, expected pending or shadow`);
    }

    let strategyChange;
    if (proposal.proposal_type === 'strategy_new') {
      const data = parseObject('diff_content', proposal.diff_content);
      strategyChange = {
        domain: data.domain,
        subdomain: data.subdomain || null,
        title: data.title || proposal.title,
        content: data.content,
        source: 'reflection',
        node_id: proposal.node_id,
      };
      requiredText('strategy content', strategyChange.content, 20000);
    } else if (proposal.proposal_type === 'strategy_update') {
      const strategyId = Number(proposal.target_ref);
      const current = this.getStrategyById(strategyId);
      if (!current || !current.active) throw new Error(`active strategy ${proposal.target_ref} not found`);
      const updates = parseObject('diff_content', proposal.diff_content);
      strategyChange = {
        domain: updates.domain ?? current.domain,
        subdomain: updates.subdomain ?? current.subdomain,
        title: updates.title ?? current.title,
        content: updates.content ?? current.content,
        source: 'reflection',
        node_id: proposal.node_id,
        supersedes: current.node_id === proposal.node_id ? strategyId : null,
      };
    } else {
      throw new Error(`proposal_type '${proposal.proposal_type}' has no apply implementation`);
    }

    const transaction = this.#db.transaction(() => {
      this.putStrategy(strategyChange);
      const result = this.#db.prepare(`
        UPDATE ha_proposals SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'),
          apply_status = 'applied', applied_at = datetime('now')
        WHERE id = ? AND status IN ('pending','shadow')
      `).run(requiredText('reviewedBy', reviewedBy, 128), proposalId);
      if (result.changes !== 1) throw new Error(`proposal ${proposalId} changed during approval`);
    });

    transaction.immediate();
    return this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(proposalId);
  }

  /**
   * Reject a proposal.
   */
  rejectProposal(proposalId, reviewedBy = 'human', reason = null) {
    const result = this.#db.prepare(`
      UPDATE ha_proposals SET status = 'rejected', reviewed_by = ?, review_reason = ?, reviewed_at = datetime('now')
      WHERE id = ? AND status IN ('pending','shadow')
    `).run(requiredText('reviewedBy', reviewedBy, 128),
      reason == null ? null : requiredText('reason', reason, 2000), proposalId);
    if (result.changes !== 1) {
      const proposal = this.#db.prepare('SELECT status FROM ha_proposals WHERE id = ?').get(proposalId);
      if (!proposal) throw new Error(`proposal ${proposalId} not found`);
      throw new Error(`proposal ${proposalId} is ${proposal.status}, expected pending or shadow`);
    }

    return this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(proposalId);
  }

  /**
   * Get proposals by status.
   */
  getProposals(opts = {}) {
    const { status } = opts;
    if (status) {
      return this.#db.prepare(
        'SELECT * FROM ha_proposals WHERE status = ? ORDER BY created_at DESC'
      ).all(status);
    }
    return this.#db.prepare(
      'SELECT * FROM ha_proposals ORDER BY created_at DESC'
    ).all();
  }

  /**
   * Close expired observation windows and compute descriptive, non-causal results.
   */
  checkObservationWindows() {
    const expired = this.#db.prepare(`
      SELECT * FROM ha_proposals
      WHERE status = 'shadow'
        AND eval_window_end IS NOT NULL
        AND datetime(eval_window_end) <= datetime('now')
    `).all();

    for (const proposal of expired) {
      // Count telemetry entries in the eval window
      const evalCount = this.#db.prepare(`
        SELECT COUNT(*) as n FROM ha_telemetry_proposals WHERE proposal_id = ?
      `).get(proposal.id).n;

      // Compute success rate during eval window
      const evalEntries = this.#db.prepare(`
        SELECT t.outcome FROM ha_telemetry t
        JOIN ha_telemetry_proposals tp ON t.id = tp.telemetry_id
        WHERE tp.proposal_id = ?
      `).all(proposal.id);

      const evalSuccessRate = evalEntries.length > 0
        ? Math.round(evalEntries.filter(e => e.outcome === 'success').length / evalEntries.length * 100)
        : null;

      // Compare against the same identity and taxonomy. The strategy proposal is
      // not applied during this window, so this is explicitly not treatment data.
      const beforeEntries = this.#db.prepare(`
        SELECT outcome FROM ha_telemetry
        WHERE node_id = ? AND soul_id = ? AND domain = ?
          AND (? IS NULL OR subdomain = ?)
          AND datetime(created_at) < datetime(?)
        ORDER BY id DESC LIMIT ?
      `).all(proposal.node_id, proposal.soul_id, proposal.domain,
        proposal.subdomain, proposal.subdomain, proposal.eval_window_start,
        Math.max(evalEntries.length, 5));

      const beforeSuccessRate = beforeEntries.length > 0
        ? Math.round(beforeEntries.filter(e => e.outcome === 'success').length / beforeEntries.length * 100)
        : null;

      const evalResult = {
        kind: 'observational',
        treatment_applied: false,
        tasks_in_window: evalCount,
        success_rate_before: beforeSuccessRate,
        success_rate_during: evalSuccessRate,
        delta: evalSuccessRate != null && beforeSuccessRate != null
          ? evalSuccessRate - beforeSuccessRate
          : null,
      };

      this.#db.prepare(`
        UPDATE ha_proposals
        SET status = 'pending', eval_telemetry_count = ?, eval_result = ?
        WHERE id = ?
      `).run(evalCount, JSON.stringify(evalResult), proposal.id);
    }

    return expired.length;
  }

  // ── Stats ────────────────────────────────────

  /**
   * Get overview stats for the hyperagent store.
   */
  getStats() {
    const telemetry = this.#db.prepare('SELECT COUNT(*) as n FROM ha_telemetry').get().n;
    const strategies = this.#db.prepare('SELECT COUNT(*) as n FROM ha_strategies WHERE active = 1').get().n;
    const reflections = this.#db.prepare('SELECT COUNT(*) as n FROM ha_reflections').get().n;
    const pendingProposals = this.#db.prepare("SELECT COUNT(*) as n FROM ha_proposals WHERE status IN ('pending','shadow')").get().n;
    const unreflected = this.getUnreflectedCount();

    return { telemetry, strategies, reflections, pendingProposals, unreflected };
  }

  /**
   * Close the database connection.
   */
  close() {
    closeStore(this.#db);
  }
}

/**
 * Create a HyperAgentStore instance with default path.
 */
const _createHyperAgentStore = function createHyperAgentStore(opts = {}) {
  const instance = new HyperAgentStore(opts);
  tracer.wrapClass(instance, [
    'logTelemetry', 'getTelemetrySince', 'getTelemetry', 'getUnreflectedCount',
    'getUnreflectedGroups', 'computeStats', 'putStrategy', 'getStrategy', 'getStrategyById',
    'listStrategies', 'archiveStrategy', 'putReflection', 'writeSynthesis',
    'synthesizeReflection', 'createPendingReflections', 'listReflections', 'getLastReflection',
    'getPendingSynthesis', 'getPreviousReflection', 'expireStalePending',
    'putProposal', 'startObservation', 'approveProposal', 'rejectProposal',
    'getProposals', 'checkObservationWindows', 'getStats', 'close',
  ], { tier: 3, category: 'io' });
  return instance;
};
export { _createHyperAgentStore as createHyperAgentStore };
