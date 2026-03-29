/**
 * mesh-kv.ts — Sync engine for distributed Mission Control (Phase 2).
 *
 * Bridges NATS KV (mesh truth) ↔ local SQLite (MC database).
 *
 * Responsibilities:
 *   - Watch MESH_TASKS KV bucket for real-time updates
 *   - Mirror KV entries into local SQLite (upsert with revision tracking)
 *   - Push local task changes to KV via CAS writes
 *   - Handle conflict resolution (KV wins on workers, SQLite wins on lead)
 *
 * This module is imported by the sync/tasks.ts module and the hooks layer.
 * It does NOT run as a standalone daemon — it's part of the MC process.
 */

import { getTasksKv, sc } from "@/lib/nats";
import { NODE_ID, NODE_ROLE } from "@/lib/config";

// ── Types ──

export interface MeshTaskEntry {
  task_id: string;
  title: string;
  description: string;
  status: string;
  origin: string;
  owner: string | null;
  priority: number;
  budget_minutes: number;
  metric: string | null;
  success_criteria: string[];
  scope: string[];
  tags: string[];
  preferred_nodes: string[];
  exclude_nodes: string[];
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity: string | null;
  result: Record<string, unknown> | null;
  attempts: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// ── KV Read Operations ──

/**
 * List all tasks from MESH_TASKS KV bucket.
 * Returns empty array if NATS is unavailable.
 */
export async function listMeshTasks(): Promise<MeshTaskEntry[]> {
  const kv = await getTasksKv();
  if (!kv) return [];

  const tasks: MeshTaskEntry[] = [];
  const keys = await kv.keys();

  for await (const key of keys) {
    const entry = await kv.get(key);
    if (!entry?.value) continue;
    try {
      tasks.push(JSON.parse(sc.decode(entry.value)));
    } catch {
      // skip malformed
    }
  }

  return tasks;
}

/**
 * Get a single task from KV with its revision.
 */
export async function getMeshTask(
  taskId: string
): Promise<{ task: MeshTaskEntry; revision: number } | null> {
  const kv = await getTasksKv();
  if (!kv) return null;

  const entry = await kv.get(taskId);
  if (!entry?.value) return null;

  return {
    task: JSON.parse(sc.decode(entry.value)),
    revision: entry.revision,
  };
}

// ── KV Write Operations (CAS) ──

/**
 * Write a task to KV. Used by the lead to publish task state.
 * No CAS — overwrites unconditionally. Use updateMeshTaskCAS for safe updates.
 */
export async function putMeshTask(task: MeshTaskEntry): Promise<number> {
  const kv = await getTasksKv();
  if (!kv) throw new Error("NATS KV unavailable");

  const rev = await kv.put(task.task_id, sc.encode(JSON.stringify(task)));
  return rev;
}

/**
 * Update a task with CAS (Compare-And-Swap).
 * Fails if the revision doesn't match (another node wrote since our read).
 *
 * @returns New revision number on success
 * @throws On revision mismatch (caller should re-read and retry)
 */
export async function updateMeshTaskCAS(
  taskId: string,
  updates: Partial<MeshTaskEntry>,
  expectedRevision: number
): Promise<number> {
  const kv = await getTasksKv();
  if (!kv) throw new Error("NATS KV unavailable");

  // Read current
  const entry = await kv.get(taskId);
  if (!entry?.value) throw new Error(`Task ${taskId} not found in KV`);

  const current = JSON.parse(sc.decode(entry.value));

  // Authority check
  if (NODE_ROLE !== "lead" && current.origin !== NODE_ID) {
    throw new Error(
      `Authority denied: worker ${NODE_ID} cannot update task from ${current.origin}`
    );
  }

  // Merge and write
  const updated = { ...current, ...updates };
  const rev = await kv.update(
    taskId,
    sc.encode(JSON.stringify(updated)),
    expectedRevision
  );
  return rev;
}

/**
 * Propose a new task from a worker node.
 * Task is created with status "proposed" — the lead daemon validates.
 */
export async function proposeMeshTask(
  task: Omit<MeshTaskEntry, "status" | "origin">
): Promise<MeshTaskEntry> {
  const kv = await getTasksKv();
  if (!kv) throw new Error("NATS KV unavailable");

  const proposed: MeshTaskEntry = {
    ...task,
    status: NODE_ROLE === "lead" ? "queued" : "proposed",
    origin: NODE_ID,
  } as MeshTaskEntry;

  await kv.put(proposed.task_id, sc.encode(JSON.stringify(proposed)));
  return proposed;
}

// ── KV Watcher ──

export interface KvWatchEvent {
  key: string;
  operation: "PUT" | "DEL";
  task: MeshTaskEntry | null;
  revision: number;
}

/**
 * Start watching the MESH_TASKS KV bucket.
 * Returns an async iterator of KvWatchEvent and a stop() function.
 *
 * Call stop() on cleanup to prevent zombie watchers leaking NATS connections.
 */
export async function watchMeshTasks(): Promise<{
  events: AsyncIterable<KvWatchEvent>;
  stop: () => void;
} | null> {
  const kv = await getTasksKv();
  if (!kv) return null;

  const watcher = await kv.watch();

  const events: AsyncIterable<KvWatchEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const result = await (
            watcher as AsyncIterable<any>
          )[Symbol.asyncIterator]().next();
          if (result.done) return { value: undefined, done: true };

          const entry = result.value;
          let task: MeshTaskEntry | null = null;
          if (entry.value) {
            try {
              task = JSON.parse(sc.decode(entry.value));
            } catch {
              // malformed
            }
          }

          return {
            value: {
              key: entry.key,
              operation: entry.value ? "PUT" : ("DEL" as const),
              task,
              revision: entry.revision,
            },
            done: false,
          };
        },
      };
    },
  };

  return {
    events,
    stop: () => {
      if (typeof (watcher as any).stop === "function") {
        (watcher as any).stop();
      }
    },
  };
}

// ── Merge Logic (for UI layer) ──

export interface MergedTask {
  id: string;
  title: string;
  source: "sqlite" | "kv" | "merged";
  [key: string]: unknown;
}

/**
 * Merge local SQLite tasks with KV mesh tasks.
 * Deduplicates by task ID.
 *
 * On lead: SQLite wins (has richer fields like kanbanColumn, sortOrder)
 * On worker: KV wins (more up-to-date for mesh-coordinated tasks)
 */
export function mergeTasks(
  sqliteTasks: Array<{ id: string; [key: string]: unknown }>,
  kvTasks: Array<{ task_id: string; [key: string]: unknown }>,
  nodeRole: "lead" | "worker" = NODE_ROLE
): MergedTask[] {
  const merged = new Map<string, MergedTask>();

  // SQLite tasks first
  for (const t of sqliteTasks) {
    merged.set(t.id, { ...t, id: t.id, title: String(t.title || ""), source: "sqlite" });
  }

  // KV tasks: on worker, KV wins for mesh tasks; on lead, SQLite wins
  for (const t of kvTasks) {
    const existing = merged.get(t.task_id);
    if (!existing) {
      merged.set(t.task_id, {
        ...t,
        id: t.task_id,
        title: String(t.title || ""),
        source: "kv",
      });
    } else if (nodeRole === "worker") {
      merged.set(t.task_id, {
        ...t,
        id: t.task_id,
        title: String(t.title || ""),
        source: "kv",
      });
    }
    // Lead: SQLite wins (don't overwrite)
  }

  return Array.from(merged.values());
}
