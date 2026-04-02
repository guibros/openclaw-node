/**
 * Memory Extraction Pipeline (MEM-005)
 *
 * Extracts atomic facts from raw markdown content.
 * Designed to be called by Daedalus inline during session flush,
 * or by the API for dashboard-triggered extraction.
 *
 * The extraction itself is LLM-driven (Daedalus does it inline).
 * This module handles the DB writes and auditing.
 */

import { eq, and } from "drizzle-orm";
import { getDb, getRawDb } from "../db";
import { memoryItems, memoryAudit, memoryDocs } from "../db/schema";
import { processFactEntities, extractEntitiesFromFact } from "./entities";
import { traceCall } from "../tracer";

export interface ExtractedFact {
  factText: string;
  category: string; // work, preferences, people, projects, technical, relationships
  confidence: number; // 0-100
}

export interface GateResult {
  accepted: boolean;
  reason: string;
}

export interface GatedFact extends ExtractedFact {
  gate: GateResult;
}

/**
 * Token-level Jaccard similarity between two strings.
 * Used for contradiction detection and consolidation.
 */
function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check if a new fact contradicts or overlaps existing active facts.
 * If overlap > threshold, supersede the older fact (newer wins).
 * Returns IDs of superseded facts.
 */
function checkAndSupersede(newFactText: string, newItemId: number, category?: string): number[] {
  const raw = getRawDb();
  const superseded: number[] = [];

  // Extract entities from new fact for targeted search
  const newEntities = extractEntitiesFromFact(newFactText);
  const entityNames = newEntities.map(e => e.name.toLowerCase());

  // Get existing active facts in the same category
  let existingFacts: Array<{ id: number; fact_text: string }>;
  if (category) {
    existingFacts = raw.prepare(
      `SELECT id, fact_text FROM memory_items
       WHERE status = 'active' AND valid_to IS NULL AND category = ? AND id != ?
       ORDER BY created_at DESC LIMIT 100`
    ).all(category, newItemId) as any[];
  } else {
    existingFacts = raw.prepare(
      `SELECT id, fact_text FROM memory_items
       WHERE status = 'active' AND valid_to IS NULL AND id != ?
       ORDER BY created_at DESC LIMIT 100`
    ).all(newItemId) as any[];
  }

  for (const existing of existingFacts) {
    // Fast filter: must share at least one entity
    const existingEntities = extractEntitiesFromFact(existing.fact_text);
    const existingNames = existingEntities.map(e => e.name.toLowerCase());
    const sharedEntities = entityNames.filter(n => existingNames.includes(n));
    if (sharedEntities.length === 0) continue;

    // Jaccard similarity check
    const similarity = tokenJaccard(newFactText, existing.fact_text);
    if (similarity >= 0.6) {
      // High overlap with shared entities → supersede old fact
      raw.prepare(
        `UPDATE memory_items SET superseded_by = ?, valid_to = datetime('now') WHERE id = ?`
      ).run(newItemId, existing.id);

      // Audit the superseding
      const db = getDb();
      db.insert(memoryAudit)
        .values({
          operation: "supersede",
          itemId: existing.id,
          detail: JSON.stringify({
            supersededBy: newItemId,
            similarity: similarity.toFixed(2),
            sharedEntities,
          }),
        })
        .run();

      superseded.push(existing.id);
    }
  }

  return superseded;
}

/**
 * Store extracted + gated facts into the DB.
 * Called after Daedalus (or a sub-agent) has done the extraction + gating.
 *
 * @param facts - Array of gated facts (accepted + rejected — both stored for audit)
 * @param sourceDocId - ID of the memory_docs row this was extracted from (optional)
 * @param extractionSource - file path or session identifier
 * @returns Count of accepted facts written
 */
export function storeExtractedFacts(
  facts: GatedFact[],
  sourceDocId?: number,
  extractionSource?: string
): { accepted: number; rejected: number } {
  const _start = Date.now();
  const db = getDb();
  const now = new Date().toISOString();
  let accepted = 0;
  let rejected = 0;

  for (const fact of facts) {
    if (fact.gate.accepted) {
      // Insert accepted fact
      const result = db
        .insert(memoryItems)
        .values({
          factText: fact.factText,
          confidence: fact.confidence,
          sourceDocId: sourceDocId ?? null,
          category: fact.category,
          status: "active",
          gateDecision: "accepted",
          gateReason: fact.gate.reason,
          extractionSource: extractionSource ?? null,
          createdAt: now,
        })
        .run();

      const insertedId = Number(result.lastInsertRowid);

      // Entity extraction: identify entities in fact, link to graph
      let graphResult = { entities: 0, relations: 0 };
      try {
        graphResult = processFactEntities(insertedId, fact.factText, fact.category);
      } catch { /* graph extraction is non-blocking */ }

      // Temporal: check for contradictions / overlapping facts → supersede old ones
      let supersededIds: number[] = [];
      try {
        supersededIds = checkAndSupersede(fact.factText, insertedId, fact.category);
      } catch { /* temporal check is non-blocking */ }

      // Audit log
      db.insert(memoryAudit)
        .values({
          operation: "gate_accept",
          itemId: insertedId,
          detail: JSON.stringify({
            fact: fact.factText,
            category: fact.category,
            confidence: fact.confidence,
            reason: fact.gate.reason,
            graph: graphResult,
            superseded: supersededIds.length > 0 ? supersededIds : undefined,
          }),
        })
        .run();

      accepted++;
    } else {
      // Log rejected fact for audit (don't store in items)
      db.insert(memoryAudit)
        .values({
          operation: "gate_reject",
          detail: JSON.stringify({
            fact: fact.factText,
            category: fact.category,
            reason: fact.gate.reason,
            source: extractionSource,
          }),
        })
        .run();

      rejected++;
    }
  }

  // Log the extraction event
  db.insert(memoryAudit)
    .values({
      operation: "extract",
      detail: JSON.stringify({
        source: extractionSource,
        sourceDocId,
        totalFacts: facts.length,
        accepted,
        rejected,
      }),
    })
    .run();

  traceCall("memory/extract", "storeExtractedFacts", _start, `a:${accepted} r:${rejected}`);
  return { accepted, rejected };
}

