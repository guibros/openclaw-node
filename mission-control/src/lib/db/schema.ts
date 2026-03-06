import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  kanbanColumn: text("kanban_column").notNull(),
  owner: text("owner"),
  soulId: text("soul_id"), // NEW: which soul owns this task
  handoffSource: text("handoff_source"), // NEW: previous owner (for handoffs)
  handoffReason: text("handoff_reason"), // NEW: why handed off
  successCriteria: text("success_criteria"),
  artifacts: text("artifacts"),
  nextAction: text("next_action"),
  scheduledDate: text("scheduled_date"), // ISO date for calendar: "2026-02-21"
  project: text("project"), // Freeform project tag: "arcane", "budgetapp", etc.
  type: text("type").default("task"), // "project" | "pipeline" | "phase" | "task"
  parentId: text("parent_id"), // FK to tasks.id (self-reference for hierarchy)
  startDate: text("start_date"), // ISO date: "2026-03-01" (range start)
  endDate: text("end_date"), // ISO date: "2026-04-15" (range end)
  color: text("color"), // hex color for Gantt bars
  description: text("description"), // markdown body for projects/phases
  needsApproval: integer("needs_approval").default(1), // 0=Daedalus can start, 1=wait for Gui
  triggerKind: text("trigger_kind").default("none"), // "none" | "at" | "cron"
  triggerAt: text("trigger_at"), // ISO datetime for one-shot trigger
  triggerCron: text("trigger_cron"), // cron expression (e.g. "0 10 * * 1")
  triggerTz: text("trigger_tz").default("America/Montreal"), // timezone for cron eval
  isRecurring: integer("is_recurring").default(0), // 1=auto-recreate after done
  capacityClass: text("capacity_class").default("normal"), // "light" | "normal" | "heavy"
  autoPriority: integer("auto_priority").default(0), // higher = dispatched first
  showInCalendar: integer("show_in_calendar").default(0), // 1=show meta-task in calendar view
  acknowledgedAt: text("acknowledged_at"), // ISO datetime — when Daedalus acknowledged auto-dispatch
  updatedAt: text("updated_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  sortOrder: integer("sort_order").default(0),
});

