/**
 * Knowledge Graph: Entity Recognition + Linking
 *
 * Extracts named entities from facts, creates/updates them in the graph,
 * and links them to the originating memory_items.
 *
 * Entity types: person | project | contract | concept | tool | file
 * Relation types: owns | uses | depends_on | blocks | part_of | related_to | supersedes
 *
 * Zero external deps — uses heuristic extraction (no LLM calls).
 * Runs inside the existing extraction pipeline (storeExtractedFacts).
 */

import { getRawDb } from "../db";

// ── Types ──

export interface EntityMatch {
  name: string;
  type: string;
  aliases?: string[];
}

export interface RelationMatch {
  sourceName: string;
  targetName: string;
  relationType: string;
  confidence: number;
}

// ── Known Entity Seeds ──
// Bootstrap the graph with known entities. The extraction loop will discover new ones.

const KNOWN_ENTITIES: EntityMatch[] = [
  { name: "Gui", type: "person" },
  { name: "Daedalus", type: "person" },
  { name: "Arcane", type: "project", aliases: ["Arcane Rapture", "arcane-rapture"] },
  { name: "Mission Control", type: "project", aliases: ["MC", "mission-control"] },
  { name: "OpenClaw", type: "project", aliases: ["openclaw"] },
  { name: "ManaWell", type: "contract", aliases: ["ManaWell.sol", "Mana Well"] },
  { name: "BiomeOracle", type: "contract", aliases: ["BiomeOracle.sol", "Biome Oracle"] },
  { name: "NodeController", type: "contract", aliases: ["NodeController.sol", "Node Controller"] },
  { name: "ArcaneKernel", type: "contract", aliases: ["ArcaneKernel.sol", "Arcane Kernel"] },
  { name: "GuardianRecovery", type: "contract", aliases: ["GuardianRecovery.sol"] },
  { name: "ManaToken", type: "contract", aliases: ["ManaTokenV1.sol", "ManaTokenV1", "Mana Token"] },
  { name: "SoulBoundToken", type: "contract", aliases: ["SoulBoundToken.sol", "SBT"] },
  { name: "LocationClaimVerifier", type: "contract", aliases: ["LocationClaimVerifier.sol"] },
  { name: "DeviceBindingRegistry", type: "contract", aliases: ["DeviceBindingRegistry.sol"] },
  { name: "NodleLocationOracle", type: "contract", aliases: ["NodleLocationOracle.sol", "Nodle Oracle"] },
  { name: "Hardhat", type: "tool" },
  { name: "Solidity", type: "tool" },
  { name: "ClawVault", type: "tool", aliases: ["clawvault", "clawvault-local"] },
  { name: "Obsidian", type: "tool", aliases: ["obsidian-sync", "arcane-vault"] },
  { name: "memory-daemon", type: "tool", aliases: ["memory daemon", "memory-daemon.mjs"] },
];

// ── Relation Pattern Matching ──

const RELATION_PATTERNS: Array<{
  pattern: RegExp;
  relationType: string;
  confidence: number;
}> = [
  { pattern: /(.+?)\s+(?:uses?|using|utilizes?)\s+(.+)/i, relationType: "uses", confidence: 75 },
  { pattern: /(.+?)\s+(?:depends?\s+on|requires?)\s+(.+)/i, relationType: "depends_on", confidence: 80 },
  { pattern: /(.+?)\s+(?:blocks?|blocking)\s+(.+)/i, relationType: "blocks", confidence: 85 },
  { pattern: /(.+?)\s+(?:is\s+part\s+of|belongs?\s+to|inside)\s+(.+)/i, relationType: "part_of", confidence: 75 },
  { pattern: /(.+?)\s+(?:owns?|manages?|maintains?)\s+(.+)/i, relationType: "owns", confidence: 70 },
  { pattern: /(.+?)\s+(?:replaced?|supersedes?|replaces?|switched\s+from)\s+(.+)/i, relationType: "supersedes", confidence: 85 },
];

// ── Core Functions ──

/**
 * Find or create an entity by name. Returns entity ID.
 * Uses case-insensitive matching + alias lookup.
 */
