import fs from "fs";
import path from "path";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DailyLogEntry {
  filePath: string;
  date: string;       // YYYY-MM-DD extracted from filename
  title: string;      // first # heading, or the date
  content: string;    // full markdown content
  modifiedAt: string; // file mtime as ISO string
}

/* ------------------------------------------------------------------ */
/*  Parser                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse a single daily memory log file (e.g. `memory/2026-02-18.md`).
 *
 * Throws if the file does not exist.
 */
export function parseDailyLog(filePath: string): DailyLogEntry {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Daily log not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);
  const basename = path.basename(filePath, ".md");

  // Extract date from filename (YYYY-MM-DD)
  const dateMatch = basename.match(/^(\d{4}-\d{2}-\d{2})$/);
  const date = dateMatch ? dateMatch[1] : basename;

  // Extract first H1 heading as title, fallback to date
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const title = headingMatch ? headingMatch[1].trim() : date;

  return {
    filePath,
    date,
    title,
    content,
    modifiedAt: stat.mtime.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Listing                                                            */
/* ------------------------------------------------------------------ */

/**
 * List all daily log files in the given memory directory, sorted by
 * filename (ascending chronological order).
 *
 * Returns absolute file paths matching the `YYYY-MM-DD.md` pattern.
 */
export function listDailyLogs(memoryDir: string): string[] {
  if (!fs.existsSync(memoryDir)) {
    return [];
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

  return fs
    .readdirSync(memoryDir)
    .filter((f) => DATE_RE.test(f))
    .sort()
    .map((f) => path.join(memoryDir, f));
}