export const memoryDocs = sqliteTable("memory_docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  category: text("category"),
  filePath: text("file_path").notNull().unique(),
  title: text("title"),
  date: text("date"),
  frontmatter: text("frontmatter"),
  content: text("content").notNull(),
  modifiedAt: text("modified_at"),
  indexedAt: text("indexed_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(),
  taskId: text("task_id"),
  description: text("description").notNull(),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const soulHandoffs = sqliteTable("soul_handoffs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id").notNull(),
  fromSoul: text("from_soul").notNull(),
  toSoul: text("to_soul").notNull(),
  reason: text("reason"),
  contextPath: text("context_path"), // Path to handoff document in ClawVault
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const soulEvolutionLog = sqliteTable("soul_evolution_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  soulId: text("soul_id").notNull(),
  eventId: text("event_id").notNull().unique(), // References evolution/events.jsonl
  eventType: text("event_type").notNull(), // learning, correction, feature_request
  description: text("description").notNull(),
  reviewStatus: text("review_status").notNull().default("pending"), // pending, approved, rejected
  commitHash: text("commit_hash"), // Git commit after approval
  reviewedBy: text("reviewed_by"), // Soul ID of reviewer
  reviewedAt: text("reviewed_at"),
  sourceSoulId: text("source_soul_id"), // Cross-soul: which soul originated this gene
  sourceEventId: text("source_event_id"), // Cross-soul: original event ID
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const dependencies = sqliteTable("dependencies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: text("source_id").notNull(), // task that must complete first
  targetId: text("target_id").notNull(), // task that is blocked
  type: text("type").notNull().default("finish_to_start"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Dependency = typeof dependencies.$inferSelect;
export type NewDependency = typeof dependencies.$inferInsert;
export type MemoryDoc = typeof memoryDocs.$inferSelect;
export type NewMemoryDoc = typeof memoryDocs.$inferInsert;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type SoulHandoff = typeof soulHandoffs.$inferSelect;
export type NewSoulHandoff = typeof soulHandoffs.$inferInsert;
export const soulSpawns = sqliteTable("soul_spawns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  soulId: text("soul_id").notNull(),
  taskId: text("task_id"), // Optional — linked task if spawned for a specific task
  subagentType: text("subagent_type").notNull(), // general-purpose, Explore, etc.
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// --- Memory Items (extracted atomic facts) ---

export const memoryItems = sqliteTable("memory_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  factText: text("fact_text").notNull(),
  confidence: integer("confidence").default(70), // 0-100 (stored as int, display as 0.XX)
  sourceDocId: integer("source_doc_id"), // FK to memory_docs.id
  category: text("category"), // work, preferences, people, projects, technical, relationships
  status: text("status").default("active"), // active | archived | stale
  gateDecision: text("gate_decision"), // accepted | rejected
  gateReason: text("gate_reason"), // why accepted/rejected
  extractionSource: text("extraction_source"), // file path or session ID
  lastAccessed: text("last_accessed"),
  supersededBy: integer("superseded_by"), // FK to memory_items.id (temporal chain)
  validFrom: text("valid_from")
    .notNull()
    .default(sql`(datetime('now'))`),
  validTo: text("valid_to"), // null = still valid; set when superseded
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const memoryAudit = sqliteTable("memory_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operation: text("operation").notNull(), // extract, gate_accept, gate_reject, merge, archive, search
  itemId: integer("item_id"),
  detail: text("detail"), // JSON or descriptive text
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type MemoryItem = typeof memoryItems.$inferSelect;
export type NewMemoryItem = typeof memoryItems.$inferInsert;
export type MemoryAuditEntry = typeof memoryAudit.$inferSelect;

// --- Knowledge Graph: Entities + Relations ---

export const memoryEntities = sqliteTable("memory_entities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // canonical name: "ManaWell", "Gui", "Arcane"
  type: text("type").notNull(), // person | project | contract | concept | tool | file
  aliases: text("aliases"), // JSON array of alternate names: ["mana well", "ManaWell.sol"]
  firstSeen: text("first_seen")
    .notNull()
    .default(sql`(datetime('now'))`),
  lastSeen: text("last_seen")
    .notNull()
    .default(sql`(datetime('now'))`),
  accessCount: integer("access_count").default(1),
  metadata: text("metadata"), // JSON: extra type-specific data
});

export const memoryRelations = sqliteTable("memory_relations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceEntityId: integer("source_entity_id").notNull(), // FK to memory_entities.id
  targetEntityId: integer("target_entity_id").notNull(), // FK to memory_entities.id
  relationType: text("relation_type").notNull(), // owns | uses | depends_on | blocks | part_of | related_to | supersedes
  confidence: integer("confidence").default(80), // 0-100
  sourceItemId: integer("source_item_id"), // FK to memory_items.id (which fact established this relation)
  validFrom: text("valid_from")
    .notNull()
    .default(sql`(datetime('now'))`),
  validTo: text("valid_to"), // null = still valid
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// --- Entity-Item junction (which entities appear in which facts) ---

export const memoryEntityItems = sqliteTable("memory_entity_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityId: integer("entity_id").notNull(), // FK to memory_entities.id
  itemId: integer("item_id").notNull(), // FK to memory_items.id
});

export type MemoryEntity = typeof memoryEntities.$inferSelect;
export type NewMemoryEntity = typeof memoryEntities.$inferInsert;
export type MemoryRelation = typeof memoryRelations.$inferSelect;
export type NewMemoryRelation = typeof memoryRelations.$inferInsert;
export type MemoryEntityItem = typeof memoryEntityItems.$inferSelect;

export type SoulEvolution = typeof soulEvolutionLog.$inferSelect;
export type NewSoulEvolution = typeof soulEvolutionLog.$inferInsert;
export type SoulSpawn = typeof soulSpawns.$inferSelect;
export type NewSoulSpawn = typeof soulSpawns.$inferInsert;
