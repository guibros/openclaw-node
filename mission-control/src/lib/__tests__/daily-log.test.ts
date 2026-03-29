import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { parseDailyLog, listDailyLogs } from "../parsers/daily-log";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-log-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseDailyLog", () => {
  it("parses a daily log with H1 heading", () => {
    const filePath = path.join(tmpDir, "2026-03-15.md");
    fs.writeFileSync(filePath, "# Session Notes\n\n- Did stuff\n- More stuff\n");
    const entry = parseDailyLog(filePath);

    expect(entry.date).toBe("2026-03-15");
    expect(entry.title).toBe("Session Notes");
    expect(entry.content).toContain("- Did stuff");
    expect(entry.filePath).toBe(filePath);
    expect(entry.modifiedAt).toBeDefined();
  });

  it("extracts date from filename", () => {
    const filePath = path.join(tmpDir, "2026-01-01.md");
    fs.writeFileSync(filePath, "content\n");
    const entry = parseDailyLog(filePath);
    expect(entry.date).toBe("2026-01-01");
  });

  it("falls back to date when no H1 heading", () => {
    const filePath = path.join(tmpDir, "2026-02-28.md");
    fs.writeFileSync(filePath, "No heading here\n");
    const entry = parseDailyLog(filePath);
    expect(entry.title).toBe("2026-02-28");
  });

  it("uses basename for non-date filenames", () => {
    const filePath = path.join(tmpDir, "notes.md");
    fs.writeFileSync(filePath, "content\n");
    const entry = parseDailyLog(filePath);
    expect(entry.date).toBe("notes");
  });

  it("throws for missing file", () => {
    expect(() => parseDailyLog("/nonexistent/file.md")).toThrow("not found");
  });
});

describe("listDailyLogs", () => {
  it("lists YYYY-MM-DD.md files sorted chronologically", () => {
    fs.writeFileSync(path.join(tmpDir, "2026-03-15.md"), "");
    fs.writeFileSync(path.join(tmpDir, "2026-03-10.md"), "");
    fs.writeFileSync(path.join(tmpDir, "2026-03-20.md"), "");
    const logs = listDailyLogs(tmpDir);
    expect(logs).toHaveLength(3);
    expect(logs[0]).toContain("2026-03-10.md");
    expect(logs[2]).toContain("2026-03-20.md");
  });

  it("excludes non-date files", () => {
    fs.writeFileSync(path.join(tmpDir, "2026-03-15.md"), "");
    fs.writeFileSync(path.join(tmpDir, "notes.md"), "");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "");
    const logs = listDailyLogs(tmpDir);
    expect(logs).toHaveLength(1);
  });

  it("returns empty for nonexistent directory", () => {
    expect(listDailyLogs("/nonexistent/dir")).toEqual([]);
  });

  it("returns empty for empty directory", () => {
    expect(listDailyLogs(tmpDir)).toEqual([]);
  });
});
