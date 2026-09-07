#!/usr/bin/env node

/**
 * mesh-tasks-status.test.js — Unit tests for lib/mesh-tasks.js
 *
 * Tests: TASK_STATUS enum completeness, createTask() defaults and field presence.
 * No external dependencies — runs with node:test.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createTask, TaskStore, TASK_STATUS, DEFAULT_MAX_REJECTIONS, DEFAULT_MAX_LEASE_REQUEUES } = require("../lib/mesh-tasks");
const { StringCodec } = require("nats");
const sc = StringCodec();

describe("TASK_STATUS enum", () => {
  it("contains all expected statuses", () => {
    const expected = [
      "queued",
      "claimed",
      "running",
      "completed",
      "failed",
      "released",
      "cancelled",
      "proposed",
      "rejected",
    ];
    for (const s of expected) {
      const key = Object.keys(TASK_STATUS).find(
        (k) => TASK_STATUS[k] === s
      );
      assert.ok(key, `Missing status: ${s}`);
    }
  });

  it("has no unexpected statuses", () => {
    const known = new Set([
      "queued",
      "claimed",
      "running",
      "pending_review",
      "completed",
      "failed",
      "released",
      "cancelled",
      "proposed",
      "rejected",
    ]);
    for (const [key, val] of Object.entries(TASK_STATUS)) {
      assert.ok(known.has(val), `Unexpected status: ${key}=${val}`);
    }
  });
});

describe("createTask()", () => {
  it("creates task with required fields", () => {
    const task = createTask({ task_id: "T-001", title: "Test" });
    assert.equal(task.task_id, "T-001");
    assert.equal(task.title, "Test");
    assert.equal(task.status, TASK_STATUS.QUEUED);
  });

  it("applies default budget_minutes", () => {
    const task = createTask({ task_id: "T-002", title: "Budget test" });
    assert.equal(task.budget_minutes, 30);
  });

  it("overrides defaults when provided", () => {
    const task = createTask({
      task_id: "T-003",
      title: "Custom",
      budget_minutes: 60,
      metric: "tests pass",
      priority: 5,
    });
    assert.equal(task.budget_minutes, 60);
    assert.equal(task.metric, "tests pass");
    assert.equal(task.priority, 5);
  });

  it("initializes state fields to null/empty", () => {
    const task = createTask({ task_id: "T-004", title: "State check" });
    assert.equal(task.owner, null);
    assert.equal(task.claimed_at, null);
    assert.equal(task.started_at, null);
    assert.equal(task.completed_at, null);
    assert.equal(task.result, null);
    assert.deepEqual(task.attempts, []);
  });

  it("includes created_at timestamp", () => {
    const before = new Date().toISOString();
    const task = createTask({ task_id: "T-005", title: "Timestamp" });
    const after = new Date().toISOString();
    assert.ok(task.created_at >= before);
    assert.ok(task.created_at <= after);
  });
});

// In-memory stand-in for the JetStream KV bucket: get/put/update(CAS)/delete/keys.
function mockKv() {
  const rows = new Map();
  let rev = 0;
  return {
    async get(k) { const r = rows.get(k); return r ? { value: r.value, revision: r.revision } : null; },
    async put(k, v) { rows.set(k, { value: v, revision: ++rev }); },
    async update(k, v, expected) {
      const r = rows.get(k);
      if (!r || r.revision !== expected) { const e = new Error("wrong last sequence"); e.code = "10071"; throw e; }
      rows.set(k, { value: v, revision: ++rev });
    },
    async delete(k) { rows.delete(k); },
    async keys() { return (async function* () { for (const k of [...rows.keys()]) yield k; })(); },
  };
}

async function seed(store, task) { await store.put(task); return task; }
const pending = (id, extra = {}) => ({ ...createTask({ task_id: id, title: id }), status: TASK_STATUS.PENDING_REVIEW, owner: "w1", ...extra });

describe("markRejected() reject→requeue cap (P4-5)", () => {
  it("re-queues below the cap and counts each rejection", async () => {
    const store = new TaskStore(mockKv());
    await seed(store, pending("T-1"));
    const t = await store.markRejected("T-1", "nope", { maxRejections: 3 });
    assert.equal(t.status, TASK_STATUS.QUEUED);
    assert.equal(t.rejection_count, 1);
    assert.equal(t.rejection_reason, "nope");
    assert.equal(t.result, null);
  });

  it("terminates as FAILED once the cap is reached instead of re-queuing forever", async () => {
    const store = new TaskStore(mockKv());
    await seed(store, pending("T-2", { rejection_count: 2 }));
    const t = await store.markRejected("T-2", "still wrong", { maxRejections: 3 });
    assert.equal(t.status, TASK_STATUS.FAILED);
    assert.equal(t.rejection_count, 3);
    assert.match(t.result.summary, /Rejected 3×/);
    // terminal: a further reject is refused
    assert.equal(await store.markRejected("T-2", "again"), null);
  });

  it("defaults to DEFAULT_MAX_REJECTIONS", async () => {
    const store = new TaskStore(mockKv());
    await seed(store, pending("T-3", { rejection_count: DEFAULT_MAX_REJECTIONS - 1 }));
    const t = await store.markRejected("T-3", "x");
    assert.equal(t.status, TASK_STATUS.FAILED);
  });
});

describe("recordMerge() merge-after-review (P4-4)", () => {
  it("records the merge on a completed task without touching the rest of the result", async () => {
    const store = new TaskStore(mockKv());
    await seed(store, { ...createTask({ task_id: "T-4", title: "t" }), status: TASK_STATUS.COMPLETED, owner: "w1", result: { success: true, summary: "s", merged: false } });
    const t = await store.recordMerge("T-4", { sha: "abc1234", merged: true, conflict: false, branch: "mesh/T-4" });
    assert.equal(t.result.merged, true);
    assert.equal(t.result.sha, "abc1234");
    assert.equal(t.result.summary, "s");
    assert.ok(t.merged_at);
  });

  it("refuses to record a merge on a task that is not completed (pending_review must stay unmerged)", async () => {
    const store = new TaskStore(mockKv());
    await seed(store, pending("T-5"));
    assert.equal(await store.recordMerge("T-5", { merged: true }), null);
  });
});

describe("pruneTerminal() KV hygiene (P4-5)", () => {
  const DAY = 86400000;
  const now = Date.parse("2026-09-06T12:00:00Z");
  const old = new Date(now - 30 * DAY).toISOString();
  const fresh = new Date(now - 1 * DAY).toISOString();

  it("deletes old terminal tasks, keeps fresh ones and every non-terminal task", async () => {
    const store = new TaskStore(mockKv());
    await seed(store, { ...createTask({ task_id: "old-done", title: "t" }), status: TASK_STATUS.COMPLETED, completed_at: old });
    await seed(store, { ...createTask({ task_id: "old-failed", title: "t" }), status: TASK_STATUS.FAILED, completed_at: old });
    await seed(store, { ...createTask({ task_id: "fresh-done", title: "t" }), status: TASK_STATUS.COMPLETED, completed_at: fresh });
    await seed(store, { ...createTask({ task_id: "old-running", title: "t" }), status: TASK_STATUS.RUNNING, created_at: old });
    const pruned = await store.pruneTerminal({ maxAgeMs: 14 * DAY, now });
    assert.deepEqual(pruned.sort(), ["old-done", "old-failed"]);
    assert.ok(await store.get("fresh-done"));
    assert.ok(await store.get("old-running"));
  });

  it("keeps a terminal task still referenced by a live task's depends_on (a pruned dep would strand it)", async () => {
    const store = new TaskStore(mockKv());
    await seed(store, { ...createTask({ task_id: "dep", title: "t" }), status: TASK_STATUS.COMPLETED, completed_at: old });
    await seed(store, { ...createTask({ task_id: "child", title: "t", depends_on: ["dep"] }), status: TASK_STATUS.QUEUED });
    assert.deepEqual(await store.pruneTerminal({ maxAgeMs: 14 * DAY, now }), []);
    assert.ok(await store.get("dep"));
  });

  it("is a no-op when disabled (maxAgeMs 0)", async () => {
    const store = new TaskStore(mockKv());
    await seed(store, { ...createTask({ task_id: "x", title: "t" }), status: TASK_STATUS.COMPLETED, completed_at: old });
    assert.deepEqual(await store.pruneTerminal({ maxAgeMs: 0, now }), []);
  });
});

describe("lease + fencing token (P4-5)", () => {
  const queued = (id) => ({ ...createTask({ task_id: id, title: id }), status: TASK_STATUS.QUEUED });

  it("claim issues a lease token and expiry; heartbeat renews the expiry", async () => {
    const store = new TaskStore(mockKv(), { leaseMs: 1000 });
    await seed(store, queued("L-1"));
    const t = await store.claim("w1");
    assert.equal(t.status, TASK_STATUS.CLAIMED);
    assert.match(t.lease_token, /^[0-9a-f]{32}$/);
    const firstExpiry = Date.parse(t.lease_expires_at);
    assert.ok(firstExpiry > Date.now() && firstExpiry <= Date.now() + 1100);
    await new Promise(r => setTimeout(r, 20));
    const renewed = await store.touchActivity("L-1");
    assert.ok(Date.parse(renewed.lease_expires_at) > firstExpiry, "renewed lease moves the expiry forward");
    assert.equal(renewed.lease_token, t.lease_token, "renewal keeps the token");
  });

  it("leaseMatches: current token passes, stale/missing token fails, pre-lease task passes", () => {
    const withLease = { lease_token: "abc" };
    assert.equal(TaskStore.leaseMatches(withLease, "abc"), true);
    assert.equal(TaskStore.leaseMatches(withLease, "old"), false);
    assert.equal(TaskStore.leaseMatches(withLease, undefined), false);
    assert.equal(TaskStore.leaseMatches({ lease_token: null }, undefined), true);
  });

  it("an expired lease re-queues the task with a fresh token on the next claim (old token fenced out)", async () => {
    const store = new TaskStore(mockKv(), { leaseMs: 50 });
    await seed(store, queued("L-2"));
    const first = await store.claim("w1");
    const reaped = await store.reapExpiredLeases({ now: Date.now() + 1000 });
    assert.deepEqual(reaped, { requeued: ["L-2"], released: [] });
    const back = await store.get("L-2");
    assert.equal(back.status, TASK_STATUS.QUEUED);
    assert.equal(back.owner, null);
    assert.equal(back.lease_token, null);
    assert.equal(back.lease_requeues, 1);
    assert.match(back.attempts.at(-1).approach, /lease expired while held by w1/);
    const second = await store.claim("w2");
    assert.notEqual(second.lease_token, first.lease_token);
    assert.equal(TaskStore.leaseMatches(second, first.lease_token), false, "the dead worker's token no longer fences");
  });

  it("a live lease is left alone", async () => {
    const store = new TaskStore(mockKv(), { leaseMs: 60_000 });
    await seed(store, queued("L-3"));
    await store.claim("w1");
    assert.deepEqual(await store.reapExpiredLeases(), { requeued: [], released: [] });
    assert.equal((await store.get("L-3")).status, TASK_STATUS.CLAIMED);
  });

  it("after DEFAULT_MAX_LEASE_REQUEUES expiries the task is RELEASED for triage, not re-queued again", async () => {
    const store = new TaskStore(mockKv(), { leaseMs: 10 });
    await seed(store, queued("L-4"));
    for (let i = 1; i <= DEFAULT_MAX_LEASE_REQUEUES; i++) {
      await store.claim(`w${i}`);
      const r = await store.reapExpiredLeases({ now: Date.now() + 1000 });
      if (i < DEFAULT_MAX_LEASE_REQUEUES) assert.deepEqual(r.requeued, ["L-4"]);
      else assert.deepEqual(r.released, ["L-4"]);
    }
    const t = await store.get("L-4");
    assert.equal(t.status, TASK_STATUS.RELEASED);
    assert.match(t.result.summary, /Lease expired 3×/);
  });
});