export function findOrCreateEntity(name: string, type: string, aliases?: string[]): number {
  const raw = getRawDb();
  const nameLower = name.toLowerCase().trim();

  // Exact name match (case-insensitive)
  const existing = raw.prepare(
    "SELECT id, access_count FROM memory_entities WHERE LOWER(name) = ?"
  ).get(nameLower) as { id: number; access_count: number } | undefined;

  if (existing) {
    // Bump last_seen and access_count
    raw.prepare(
      "UPDATE memory_entities SET last_seen = datetime('now'), access_count = ? WHERE id = ?"
    ).run(existing.access_count + 1, existing.id);
    return existing.id;
  }

  // Alias match: check if any existing entity has this name as an alias
  const allEntities = raw.prepare(
    "SELECT id, aliases, access_count FROM memory_entities WHERE aliases IS NOT NULL"
  ).all() as Array<{ id: number; aliases: string; access_count: number }>;

  for (const ent of allEntities) {
    try {
      const entAliases = JSON.parse(ent.aliases) as string[];
      if (entAliases.some(a => a.toLowerCase() === nameLower)) {
        raw.prepare(
          "UPDATE memory_entities SET last_seen = datetime('now'), access_count = ? WHERE id = ?"
        ).run(ent.access_count + 1, ent.id);
        return ent.id;
      }
    } catch { /* invalid JSON, skip */ }
  }

  // Create new entity
  const aliasJson = aliases && aliases.length > 0 ? JSON.stringify(aliases) : null;
  const result = raw.prepare(
    "INSERT INTO memory_entities (name, type, aliases) VALUES (?, ?, ?)"
  ).run(name.trim(), type, aliasJson);

  return Number(result.lastInsertRowid);
}

/**
 * Create a relation between two entities (by ID). Idempotent — skips if already exists.
 */
