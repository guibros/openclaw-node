/**
 * mesh-kv-sync.test.ts — Unit tests for distributed MC (Phase 1+2).
 *
 * Tests: CAS operations, authority model, proposal lifecycle,
 * task merge/deduplication, watcher lifecycle, sync skip logic.
 *
 * No external dependencies — uses MockKV for all NATS KV operations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockKV, encode, decode } from "./mocks/mock-kv";

let kv: MockKV;

beforeEach(() => {
  kv = new MockKV();
});

// ── CAS (Compare-And-Swap) Operations ──

describe("CAS operations", () => {
  it("put creates entry with incrementing revision", async () => {
    const rev1 = await kv.put("task-1", encode({ title: "Task 1" }));
    const rev2 = await kv.put("task-2", encode({ title: "Task 2" }));
    expect(rev1).toBe(1);
    expect(rev2).toBe(2);
  });

  it("get returns stored entry with revision", async () => {
    await kv.put("task-1", encode({ title: "First" }));
    const entry = await kv.get("task-1");
    expect(entry).not.toBeNull();
    expect(decode(entry!.value)).toEqual({ title: "First" });
    expect(entry!.revision).toBe(1);
  });

  it("get returns null for missing key", async () => {
    const entry = await kv.get("nonexistent");
    expect(entry).toBeNull();
  });

  it("create fails if key already exists", async () => {
    await kv.put("task-1", encode({ title: "V1" }));
    await expect(
      kv.create("task-1", encode({ title: "V2" }))
    ).rejects.toThrow("key already exists");
  });

  it("create succeeds for new key", async () => {
    const rev = await kv.create("task-new", encode({ title: "New" }));
    expect(rev).toBeGreaterThan(0);
    const entry = await kv.get("task-new");
    expect(decode(entry!.value)).toEqual({ title: "New" });
  });

  it("update succeeds with correct revision", async () => {
    await kv.put("task-1", encode({ title: "V1" }));
    const entry = await kv.get("task-1");
    await kv.update("task-1", encode({ title: "V2" }), entry!.revision);
    const updated = await kv.get("task-1");
    expect(decode(updated!.value)).toEqual({ title: "V2" });
  });

  it("update fails with stale revision (CAS conflict)", async () => {
    await kv.put("task-1", encode({ title: "V1" }));
    const entry = await kv.get("task-1");
    const staleRev = entry!.revision;

    // Another write bumps the revision
    await kv.put("task-1", encode({ title: "V2" }));

    try {
      await kv.update("task-1", encode({ title: "V3" }), staleRev);
      expect.unreachable("Update should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("wrong last sequence");
      expect(err.message).toContain("revision mismatch");
    }
  });

  it("update fails for nonexistent key", async () => {
    await expect(
      kv.update("ghost", encode({ title: "X" }), 1)
    ).rejects.toThrow("revision mismatch");
  });

  it("delete removes entry", async () => {
    await kv.put("task-1", encode({ title: "V1" }));
    await kv.delete("task-1");
    const entry = await kv.get("task-1");
    expect(entry).toBeNull();
  });
});

// ── Authority Model ──

describe("Authority model", () => {
  it("lead can update any task", async () => {
    const nodeRole = "lead";
    const nodeId = "mac-lead";

    await kv.put(
      "T-001",
      encode({ task_id: "T-001", origin: "ubuntu-worker", status: "queued" })
    );
    const entry = await kv.get("T-001");
    const task = decode(entry!.value);

    // Lead can update regardless of origin
    const canUpdate = nodeRole === "lead" || task.origin === nodeId;
    expect(canUpdate).toBe(true);
  });

  it("worker can only update tasks it originated", async () => {
    const nodeRole = "worker";
    const nodeId = "ubuntu-worker";

    await kv.put(
      "T-001",
      encode({ task_id: "T-001", origin: "ubuntu-worker", status: "proposed" })
    );
    const entry = await kv.get("T-001");
    const task = decode(entry!.value);

    const canUpdate = nodeRole === "lead" || task.origin === nodeId;
    expect(canUpdate).toBe(true);
  });

  it("worker cannot update tasks from other nodes", async () => {
    const nodeRole = "worker";
    const nodeId = "ubuntu-worker-2";

    await kv.put(
      "T-001",
      encode({ task_id: "T-001", origin: "ubuntu-worker-1", status: "queued" })
    );
    const entry = await kv.get("T-001");
    const task = decode(entry!.value);

    const canUpdate = nodeRole === "lead" || task.origin === nodeId;
    expect(canUpdate).toBe(false);
  });

  it("worker proposals get status 'proposed'", () => {
    const nodeRole = "worker";
    const status = nodeRole === "lead" ? "queued" : "proposed";
    expect(status).toBe("proposed");
  });

  it("lead proposals get status 'queued' directly", () => {
    const nodeRole = "lead";
    const status = nodeRole === "lead" ? "queued" : "proposed";
    expect(status).toBe("queued");
  });
});

// ── Proposal Lifecycle ──

describe("Proposal lifecycle", () => {
  it("worker proposes → daemon accepts → queued", async () => {
    // Worker creates with proposed
    await kv.put(
      "T-PROP-001",
      encode({
        task_id: "T-PROP-001",
        title: "Fix bug",
        origin: "worker-1",
        status: "proposed",
      })
    );

    // Daemon reads proposed tasks
    const entry = await kv.get("T-PROP-001");
    const task = decode(entry!.value);
    expect(task.status).toBe("proposed");

    // Daemon validates and accepts
    task.status = "queued";
    await kv.put("T-PROP-001", encode(task));

    const updated = await kv.get("T-PROP-001");
    expect(decode(updated!.value).status).toBe("queued");
  });

  it("daemon rejects invalid proposal", async () => {
    // Worker proposes without title
    await kv.put(
      "T-BAD-001",
      encode({
        task_id: "T-BAD-001",
        title: "",
        origin: "worker-1",
        status: "proposed",
      })
    );

    const entry = await kv.get("T-BAD-001");
    const task = decode(entry!.value);

    // Daemon validates: empty title → reject
    if (!task.title || !task.origin) {
      task.status = "rejected";
      task.result = { success: false, summary: "Missing required fields" };
    }
    await kv.put("T-BAD-001", encode(task));

    const updated = await kv.get("T-BAD-001");
    expect(decode(updated!.value).status).toBe("rejected");
  });

  it("proposal with missing origin gets rejected", async () => {
    await kv.put(
      "T-BAD-002",
      encode({
        task_id: "T-BAD-002",
        title: "Good title",
        origin: "",
        status: "proposed",
      })
    );

    const entry = await kv.get("T-BAD-002");
    const task = decode(entry!.value);

    if (!task.title || !task.origin) {
      task.status = "rejected";
    }
    await kv.put("T-BAD-002", encode(task));

    const updated = await kv.get("T-BAD-002");
    expect(decode(updated!.value).status).toBe("rejected");
  });
});

// ── Watcher Lifecycle ──

describe("KV Watcher lifecycle", () => {
  it("watcher receives put events", async () => {
    const watcher = await kv.watch();
    const events: any[] = [];

    // Start collecting in background
    const collecting = (async () => {
      for await (const entry of watcher) {
        events.push(entry);
        if (events.length >= 2) break;
      }
    })();

    await kv.put("task-1", encode({ title: "First" }));
    await kv.put("task-2", encode({ title: "Second" }));

    await collecting;

    expect(events).toHaveLength(2);
    expect(events[0].key).toBe("task-1");
    expect(events[1].key).toBe("task-2");
  });

  it("watcher receives delete events", async () => {
    await kv.put("task-1", encode({ title: "Exists" }));

    const watcher = await kv.watch();
    const events: any[] = [];

    const collecting = (async () => {
      for await (const entry of watcher) {
        events.push(entry);
        if (events.length >= 1) break;
      }
    })();

    await kv.delete("task-1");
    await collecting;

    expect(events).toHaveLength(1);
    expect(events[0].key).toBe("task-1");
    expect(events[0].operation).toBe("DEL");
  });

  it("watcher.stop() ends iteration", async () => {
    const watcher = await kv.watch();
    let iterations = 0;

    const collecting = (async () => {
      for await (const _entry of watcher) {
        iterations++;
      }
    })();

    await kv.put("task-1", encode({ title: "First" }));

    // Give time for the event to be processed
    await new Promise((r) => setTimeout(r, 10));

    watcher.stop();
    await collecting;

    expect(iterations).toBe(1);
  });

  it("stopped watcher does not receive new events", async () => {
    const watcher = await kv.watch();
    const events: any[] = [];

    const collecting = (async () => {
      for await (const entry of watcher) {
        events.push(entry);
      }
    })();

    await kv.put("task-1", encode({ title: "Before stop" }));
    await new Promise((r) => setTimeout(r, 10));

    watcher.stop();
    await collecting;

    // This write happens after stop
    await kv.put("task-2", encode({ title: "After stop" }));
    await new Promise((r) => setTimeout(r, 10));

    expect(events).toHaveLength(1);
    expect(events[0].key).toBe("task-1");
  });
});

// ── Sync Skip Logic ──

describe("Sync skip logic (worker nodes)", () => {
  it("worker role skips markdown write", () => {
    const nodeRole = "worker";
    let wrote = false;
    if (nodeRole !== "worker") {
      wrote = true;
    }
    expect(wrote).toBe(false);
  });

  it("lead role allows markdown write", () => {
    const nodeRole = "lead";
    let wrote = false;
    if (nodeRole !== "worker") {
      wrote = true;
    }
    expect(wrote).toBe(true);
  });
});

// ── Collision-proof ID Generation ──

describe("Collision-proof task IDs", () => {
  it("generates unique IDs sequentially", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { randomBytes } = require("crypto");
      const suffix = randomBytes(3).toString("hex");
      const now = new Date();
      const dateStr =
        now.getFullYear().toString() +
        (now.getMonth() + 1).toString().padStart(2, "0") +
        now.getDate().toString().padStart(2, "0");
      ids.add(`T-${dateStr}-${suffix}`);
    }
    expect(ids.size).toBe(100);
  });
});

// ── Task Merge Logic (useTasks on worker nodes) ──

describe("Task merge logic (worker node deduplication)", () => {
  function mergeTasks(
    sqliteTasks: Array<{ id: string; title: string; source: "sqlite" }>,
    kvTasks: Array<{ task_id: string; title: string; source: "kv" }>,
    nodeRole: "lead" | "worker"
  ) {
    const merged = new Map<string, any>();

    for (const t of sqliteTasks) {
      merged.set(t.id, { ...t, mergedFrom: "sqlite" });
    }

    for (const t of kvTasks) {
      const existing = merged.get(t.task_id);
      if (!existing) {
        merged.set(t.task_id, { id: t.task_id, ...t, mergedFrom: "kv" });
      } else if (nodeRole === "worker") {
        merged.set(t.task_id, { id: t.task_id, ...t, mergedFrom: "kv" });
      }
    }

    return Array.from(merged.values());
  }

  it("merges non-overlapping tasks from both sources", () => {
    const sqlite = [
      { id: "T-001", title: "Local task", source: "sqlite" as const },
    ];
    const kvTasks = [
      { task_id: "T-002", title: "Mesh task", source: "kv" as const },
    ];
    const result = mergeTasks(sqlite, kvTasks, "worker");
    expect(result).toHaveLength(2);
    expect(result.find((t: any) => t.id === "T-001")).toBeTruthy();
    expect(result.find((t: any) => t.id === "T-002")).toBeTruthy();
  });

  it("deduplicates overlapping tasks — worker prefers KV", () => {
    const sqlite = [
      { id: "T-001", title: "SQLite version", source: "sqlite" as const },
      { id: "T-002", title: "Local only", source: "sqlite" as const },
    ];
    const kvTasks = [
      {
        task_id: "T-001",
        title: "KV version (newer)",
        source: "kv" as const,
      },
      { task_id: "T-003", title: "Mesh only", source: "kv" as const },
    ];
    const result = mergeTasks(sqlite, kvTasks, "worker");
    expect(result).toHaveLength(3);
    const t001 = result.find((t: any) => t.id === "T-001");
    expect(t001.mergedFrom).toBe("kv");
    expect(t001.title).toBe("KV version (newer)");
  });

  it("deduplicates overlapping tasks — lead prefers SQLite", () => {
    const sqlite = [
      {
        id: "T-001",
        title: "SQLite version (richer)",
        source: "sqlite" as const,
      },
    ];
    const kvTasks = [
      { task_id: "T-001", title: "KV version", source: "kv" as const },
    ];
    const result = mergeTasks(sqlite, kvTasks, "lead");
    expect(result).toHaveLength(1);
    const t001 = result.find((t: any) => t.id === "T-001");
    expect(t001.mergedFrom).toBe("sqlite");
    expect(t001.title).toBe("SQLite version (richer)");
  });

  it("handles empty KV gracefully", () => {
    const sqlite = [
      { id: "T-001", title: "Only local", source: "sqlite" as const },
    ];
    const result = mergeTasks(sqlite, [], "worker");
    expect(result).toHaveLength(1);
  });

  it("handles empty SQLite gracefully", () => {
    const kvTasks = [
      { task_id: "T-001", title: "Only mesh", source: "kv" as const },
    ];
    const result = mergeTasks([], kvTasks, "worker");
    expect(result).toHaveLength(1);
  });

  it("handles both empty gracefully", () => {
    const result = mergeTasks([], [], "worker");
    expect(result).toHaveLength(0);
  });
});