/**
 * Get all active memory items, optionally filtered by category.
 */
export function getActiveItems(category?: string) {
  const _start = Date.now();
  const db = getDb();
  let result;
  if (category) {
    result = db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.status, "active"),
          eq(memoryItems.category, category)
        )
      )
      .all();
  } else {
    result = db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.status, "active"))
      .all();
  }
  traceCall("memory/extract", "getActiveItems", _start, `${result.length} items`);
  return result;
}

/**
 * Get items with their source document info.
 */
export function getItemsWithSource(limit = 50, offset = 0) {
  const raw = getRawDb();
  return raw
    .prepare(
      `SELECT
        mi.*,
        md.file_path AS source_file,
        md.title AS source_title,
        md.date AS source_date
      FROM memory_items mi
      LEFT JOIN memory_docs md ON md.id = mi.source_doc_id
      WHERE mi.status = 'active'
      ORDER BY mi.created_at DESC
      LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
}

/**
 * Search items using FTS5.
 */
export function searchItems(query: string, category?: string, limit = 20) {
  const _start = Date.now();
  const raw = getRawDb();
  const safeQuery = query.replace(/"/g, '""').replace(/[*(){}^]/g, '').trim();
  if (!safeQuery) return [];

  let result;
  if (category) {
    result = raw
      .prepare(
        `SELECT mi.*, rank
        FROM memory_items_fts
        JOIN memory_items mi ON mi.id = memory_items_fts.rowid
        WHERE memory_items_fts MATCH ? AND mi.category = ? AND mi.status = 'active'
        ORDER BY rank
        LIMIT ?`
      )
      .all(`"${safeQuery}"*`, category, limit);
  } else {
    result = raw
      .prepare(
        `SELECT mi.*, rank
        FROM memory_items_fts
        JOIN memory_items mi ON mi.id = memory_items_fts.rowid
        WHERE memory_items_fts MATCH ? AND mi.status = 'active'
        ORDER BY rank
        LIMIT ?`
      )
      .all(`"${safeQuery}"*`, limit);
  }
  traceCall("memory/extract", "searchItems", _start, `${result.length} results`);
  return result;
}

/**
 * Mark item as accessed (updates last_accessed for decay tracking).
 */
export function touchItem(itemId: number) {
  const db = getDb();
  db.update(memoryItems)
    .set({ lastAccessed: new Date().toISOString() })
    .where(eq(memoryItems.id, itemId))
    .run();
}

/**
 * Archive an item (soft delete).
 */
export function archiveItem(itemId: number, reason?: string) {
  const db = getDb();
  db.update(memoryItems)
    .set({ status: "archived" })
    .where(eq(memoryItems.id, itemId))
    .run();

  db.insert(memoryAudit)
    .values({
      operation: "archive",
      itemId,
      detail: reason ?? "manual archive",
    })
    .run();
}

/**
 * Get extraction stats for the dashboard.
 */
export function getExtractionStats() {
  const raw = getRawDb();

  const totalActive = raw
    .prepare("SELECT COUNT(*) as count FROM memory_items WHERE status = 'active'")
    .get() as { count: number };

  const totalArchived = raw
    .prepare("SELECT COUNT(*) as count FROM memory_items WHERE status = 'archived'")
    .get() as { count: number };

  const byCategory = raw
    .prepare(
      "SELECT category, COUNT(*) as count FROM memory_items WHERE status = 'active' GROUP BY category ORDER BY count DESC"
    )
    .all();

  const recentAudit = raw
    .prepare(
      "SELECT * FROM memory_audit ORDER BY timestamp DESC LIMIT 20"
    )
    .all();

  return {
    active: totalActive.count,
    archived: totalArchived.count,
    byCategory,
    recentAudit,
  };
}

/**
 * Get the source doc ID for a given file path.
 * Useful when Daedalus extracts from a daily log and needs the doc reference.
 */
export function getDocIdByPath(filePath: string): number | null {
  const db = getDb();
  const doc = db
    .select({ id: memoryDocs.id })
    .from(memoryDocs)
    .where(eq(memoryDocs.filePath, filePath))
    .get();
  return doc?.id ?? null;
}
