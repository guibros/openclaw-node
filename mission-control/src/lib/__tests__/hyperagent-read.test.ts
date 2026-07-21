/**
 * hyperagent-read — READ-ONLY data layer over ha_* (hyperagent-evidence 1.2).
 * Fixture sqlite DB; asserts counts, listing, run-report distinct-task
 * accounting, and that the live handle is strictly readonly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ha-read-"));
const dbPath = path.join(tmp, "state.db");

beforeAll(() => {
  const d = new Database(dbPath);
  d.exec(`
    CREATE TABLE ha_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT, soul_id TEXT, task_id TEXT,
      domain TEXT, subdomain TEXT, strategy_id INTEGER, outcome TEXT, iterations INTEGER,
      duration_minutes REAL, pattern_flags TEXT, meta_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      run_id TEXT, logical_task_id TEXT, session_id TEXT, execution_class TEXT,
      collaboration_mode TEXT, provider TEXT, model TEXT
    );
    CREATE TABLE ha_strategies (id INTEGER PRIMARY KEY, domain TEXT, title TEXT, active INTEGER);
    CREATE TABLE ha_reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT, soul_id TEXT,
      telemetry_from_id INTEGER, telemetry_to_id INTEGER, telemetry_count INTEGER,
      raw_stats TEXT, hypotheses TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ha_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reflection_id INTEGER, node_id TEXT, soul_id TEXT,
      title TEXT, description TEXT, proposal_type TEXT, target_ref TEXT, diff_content TEXT,
      domain TEXT, subdomain TEXT, status TEXT DEFAULT 'pending',
      eval_window_start TEXT, eval_window_end TEXT, eval_telemetry_count INTEGER,
      eval_result TEXT, reviewed_by TEXT, review_reason TEXT, reviewed_at TEXT,
      apply_status TEXT, applied_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const ins = d.prepare(`INSERT INTO ha_telemetry (node_id, soul_id, task_id, domain, outcome, run_id, logical_task_id, session_id, execution_class, collaboration_mode, provider, strategy_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // 3 real worker rows sharing ONE logical task + 1 mock + 1 NULL-class historical
  for (const t of ["w1", "w2", "w3"]) {
    ins.run("n1", "s1", t, "testing", "success", "run-1", "LT-1", "sess-1", "real", "collaborative", "claude", 7);
  }
  ins.run("n1", "s1", "m1", "testing", "failure", "run-1", "LT-M", "sess-2", "mock", null, "shell", null);
  ins.run("n1", "s1", "old1", "testing", "success", null, null, null, null, null, null, null);
  d.prepare("INSERT INTO ha_strategies (domain, title, active) VALUES ('testing', 'S', 1)").run();
  d.prepare("INSERT INTO ha_reflections (node_id, soul_id, telemetry_from_id, telemetry_to_id, telemetry_count, raw_stats) VALUES ('n1','s1',1,3,3,'{}')").run();
  d.prepare("INSERT INTO ha_proposals (reflection_id, node_id, soul_id, title, description, proposal_type, domain) VALUES (1,'n1','s1','Seeded proposal','desc','strategy_new','testing')").run();
  d.close();
  process.env.OPENCLAW_STATE_DB = dbPath;
});

afterAll(async () => {
  const mod = await import("@/lib/hyperagent-read");
  mod.resetForTests();
  delete process.env.OPENCLAW_STATE_DB;
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
});

describe("hyperagent-read (readonly evidence layer)", () => {
  it("overview counts by class with NULL as unknown", async () => {
    const { getOverview } = await import("@/lib/hyperagent-read");
    const o = getOverview();
    expect(o.available).toBe(true);
    expect(o.telemetry).toBe(5);
    expect(o.byClass).toEqual({ mock: 1, real: 3, unknown: 1 });
    expect(o.activeStrategies).toBe(1);
    expect(o.reflections.pendingSynthesis).toBe(1);
    expect(o.proposalsByStatus).toEqual({ pending: 1 });
  });

  it("lists the seeded proposal and pending reflection", async () => {
    const { listProposals, listReflections } = await import("@/lib/hyperagent-read");
    const props = listProposals(10);
    expect(props).toHaveLength(1);
    expect(props[0].title).toBe("Seeded proposal");
    expect(props[0].status).toBe("pending");
    const refl = listReflections(10);
    expect(refl[0].pending).toBe(true);
  });

  it("run report: duplicated worker rows count as ONE logical task; mock excluded from cohort", async () => {
    const { runReport } = await import("@/lib/hyperagent-read");
    const r = runReport("run-1");
    expect(r.totals.rows).toBe(4);
    expect(r.cohort.rows).toBe(3);
    expect(r.cohort.logicalTasks).toBe(1);
    expect(r.cohort.strategyCoverageRows).toBe(3);
    expect(r.byClass).toEqual({ mock: 1, real: 3 });
  });

  it("the live handle is strictly readonly", async () => {
    const { isReadonly } = await import("@/lib/hyperagent-read");
    expect(isReadonly()).toBe(true);
  });
});
