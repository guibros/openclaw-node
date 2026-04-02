/**
 * Memory Categories (MEM-007)
 *
 * Auto-generates summary files per category from active items.
 * Categories: work, preferences, people, projects, technical, relationships
 *
 * Category summaries live at memory/categories/{category}.md
 * They are auto-generated — Daedalus regenerates them during session flush.
 * MEMORY.md becomes a meta-index pointing to these summaries.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { getActiveItems } from "./extract";
import { traceCall } from "../tracer";

const WORKSPACE = process.env.WORKSPACE_ROOT || path.join(os.homedir(), ".openclaw", "workspace");
const CATEGORIES_DIR = path.join(WORKSPACE, "memory", "categories");

export const VALID_CATEGORIES = [
  "work",
  "preferences",
  "people",
  "projects",
  "technical",
  "relationships",
] as const;

export type Category = (typeof VALID_CATEGORIES)[number];

/**
 * Ensure the categories directory exists.
 */
function ensureCategoriesDir() {
  if (!fs.existsSync(CATEGORIES_DIR)) {
    fs.mkdirSync(CATEGORIES_DIR, { recursive: true });
  }
}

/**
 * Get the file path for a category summary.
 */
export function getCategoryPath(category: string): string {
  return path.join(CATEGORIES_DIR, `${category}.md`);
}

/**
 * Read a category summary file. Returns null if not found.
 */
export function readCategorySummary(category: string): string | null {
  const filePath = getCategoryPath(category);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Write a category summary file.
 * This is called by Daedalus after generating the summary inline.
 */
export function writeCategorySummary(category: string, content: string) {
  const _start = Date.now();
  ensureCategoriesDir();
  const filePath = getCategoryPath(category);

  // Archive previous version with timestamp
  if (fs.existsSync(filePath)) {
    const archiveDir = path.join(CATEGORIES_DIR, ".archive");
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(filePath, path.join(archiveDir, `${category}_${ts}.md`));
  }

  fs.writeFileSync(filePath, content, "utf-8");
  traceCall("memory/categories", "writeCategorySummary", _start, category);
}

/**
 * Get all items for a category, formatted as a bullet list.
 * Used by Daedalus to regenerate a category summary.
 */
export function getCategoryItemsFormatted(category: string): string {
  const items = getActiveItems(category);
  if (items.length === 0) return `No items in category "${category}".`;

  const lines = items.map(
    (item) =>
      `- ${item.factText} [confidence: ${(item.confidence ?? 70) / 100}, age: ${daysOld(item.createdAt)}d]`
  );
  return lines.join("\n");
}

/**
 * Get a status overview of all categories.
 */
export function getCategoryOverview(): Array<{
  category: string;
  itemCount: number;
  hasSummary: boolean;
  summaryAge: number | null;
}> {
  const _start = Date.now();
  ensureCategoriesDir();
  const result = VALID_CATEGORIES.map((cat) => {
    const items = getActiveItems(cat);
    const filePath = getCategoryPath(cat);
    const hasSummary = fs.existsSync(filePath);
    let summaryAge: number | null = null;
    if (hasSummary) {
      const stat = fs.statSync(filePath);
      summaryAge = Math.round(
        (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)
      );
    }
    return {
      category: cat,
      itemCount: items.length,
      hasSummary,
      summaryAge,
    };
  });
  traceCall("memory/categories", "getCategoryOverview", _start, `${result.length} categories`);
  return result;
}

function daysOld(dateStr: string): number {
  return Math.round(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}
