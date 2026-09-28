import { expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("a healthy SQLite database starts without a recovery REINDEX", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-startup-"));
  const dbPath = path.join(root, "mission-control.db");
  const fixture = new Database(dbPath);
  fixture.exec("CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('keep');");
  fixture.close();
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  const exec = vi.spyOn(Database.prototype, "exec");
  let db: Database.Database | undefined;
  try {
    const { getRawDb, dbHealth } = await import("@/lib/db");
    db = getRawDb();
    expect(dbHealth().ok).toBe(true);
    expect(db.prepare("SELECT value FROM preserved").get()).toEqual({ value: "keep" });
    expect(exec.mock.calls.some(([sql]) => /^REINDEX\b/i.test(sql.trim()))).toBe(false);
  } finally {
    db?.close();
    exec.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.each(["integrity failure", "pragma throws"])("database startup refuses %s without repairing or caching the failed database", async failure => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-startup-failed-"));
  const dbPath = path.join(root, "mission-control.db");
  const fixture = new Database(dbPath);
  fixture.exec("CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('keep');");
  fixture.close();
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  const original = Database.prototype.pragma;
  const pragma = vi.spyOn(Database.prototype, "pragma").mockImplementation(function (this: Database.Database, source, options) {
    if (source === "quick_check") {
      if (failure === "pragma throws") throw new Error("SQLITE_CORRUPT");
      return "*** in database main *** corruption";
    }
    return original.call(this, source, options);
  });
  const exec = vi.spyOn(Database.prototype, "exec");
  const close = vi.spyOn(Database.prototype, "close");
  try {
    const { getRawDb, dbHealth } = await import("@/lib/db");
    expect(() => getRawDb()).toThrow();
    expect(dbHealth().ok).toBe(false);
    expect(close).toHaveBeenCalledTimes(2);
    expect(exec).not.toHaveBeenCalled();
    const verify = new Database(dbPath);
    expect(verify.prepare("SELECT value FROM preserved").get()).toEqual({ value: "keep" });
    expect(verify.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'tasks'").get()).toEqual({ n: 0 });
    verify.close();
  } finally {
    pragma.mockRestore();
    exec.mockRestore();
    close.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
