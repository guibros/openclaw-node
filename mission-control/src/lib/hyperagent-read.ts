/**
 * HyperAgent evidence — READ-ONLY data layer over the live state.db ha_* tables.
 *
 * hyperagent-evidence step 1.2: the operator inspects evidence and pending
 * proposals here; the ONLY approve/reject surface is the CLI, by design. This
 * module never opens the DB writable and exposes no mutation.
 *
 * Language discipline (federation D13): strategy attribution is COVERAGE,
 * never presented as effectiveness.
 */

import fs from "fs";
import Database from "better-sqlite3";
import { STATE_DB_PATH } from "@/lib/config";

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

function db(): Database.Database | null {
  const target = process.env.OPENCLAW_STATE_DB || STATE_DB_PATH;
  if (_db && _dbPath === target) return _db;
  if (_db) { _db.close(); _db = null; }
  if (!fs.existsSync(target)) return null;
  _db = new Database(target, { readonly: true, fileMustExist: true });
  _dbPath = target;
  return _db;
}

function hasTable(d: Database.Database, name: string): boolean {
  return !!d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

export interface HyperagentOverview {
  available: boolean;
  telemetry: number;
  byClass: Record<string, number>;
  activeStrategies: number;
  reflections: { total: number; pendingSynthesis: number };
  proposalsByStatus: Record<string, number>;
}

export function getOverview(): HyperagentOverview {
  const d = db();
  const empty: HyperagentOverview = {
    available: false, telemetry: 0, byClass: {}, activeStrategies: 0,
    reflections: { total: 0, pendingSynthesis: 0 }, proposalsByStatus: {},
  };
  if (!d || !hasTable(d, "ha_telemetry")) return empty;

  const byClass: Record<string, number> = {};
  for (const row of d.prepare(
    "SELECT COALESCE(execution_class, 'unknown') AS cls, COUNT(*) AS n FROM ha_telemetry GROUP BY cls ORDER BY cls"
  ).all() as { cls: string; n: number }[]) {
    byClass[row.cls] = row.n;
  }

  const proposalsByStatus: Record<string, number> = {};
  if (hasTable(d, "ha_proposals")) {
    for (const row of d.prepare(
      "SELECT status, COUNT(*) AS n FROM ha_proposals GROUP BY status ORDER BY status"
    ).all() as { status: string; n: number }[]) {
      proposalsByStatus[row.status] = row.n;
    }
  }

  return {
    available: true,
    telemetry: (d.prepare("SELECT COUNT(*) AS n FROM ha_telemetry").get() as { n: number }).n,
    byClass,
    activeStrategies: hasTable(d, "ha_strategies")
      ? (d.prepare("SELECT COUNT(*) AS n FROM ha_strategies WHERE active = 1").get() as { n: number }).n
      : 0,
    reflections: hasTable(d, "ha_reflections")
      ? {
          total: (d.prepare("SELECT COUNT(*) AS n FROM ha_reflections").get() as { n: number }).n,
          pendingSynthesis: (d.prepare("SELECT COUNT(*) AS n FROM ha_reflections WHERE hypotheses IS NULL").get() as { n: number }).n,
        }
      : { total: 0, pendingSynthesis: 0 },
    proposalsByStatus,
  };
}

export interface ReflectionRow {
  id: number; node_id: string; soul_id: string; telemetry_count: number;
  pending: boolean; created_at: string;
}

export function listReflections(limit = 20): ReflectionRow[] {
  const d = db();
  if (!d || !hasTable(d, "ha_reflections")) return [];
  return (d.prepare(
    "SELECT id, node_id, soul_id, telemetry_count, hypotheses, created_at FROM ha_reflections ORDER BY id DESC LIMIT ?"
  ).all(Math.max(1, Math.min(limit, 200))) as (ReflectionRow & { hypotheses: string | null })[])
    .map((r) => ({
      id: r.id, node_id: r.node_id, soul_id: r.soul_id,
      telemetry_count: r.telemetry_count, pending: r.hypotheses == null, created_at: r.created_at,
    }));
}

export interface ProposalRow {
  id: number; title: string; proposal_type: string; status: string;
  domain: string | null; reviewed_by: string | null; created_at: string;
  eval_telemetry_count: number | null;
}

export function listProposals(limit = 20): ProposalRow[] {
  const d = db();
  if (!d || !hasTable(d, "ha_proposals")) return [];
  return d.prepare(
    `SELECT id, title, proposal_type, status, domain, reviewed_by, created_at, eval_telemetry_count
     FROM ha_proposals ORDER BY id DESC LIMIT ?`
  ).all(Math.max(1, Math.min(limit, 200))) as ProposalRow[];
}

export interface RunReport {
  available: boolean;
  run_id: string;
  totals: { rows: number; sessions: number; logicalTasks: number };
  byClass: Record<string, number>;
  cohort: {
    rows: number;
    logicalTasks: number;
    outcomes: Record<string, number>;
    byDomain: Record<string, number>;
    byMode: Record<string, number>;
    strategyCoverageRows: number;
  };
}

export function runReport(runId: string): RunReport {
  const d = db();
  const empty: RunReport = {
    available: false, run_id: runId,
    totals: { rows: 0, sessions: 0, logicalTasks: 0 }, byClass: {},
    cohort: { rows: 0, logicalTasks: 0, outcomes: {}, byDomain: {}, byMode: {}, strategyCoverageRows: 0 },
  };
  if (!d || !hasTable(d, "ha_telemetry")) return empty;

  const rows = d.prepare("SELECT * FROM ha_telemetry WHERE run_id = ? ORDER BY id").all(runId) as Record<string, unknown>[];
  const cls = (r: Record<string, unknown>) => (r.execution_class as string) || "unknown";
  const distinct = (rs: Record<string, unknown>[], key: string) =>
    new Set(rs.map((r) => r[key]).filter(Boolean)).size;
  const countBy = (rs: Record<string, unknown>[], keyFn: (r: Record<string, unknown>) => string) => {
    const m: Record<string, number> = {};
    for (const r of rs) { const k = keyFn(r) ?? "null"; m[k] = (m[k] || 0) + 1; }
    return m;
  };

  const real = rows.filter((r) => cls(r) === "real");
  return {
    available: true,
    run_id: runId,
    totals: { rows: rows.length, sessions: distinct(rows, "session_id"), logicalTasks: distinct(rows, "logical_task_id") },
    byClass: countBy(rows, cls),
    cohort: {
      rows: real.length,
      logicalTasks: distinct(real, "logical_task_id"),
      outcomes: countBy(real, (r) => String(r.outcome)),
      byDomain: countBy(real, (r) => String(r.domain)),
      byMode: countBy(real, (r) => String(r.collaboration_mode ?? "null")),
      strategyCoverageRows: real.filter((r) => r.strategy_id != null).length,
    },
  };
}

/** Test hook: readonly-ness of the live handle. */
export function isReadonly(): boolean | null {
  const d = db();
  return d ? d.readonly : null;
}

/** Test hook: drop the cached handle (env-override switching). */
export function resetForTests(): void {
  if (_db) { _db.close(); _db = null; _dbPath = null; }
}
