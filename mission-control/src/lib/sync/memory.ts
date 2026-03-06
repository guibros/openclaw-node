import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { memoryDocs } from "@/lib/db/schema";
import { MEMORY_DIR, MEMORY_MD, CLAWVAULT_INDEX, LORE_DIRS } from "@/lib/config";
import { parseDailyLog, listDailyLogs } from "@/lib/parsers/daily-log";
import { parseVaultDocument, listVaultDocuments } from "@/lib/parsers/clawvault-doc";
import { parseMemoryMd } from "@/lib/parsers/memory-md";

type DrizzleDb = ReturnType<typeof import("@/lib/db")["getDb"]>;

interface SyncStats {
  indexed: number;
  updated: number;
  removed: number;
}

/**
 * Indexes all memory sources (daily logs, MEMORY.md, ClawVault docs)
 * into the memory_docs table. Compares file mtime to skip unchanged files.
 * Removes rows for files that no longer exist on disk.
 */
export function indexAllMemory(db: DrizzleDb): SyncStats {
  const stats: SyncStats = { indexed: 0, updated: 0, removed: 0 };
  const seenPaths = new Set<string>();

  // --- Daily Logs ---
  try {
    const logFiles = listDailyLogs(MEMORY_DIR);
    for (const filePath of logFiles) {
      seenPaths.add(filePath);
      if (skipIfUnchanged(db, filePath)) continue;

      const entry = parseDailyLog(filePath);
      const isUpdate = upsertDoc(db, {
        source: "daily_log",
        category: null,
        filePath: entry.filePath,
        title: entry.title,
        date: entry.date,
        frontmatter: null,
        content: entry.content,
        modifiedAt: entry.modifiedAt,
      });
      isUpdate ? stats.updated++ : stats.indexed++;
    }
  } catch {
    // daily logs directory may not exist yet
  }

  // --- MEMORY.md ---
  try {
    if (fs.existsSync(MEMORY_MD)) {
      seenPaths.add(MEMORY_MD);
      if (!skipIfUnchanged(db, MEMORY_MD)) {
        const mem = parseMemoryMd(MEMORY_MD);
        const isUpdate = upsertDoc(db, {
          source: "long_term_memory",
          category: null,
          filePath: mem.filePath,
          title: mem.title,
          date: null,
          frontmatter: null,
          content: mem.fullContent,
          modifiedAt: mem.modifiedAt,
        });
        isUpdate ? stats.updated++ : stats.indexed++;
      }
    }
  } catch {
    // MEMORY.md may not exist
  }

  // --- ClawVault Documents ---
  try {
    if (fs.existsSync(CLAWVAULT_INDEX)) {
      const entries = listVaultDocuments(CLAWVAULT_INDEX);
      for (const entry of entries) {
        seenPaths.add(entry.path);
        if (skipIfUnchanged(db, entry.path)) continue;

        const doc = parseVaultDocument(entry.path);
        const isUpdate = upsertDoc(db, {
          source: "clawvault",
          category: doc.category || entry.category,
          filePath: doc.filePath,
          title: doc.title,
          date: doc.date || null,
          frontmatter: doc.frontmatter ? JSON.stringify(doc.frontmatter) : null,
          content: doc.content,
          modifiedAt: doc.modifiedAt,
        });
        isUpdate ? stats.updated++ : stats.indexed++;
      }
    }
  } catch {
    // ClawVault index may not exist
  }

  // --- Lore Knowledge Base ---
  for (const loreDir of LORE_DIRS) {
    try {
      if (!fs.existsSync(loreDir)) continue;
      const files = fs.readdirSync(loreDir).filter((f) => f.endsWith(".md"));

      for (const filename of files) {
        const filePath = path.join(loreDir, filename);
        seenPaths.add(filePath);
        if (skipIfUnchanged(db, filePath)) continue;

        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, "utf-8");

        // Extract title from first H1 or filename
        const h1Match = content.match(/^#\s+(.+)/m);
        const title = h1Match ? h1Match[1].trim() : filename.replace(/\.md$/, "");

        // Derive category from parent dir name
        const dirName = path.basename(loreDir); // "research", "canon", "drafts"

        const isUpdate = upsertDoc(db, {
          source: "lore",
          category: dirName,
          filePath,
          title,
          date: null,
          frontmatter: null,
          content,
          modifiedAt: stat.mtime.toISOString(),
        });
        isUpdate ? stats.updated++ : stats.indexed++;
      }
    } catch {
      // lore directory may not exist
    }
  }

  // --- Remove rows for deleted files ---
  const allDocs = db
    .select({ id: memoryDocs.id, filePath: memoryDocs.filePath })
    .from(memoryDocs)
    .all();

  for (const row of allDocs) {
    if (!seenPaths.has(row.filePath)) {
      db.delete(memoryDocs).where(eq(memoryDocs.id, row.id)).run();
      stats.removed++;
    }
  }

  return stats;
}

/**
 * Returns true if the file's mtime matches what's already indexed,
 * meaning we can skip re-indexing.
 */
function skipIfUnchanged(db: DrizzleDb, filePath: string): boolean {
  if (!fs.existsSync(filePath)) return true;

  const stat = fs.statSync(filePath);
  const fileMtime = stat.mtime.toISOString();

  const existing = db
    .select({ modifiedAt: memoryDocs.modifiedAt })
    .from(memoryDocs)
    .where(eq(memoryDocs.filePath, filePath))
    .get();

  return existing?.modifiedAt === fileMtime;
}

interface DocInsert {
  source: string;
  category: string | null;
  filePath: string;
  title: string | null;
  date: string | null;
  frontmatter: string | null;
  content: string;
  modifiedAt: string | null;
}

/**
 * Upserts a memory doc row. Returns true if it was an update (row existed).
 */
function upsertDoc(db: DrizzleDb, doc: DocInsert): boolean {
  const existing = db
    .select({ id: memoryDocs.id })
    .from(memoryDocs)
    .where(eq(memoryDocs.filePath, doc.filePath))
    .get();

  const now = new Date().toISOString();

  db.insert(memoryDocs)
    .values({
      source: doc.source,
      category: doc.category,
      filePath: doc.filePath,
      title: doc.title,
      date: doc.date,
      frontmatter: doc.frontmatter,
      content: doc.content,
      modifiedAt: doc.modifiedAt,
      indexedAt: now,
    })
    .onConflictDoUpdate({
      target: memoryDocs.filePath,
      set: {
        source: doc.source,
        category: doc.category,
        title: doc.title,
        date: doc.date,
        frontmatter: doc.frontmatter,
        content: doc.content,
        modifiedAt: doc.modifiedAt,
        indexedAt: now,
      },
    })
    .run();

  return !!existing;
}
