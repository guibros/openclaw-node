/**
 * hyperagent-store.mjs — HyperAgent protocol persistence layer.
 *
 * SQLite tables in ~/.openclaw/state.db for the self-improving agent loop:
 *   - ha_telemetry: per-task performance data with auto-detected pattern flags
 *   - ha_strategies: reusable approaches indexed by domain/subdomain
 *   - ha_reflections: periodic structured analysis (raw stats + LLM synthesis)
 *   - ha_proposals: self-modification proposals with shadow eval + human gate
 *   - ha_telemetry_proposals: junction for overlapping eval windows
 *
 * Follows session-store.mjs patterns: same DB, WAL mode, better-sqlite3, sync API.
 *
 * External dependency: better-sqlite3
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_DB_PATH = path.join(os.homedir(), '.openclaw/state.db');

export class HyperAgentStore {
  #db;
  #dbPath;

  constructor(opts = {}) {
    this.#dbPath = opts.dbPath || DEFAULT_DB_PATH;

    const dir = path.dirname(this.#dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.#db = new Database(this.#dbPath);
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('foreign_keys = ON');
    this.#db.pragma('busy_timeout = 5000');

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
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','shadow','approved','rejected','expired')),
        eval_window_start TEXT,
        eval_window_end TEXT,
        eval_telemetry_count INTEGER DEFAULT 0,
        eval_result TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ha_prop_status ON ha_proposals(status);

      CREATE TABLE IF NOT EXISTS ha_telemetry_proposals (
        telemetry_id INTEGER NOT NULL REFERENCES ha_telemetry(id),
        proposal_id INTEGER NOT NULL REFERENCES ha_proposals(id),
        PRIMARY KEY (telemetry_id, proposal_id)
      );
    `);
  }

  // ── Telemetry ────────────────────────────────────

  /**
   * Log a telemetry entry. Pattern flags are auto-detected after insert.
   * Also links to any active shadow eval proposals via junction table.
   *
   * @param {Object} entry
   * @returns {Object} The inserted row with auto-detected pattern_flags
   */
  logTelemetry(entry) {
    const {
      node_id, soul_id, task_id = null, domain, subdomain = null,
      strategy_id = null, outcome, iterations = 1,
      duration_minutes = null, meta_notes = null,
    } = entry;

    const insert = this.#db.prepare(`
      INSERT INTO ha_telemetry (node_id, soul_id, task_id, domain, subdomain,
        strategy_id, outcome, iterations, duration_minutes, meta_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      node_id, soul_id, task_id, domain, subdomain,
      strategy_id, outcome, iterations, duration_minutes, meta_notes
    );
    const rowId = result.lastInsertRowid;

    // Auto-detect pattern flags
    const flags = this.#detectPatternFlags(rowId, {
      domain, subdomain, strategy_id, outcome, iterations, meta_notes, soul_id,
    });

    if (flags.length > 0) {
      this.#db.prepare('UPDATE ha_telemetry SET pattern_flags = ? WHERE id = ?')
        .run(JSON.stringify(flags), rowId);
    }

    // Link to active shadow eval proposals
    this.#linkToShadowEvals(rowId);

    return this.#db.prepare('SELECT * FROM ha_telemetry WHERE id = ?').get(rowId);
  }

  /**
   * Auto-detect pattern flags from telemetry history.
   */
  #detectPatternFlags(rowId, entry) {
    const flags = [];

    // repeated-approach: same strategy on last 3+ tasks in same domain
    if (entry.strategy_id != null) {
      const recent = this.#db.prepare(`
        SELECT COUNT(*) as n FROM ha_telemetry
        WHERE domain = ? AND strategy_id = ? AND soul_id = ?
          AND id >= (SELECT MAX(0, ? - 3))
          AND id <= ?
      `).get(entry.domain, entry.strategy_id, entry.soul_id, rowId, rowId);
      if (recent.n >= 3) flags.push('repeated-approach');
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
   * Link a telemetry entry to any active shadow eval proposals.
   */
  #linkToShadowEvals(telemetryId) {
    const shadowProposals = this.#db.prepare(`
      SELECT id FROM ha_proposals
      WHERE status = 'shadow'
        AND eval_window_start IS NOT NULL
        AND eval_window_end IS NOT NULL
        AND datetime('now') BETWEEN eval_window_start AND eval_window_end
    `).all();

    const linkStmt = this.#db.prepare(
      'INSERT OR IGNORE INTO ha_telemetry_proposals (telemetry_id, proposal_id) VALUES (?, ?)'
    );

    for (const p of shadowProposals) {
      linkStmt.run(telemetryId, p.id);
    }
  }

  /**
   * Get telemetry entries since a given ID.
   */
  getTelemetrySince(sinceId = 0) {
    return this.#db.prepare(
      'SELECT * FROM ha_telemetry WHERE id > ? ORDER BY id'
    ).all(sinceId);
  }

  /**
   * Get recent telemetry with optional filters.
   */
  getTelemetry(opts = {}) {
    const { domain, last = 20 } = opts;
    if (domain) {
      return this.#db.prepare(
        'SELECT * FROM ha_telemetry WHERE domain = ? ORDER BY id DESC LIMIT ?'
      ).all(domain, last);
    }
    return this.#db.prepare(
      'SELECT * FROM ha_telemetry ORDER BY id DESC LIMIT ?'
    ).all(last);
  }

  /**
   * Count telemetry entries not yet covered by a reflection.
   */
  getUnreflectedCount() {
    const row = this.#db.prepare(`
      SELECT COUNT(*) as n FROM ha_telemetry
      WHERE id > COALESCE(
        (SELECT telemetry_to_id FROM ha_reflections ORDER BY created_at DESC LIMIT 1),
        0
      )
    `).get();
    return row.n;
  }

  /**
   * Compute aggregated stats from telemetry since a given ID.
   */
  computeStats(sinceId = 0) {
    const entries = this.getTelemetrySince(sinceId);
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
  getStrategy(domain, subdomain = null) {
    if (subdomain) {
      const exact = this.#db.prepare(
        'SELECT * FROM ha_strategies WHERE domain = ? AND subdomain = ? AND active = 1 ORDER BY version DESC LIMIT 1'
      ).get(domain, subdomain);
      if (exact) return exact;
    }
    return this.#db.prepare(
      'SELECT * FROM ha_strategies WHERE domain = ? AND (subdomain IS NULL OR subdomain = ?) AND active = 1 ORDER BY version DESC LIMIT 1'
    ).get(domain, subdomain);
  }

  /**
   * List strategies with optional filters.
   */
  listStrategies(opts = {}) {
    const { domain, active = true } = opts;
    if (domain) {
      return this.#db.prepare(
        'SELECT * FROM ha_strategies WHERE domain = ? AND active = ? ORDER BY updated_at DESC'
      ).all(domain, active ? 1 : 0);
    }
    return this.#db.prepare(
      'SELECT * FROM ha_strategies WHERE active = ? ORDER BY domain, updated_at DESC'
    ).all(active ? 1 : 0);
  }

  /**
   * Archive (deactivate) a strategy.
   */
  archiveStrategy(id) {
    this.#db.prepare('UPDATE ha_strategies SET active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(id);
  }

  // ── Reflections ────────────────────────────────────

  /**
   * Create a reflection with raw stats. hypotheses filled later by --write-synthesis.
   */
  putReflection({ node_id, soul_id, telemetry_from_id, telemetry_to_id, telemetry_count, raw_stats }) {
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
    this.#db.prepare('UPDATE ha_reflections SET hypotheses = ? WHERE id = ?')
      .run(typeof hypotheses === 'string' ? hypotheses : JSON.stringify(hypotheses), reflectionId);
    return this.#db.prepare('SELECT * FROM ha_reflections WHERE id = ?').get(reflectionId);
  }

  /**
   * List recent reflections.
   */
  listReflections(opts = {}) {
    const { limit = 10 } = opts;
    return this.#db.prepare(
      'SELECT * FROM ha_reflections ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
  }

  /**
   * Get the last reflection (for chaining previous_hypotheses).
   */
  getLastReflection() {
    return this.#db.prepare(
      'SELECT * FROM ha_reflections ORDER BY created_at DESC LIMIT 1'
    ).get() || null;
  }

  /**
   * Get the oldest pending-synthesis reflection (< 24h old).
   * Returns null if none pending.
   */
  getPendingSynthesis() {
    return this.#db.prepare(`
      SELECT * FROM ha_reflections
      WHERE hypotheses IS NULL
        AND created_at > datetime('now', '-24 hours')
      ORDER BY created_at ASC
      LIMIT 1
    `).get() || null;
  }

  /**
   * Get the reflection immediately before a given one (for hypothesis chaining).
   */
  getPreviousReflection(reflectionId) {
    return this.#db.prepare(`
      SELECT * FROM ha_reflections
      WHERE id < ? AND hypotheses IS NOT NULL
      ORDER BY id DESC
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
    const result = this.#db.prepare(`
      INSERT INTO ha_proposals (reflection_id, node_id, soul_id, title, description,
        proposal_type, target_ref, diff_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reflection_id, node_id, soul_id, title, description, proposal_type, target_ref, diff_content);

    return this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(result.lastInsertRowid);
  }

  /**
   * Start shadow evaluation for a proposal.
   */
  startShadowEval(proposalId, windowMinutes = 60) {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + windowMinutes * 60 * 1000).toISOString();

    this.#db.prepare(`
      UPDATE ha_proposals SET status = 'shadow', eval_window_start = ?, eval_window_end = ?
      WHERE id = ? AND status = 'pending'
    `).run(start, end, proposalId);

    return this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(proposalId);
  }

  /**
   * Approve a proposal. If it's a strategy proposal, apply the change.
   */
  approveProposal(proposalId, reviewedBy = 'human') {
    const proposal = this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(proposalId);
    if (!proposal) return null;

    const transaction = this.#db.transaction(() => {
      this.#db.prepare(`
        UPDATE ha_proposals SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now')
        WHERE id = ?
      `).run(reviewedBy, proposalId);

      // Auto-apply strategy proposals
      if (proposal.proposal_type === 'strategy_new' && proposal.diff_content) {
        try {
          const stratData = JSON.parse(proposal.diff_content);
          this.putStrategy({
            domain: stratData.domain,
            subdomain: stratData.subdomain || null,
            title: stratData.title || proposal.title,
            content: stratData.content,
            source: 'reflection',
            node_id: proposal.node_id,
          });
        } catch { /* diff_content not JSON — manual apply needed */ }
      }

      if (proposal.proposal_type === 'strategy_update' && proposal.target_ref && proposal.diff_content) {
        try {
          const stratId = parseInt(proposal.target_ref);
          const updates = JSON.parse(proposal.diff_content);
          this.putStrategy({
            ...updates,
            source: 'reflection',
            supersedes: stratId,
          });
        } catch { /* manual apply needed */ }
      }
    });

    transaction();
    return this.#db.prepare('SELECT * FROM ha_proposals WHERE id = ?').get(proposalId);
  }

  /**
   * Reject a proposal.
   */
  rejectProposal(proposalId, reviewedBy = 'human') {
    this.#db.prepare(`
      UPDATE ha_proposals SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(reviewedBy, proposalId);

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
   * Check expired shadow eval windows and compute results.
   */
  checkShadowWindows() {
    const expired = this.#db.prepare(`
      SELECT * FROM ha_proposals
      WHERE status = 'shadow'
        AND eval_window_end IS NOT NULL
        AND eval_window_end < datetime('now')
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

      // Compute success rate before eval window (last N tasks before window start)
      const beforeEntries = this.#db.prepare(`
        SELECT outcome FROM ha_telemetry
        WHERE created_at < ? ORDER BY created_at DESC LIMIT ?
      `).all(proposal.eval_window_start, Math.max(evalEntries.length, 5));

      const beforeSuccessRate = beforeEntries.length > 0
        ? Math.round(beforeEntries.filter(e => e.outcome === 'success').length / beforeEntries.length * 100)
        : null;

      const evalResult = {
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
    this.#db.close();
  }
}

/**
 * Create a HyperAgentStore instance with default path.
 */
export function createHyperAgentStore(opts = {}) {
  return new HyperAgentStore(opts);
}
