/**
 * mesh-kv-sync.test.ts — tests for the PRODUCTION sync engine
 * (src/lib/sync/mesh-kv.ts) against a MockKV-backed @/lib/nats.
 *
 * The previous version of this file imported zero production code: it tested
 * a mergeTasks defined inside the test file, an authority rule computed
 * inline, and the MockKV's own Map — green by construction (deep review
 * 2026-07-03). Every suite below exercises the real module; node identity and
 * role are driven through the mocked @/lib/config.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockKV } from "./mocks/mock-kv";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let kv: MockKV | null;
const cfg = { nodeId: "worker-1", nodeRole: "worker" as "lead" | "worker" };

vi.mock("@/lib/nats", () => ({
  getTasksKv: async () => kv,
  sc: {
    encode: (s: string) => encoder.encode(s),
    decode: (b: Uint8Array) => decoder.decode(b),
  },
}));

vi.mock("@/lib/config", () => ({
  get NODE_ID() {
    return cfg.nodeId;
  },
  get NODE_ROLE() {
    return cfg.nodeRole;
  },
}));

import {
  listMeshTasks,
  getMeshTask,
  putMeshTask,
  updateMeshTaskCAS,
  proposeMeshTask,
  watchMeshTasks,
  mergeTasks,
  type MeshTaskEntry,
} from "@/lib/sync/mesh-kv";

function task(over: Partial<MeshTaskEntry> = {}): MeshTaskEntry {
  return {
    task_id: "t1",
    title: "Test task",
    description: "",
    status: "queued",
    origin: "lead-node",
    owner: null,
    priority: 1,
    budget_minutes: 10,
    metric: null,
    success_criteria: [],
    scope: [],
    tags: [],
    preferred_nodes: [],
    exclude_nodes: [],
    created_at: "2026-07-03T00:00:00Z",
    claimed_at: null,
    started_at: null,
    completed_at: null,
    last_activity: null,
    result: null,
    attempts: [],
    ...over,
  };
}

beforeEach(() => {
  kv = new MockKV();
  cfg.nodeId = "worker-1";
  cfg.nodeRole = "worker";
});

// ── Read/write roundtrip ──

describe("put/get/list roundtrip (production)", () => {
  it("putMeshTask stores what getMeshTask reads back", async () => {
    const rev = await putMeshTask(task({ task_id: "rt1", title: "Roundtrip" }));
    expect(rev).toBeGreaterThan(0);
    const got = await getMeshTask("rt1");
    expect(got?.task.title).toBe("Roundtrip");
    expect(got?.revision).toBe(rev);
  });

  it("listMeshTasks returns every stored task", async () => {
    await putMeshTask(task({ task_id: "a" }));
    await putMeshTask(task({ task_id: "b" }));
    const all = await listMeshTasks();
    expect(all.map((t) => t.task_id).sort()).toEqual(["a", "b"]);
  });

  it("listMeshTasks returns [] when NATS is unavailable", async () => {
    kv = null;
    expect(await listMeshTasks()).toEqual([]);
  });
});

// ── Authority model (production rule in updateMeshTaskCAS) ──

describe("authority model (production)", () => {
  it("lead can update a task originated elsewhere", async () => {
    cfg.nodeRole = "lead";
    cfg.nodeId = "lead-node";
    const rev = await putMeshTask(task({ origin: "worker-9" }));
    const newRev = await updateMeshTaskCAS("t1", { status: "running" }, rev);
    expect(newRev).toBeGreaterThan(rev);
    expect((await getMeshTask("t1"))?.task.status).toBe("running");
  });

  it("worker can update its OWN task", async () => {
    const rev = await putMeshTask(task({ origin: "worker-1" }));
    await updateMeshTaskCAS("t1", { status: "running" }, rev);
    expect((await getMeshTask("t1"))?.task.status).toBe("running");
  });

  it("worker is DENIED updating a foreign-origin task", async () => {
    const rev = await putMeshTask(task({ origin: "lead-node" }));
    await expect(updateMeshTaskCAS("t1", { status: "running" }, rev)).rejects.toThrow(
      /Authority denied: worker worker-1/
    );
    expect((await getMeshTask("t1"))?.task.status).toBe("queued");
  });
});

// ── CAS semantics ──

describe("CAS update (production)", () => {
  it("succeeds on the expected revision and merges partial updates", async () => {
    const rev = await putMeshTask(task({ origin: "worker-1", priority: 1 }));
    await updateMeshTaskCAS("t1", { priority: 5 }, rev);
    const got = await getMeshTask("t1");
    expect(got?.task.priority).toBe(5);
    expect(got?.task.title).toBe("Test task"); // untouched fields survive
  });

  it("throws on a stale revision (another node wrote since our read)", async () => {
    const rev = await putMeshTask(task({ origin: "worker-1" }));
    await updateMeshTaskCAS("t1", { status: "running" }, rev);
    await expect(updateMeshTaskCAS("t1", { status: "done" }, rev)).rejects.toThrow(
      /wrong last sequence/
    );
  });

  it("throws when the task does not exist", async () => {
    await expect(updateMeshTaskCAS("nope", { status: "x" }, 1)).rejects.toThrow(/not found/);
  });
});

// ── Proposal lifecycle ──

describe("proposeMeshTask (production)", () => {
  it("a worker proposal lands as status=proposed with the worker's origin", async () => {
    const proposed = await proposeMeshTask(task({ task_id: "p1" }));
    expect(proposed.status).toBe("proposed");
    expect(proposed.origin).toBe("worker-1");
    expect((await getMeshTask("p1"))?.task.status).toBe("proposed");
  });

  it("a lead proposal is queued directly", async () => {
    cfg.nodeRole = "lead";
    cfg.nodeId = "lead-node";
    const proposed = await proposeMeshTask(task({ task_id: "p2" }));
    expect(proposed.status).toBe("queued");
    expect(proposed.origin).toBe("lead-node");
  });
});

// ── Watcher ──

describe("watchMeshTasks (production)", () => {
  it("surfaces a PUT as a decoded task event; stop() ends iteration", async () => {
    const watch = await watchMeshTasks();
    expect(watch).not.toBeNull();
    const iter = watch!.events[Symbol.asyncIterator]();
    const pending = iter.next();
    await putMeshTask(task({ task_id: "w1", title: "Watched" }));
    const ev = await pending;
    expect(ev.done).toBe(false);
    expect(ev.value.operation).toBe("PUT");
    expect(ev.value.task?.title).toBe("Watched");
    watch!.stop();
    expect((await iter.next()).done).toBe(true);
  });

  it("returns null when NATS is unavailable", async () => {
    kv = null;
    expect(await watchMeshTasks()).toBeNull();
  });
});

// ── Merge logic (the real mergeTasks) ──

describe("mergeTasks (production)", () => {
  const sqlite = [{ id: "s1", title: "Local only" }, { id: "shared", title: "SQLite version" }];
  const kvTasks = [
    { task_id: "k1", title: "KV only" },
    { task_id: "shared", title: "KV version" },
  ];

  it("dedupes by id and includes tasks from both sources", () => {
    const merged = mergeTasks(sqlite, kvTasks, "lead");
    expect(merged.map((t) => t.id).sort()).toEqual(["k1", "s1", "shared"]);
  });

  it("on lead, SQLite wins for shared ids", () => {
    const merged = mergeTasks(sqlite, kvTasks, "lead");
    const shared = merged.find((t) => t.id === "shared");
    expect(shared?.title).toBe("SQLite version");
    expect(shared?.source).toBe("sqlite");
  });

  it("on worker, KV wins for shared ids", () => {
    const merged = mergeTasks(sqlite, kvTasks, "worker");
    const shared = merged.find((t) => t.id === "shared");
    expect(shared?.title).toBe("KV version");
    expect(shared?.source).toBe("kv");
  });

  it("KV-only tasks carry source=kv; SQLite-only carry source=sqlite", () => {
    const merged = mergeTasks(sqlite, kvTasks, "lead");
    expect(merged.find((t) => t.id === "k1")?.source).toBe("kv");
    expect(merged.find((t) => t.id === "s1")?.source).toBe("sqlite");
  });
});