export function createRelation(
  sourceEntityId: number,
  targetEntityId: number,
  relationType: string,
  confidence: number,
  sourceItemId?: number
): number | null {
  const raw = getRawDb();

  // Check for existing active relation of same type
  const existing = raw.prepare(
    `SELECT id FROM memory_relations
     WHERE source_entity_id = ? AND target_entity_id = ? AND relation_type = ? AND valid_to IS NULL`
  ).get(sourceEntityId, targetEntityId, relationType) as { id: number } | undefined;

  if (existing) return existing.id;

  const result = raw.prepare(
    `INSERT INTO memory_relations (source_entity_id, target_entity_id, relation_type, confidence, source_item_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sourceEntityId, targetEntityId, relationType, confidence, sourceItemId ?? null);

  return Number(result.lastInsertRowid);
}

/**
 * Link an entity to a memory item (fact).
 */
export function linkEntityToItem(entityId: number, itemId: number): void {
  const raw = getRawDb();

  const existing = raw.prepare(
    "SELECT id FROM memory_entity_items WHERE entity_id = ? AND item_id = ?"
  ).get(entityId, itemId);

  if (!existing) {
    raw.prepare(
      "INSERT INTO memory_entity_items (entity_id, item_id) VALUES (?, ?)"
    ).run(entityId, itemId);
  }
}

/**
 * Extract entities from a fact string using known entity matching + heuristic patterns.
 * Returns matched entities with their types.
 */
export function extractEntitiesFromFact(factText: string): EntityMatch[] {
  const matches: EntityMatch[] = [];
  const seen = new Set<string>();
  const factLower = factText.toLowerCase();

  // Match known entities (name + aliases)
  for (const known of KNOWN_ENTITIES) {
    const namesToCheck = [known.name, ...(known.aliases || [])];
    for (const n of namesToCheck) {
      if (factLower.includes(n.toLowerCase())) {
        if (!seen.has(known.name.toLowerCase())) {
          seen.add(known.name.toLowerCase());
          matches.push(known);
        }
        break;
      }
    }
  }

  // Heuristic: detect PascalCase words as potential contract/concept entities
  const pascalMatches = factText.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || [];
  for (const pm of pascalMatches) {
    if (!seen.has(pm.toLowerCase()) && pm.length > 4) {
      seen.add(pm.toLowerCase());
      // Guess type from suffix
      let type = "concept";
      if (pm.endsWith("Controller") || pm.endsWith("Registry") || pm.endsWith("Oracle") ||
          pm.endsWith("Token") || pm.endsWith("Verifier") || pm.endsWith("Well")) {
        type = "contract";
      }
      matches.push({ name: pm, type });
    }
  }

  // Heuristic: detect file paths as file entities
  const fileMatches = factText.match(/\b[\w/-]+\.(sol|ts|mjs|js|md|py|json)\b/g) || [];
  for (const fm of fileMatches) {
    const baseName = fm.split("/").pop() || fm;
    if (!seen.has(baseName.toLowerCase())) {
      seen.add(baseName.toLowerCase());
      matches.push({ name: baseName, type: "file" });
    }
  }

  return matches;
}

/**
 * Extract relations from a fact string using pattern matching.
 * Only matches relations between entities that were already extracted.
 */
export function extractRelationsFromFact(
  factText: string,
  entityNames: string[]
): RelationMatch[] {
  const relations: RelationMatch[] = [];
  if (entityNames.length < 2) return relations;

  for (const { pattern, relationType, confidence } of RELATION_PATTERNS) {
    const match = factText.match(pattern);
    if (!match) continue;

    const source = match[1].trim();
    const target = match[2].trim();

    // Both sides must match known entities from this fact
    const sourceEntity = entityNames.find(e =>
      source.toLowerCase().includes(e.toLowerCase()) ||
      e.toLowerCase().includes(source.toLowerCase())
    );
    const targetEntity = entityNames.find(e =>
      target.toLowerCase().includes(e.toLowerCase()) ||
      e.toLowerCase().includes(target.toLowerCase())
    );

    if (sourceEntity && targetEntity && sourceEntity !== targetEntity) {
      relations.push({
        sourceName: sourceEntity,
        targetName: targetEntity,
        relationType,
        confidence,
      });
    }
  }

  return relations;
}

/**
 * Process a stored fact: extract entities, create/link them, extract relations.
 * Call this after a fact is accepted by the gating pipeline.
 *
 * @param itemId - The memory_items.id of the accepted fact
 * @param factText - The fact text
 * @param category - The fact category (used to infer entity types)
 */
export function processFactEntities(itemId: number, factText: string, category?: string): {
  entities: number;
  relations: number;
} {
  // Extract entities
  const entityMatches = extractEntitiesFromFact(factText);
  const entityIds: Map<string, number> = new Map();

  for (const match of entityMatches) {
    const entityId = findOrCreateEntity(match.name, match.type, match.aliases);
    entityIds.set(match.name, entityId);
    linkEntityToItem(entityId, itemId);
  }

  // Extract relations
  const entityNames = Array.from(entityIds.keys());
  const relationMatches = extractRelationsFromFact(factText, entityNames);

  for (const rel of relationMatches) {
    const sourceId = entityIds.get(rel.sourceName);
    const targetId = entityIds.get(rel.targetName);
    if (sourceId && targetId) {
      createRelation(sourceId, targetId, rel.relationType, rel.confidence, itemId);
    }
  }

  return { entities: entityMatches.length, relations: relationMatches.length };
}

// ── Query Functions (for retrieval + boot injection) ──

/**
 * Get top-N most active entities (by access_count * recency).
 * Option B: capped at 10 entities for boot injection.
 */
export function getTopEntities(limit = 10): Array<{
  id: number;
  name: string;
  type: string;
  accessCount: number;
  lastSeen: string;
}> {
  const raw = getRawDb();
  return raw.prepare(`
    SELECT id, name, type, access_count, last_seen
    FROM memory_entities
    ORDER BY
      access_count * (1.0 / (1 + (julianday('now') - julianday(last_seen)))) DESC
    LIMIT ?
  `).all(limit) as any[];
}

/**
 * Get 1-hop relations for an entity (both directions), max 3 per entity.
 */
export function getEntityRelations(entityId: number, limit = 3): Array<{
  relatedEntityId: number;
  relatedEntityName: string;
  relatedEntityType: string;
  relationType: string;
  direction: "outgoing" | "incoming";
  confidence: number;
}> {
  const raw = getRawDb();

  const outgoing = raw.prepare(`
    SELECT
      me.id AS related_entity_id, me.name AS related_entity_name, me.type AS related_entity_type,
      mr.relation_type, mr.confidence
    FROM memory_relations mr
    JOIN memory_entities me ON me.id = mr.target_entity_id
    WHERE mr.source_entity_id = ? AND mr.valid_to IS NULL
    ORDER BY mr.confidence DESC
    LIMIT ?
  `).all(entityId, limit) as any[];

  const incoming = raw.prepare(`
    SELECT
      me.id AS related_entity_id, me.name AS related_entity_name, me.type AS related_entity_type,
      mr.relation_type, mr.confidence
    FROM memory_relations mr
    JOIN memory_entities me ON me.id = mr.source_entity_id
    WHERE mr.target_entity_id = ? AND mr.valid_to IS NULL
    ORDER BY mr.confidence DESC
    LIMIT ?
  `).all(entityId, limit) as any[];

  return [
    ...outgoing.map((r: any) => ({ ...r, direction: "outgoing" as const })),
    ...incoming.map((r: any) => ({ ...r, direction: "incoming" as const })),
  ];
}

/**
 * Expand a search query by finding related entity names (1-hop).
 * Returns additional search terms to include.
 */
export function expandQueryWithGraph(query: string): string[] {
  const raw = getRawDb();
  const queryLower = query.toLowerCase();
  const expansions: string[] = [];
  const seen = new Set<string>();

  // Find entities matching the query
  const matchingEntities = raw.prepare(`
    SELECT id, name FROM memory_entities
    WHERE LOWER(name) LIKE ? OR aliases LIKE ?
  `).all(`%${queryLower}%`, `%${queryLower}%`) as Array<{ id: number; name: string }>;

  for (const entity of matchingEntities) {
    // Get 1-hop related entities
    const related = getEntityRelations(entity.id, 3);
    for (const rel of related) {
      const relName = rel.relatedEntityName || (rel as any).related_entity_name;
      if (!seen.has(relName.toLowerCase()) && !queryLower.includes(relName.toLowerCase())) {
        seen.add(relName.toLowerCase());
        expansions.push(relName);
      }
    }
  }

  return expansions;
}

/**
 * Format top entities + relations for boot context injection (Option B).
 * Capped at ~800 tokens: 10 entities, 3 relations each.
 */
export function formatEntityContextBlock(): string {
  const topEntities = getTopEntities(10);
  if (topEntities.length === 0) return "";

  const lines: string[] = [];
  for (const entity of topEntities) {
    const relations = getEntityRelations(entity.id, 3);
    const relParts = relations.map(r => {
      const arrow = r.direction === "outgoing" ? "→" : "←";
      // SQLite raw queries return snake_case; typed interface has camelCase
      const raw = r as any;
      const relType = r.relationType || raw.relation_type;
      const relName = r.relatedEntityName || raw.related_entity_name;
      return `${arrow} ${relType} ${relName}`;
    });

    const relStr = relParts.length > 0 ? ` [${relParts.join(", ")}]` : "";
    lines.push(`- ${entity.name} (${entity.type})${relStr}`);
  }

  return `## Active Knowledge Graph (top ${topEntities.length} entities)\n${lines.join("\n")}`;
}

/**
 * Seed the graph with known entities on first run.
 */
export function seedKnownEntities(): number {
  let created = 0;
  for (const known of KNOWN_ENTITIES) {
    const raw = getRawDb();
    const existing = raw.prepare(
      "SELECT id FROM memory_entities WHERE LOWER(name) = ?"
    ).get(known.name.toLowerCase());

    if (!existing) {
      findOrCreateEntity(known.name, known.type, known.aliases);
      created++;
    }
  }
  return created;
}

/**
 * Get graph stats for dashboard/health checks.
 */
export function getGraphStats(): {
  entityCount: number;
  relationCount: number;
  activeRelations: number;
  topTypes: Array<{ type: string; count: number }>;
} {
  const raw = getRawDb();

  const entityCount = (raw.prepare(
    "SELECT COUNT(*) as count FROM memory_entities"
  ).get() as { count: number }).count;

  const relationCount = (raw.prepare(
    "SELECT COUNT(*) as count FROM memory_relations"
  ).get() as { count: number }).count;

  const activeRelations = (raw.prepare(
    "SELECT COUNT(*) as count FROM memory_relations WHERE valid_to IS NULL"
  ).get() as { count: number }).count;

  const topTypes = raw.prepare(
    "SELECT type, COUNT(*) as count FROM memory_entities GROUP BY type ORDER BY count DESC"
  ).all() as Array<{ type: string; count: number }>;

  return { entityCount, relationCount, activeRelations, topTypes };
}
