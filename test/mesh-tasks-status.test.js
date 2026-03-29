#!/usr/bin/env node

/**
 * mesh-tasks-status.test.js — Unit tests for lib/mesh-tasks.js
 *
 * Tests: TASK_STATUS enum completeness, createTask() defaults and field presence.
 * No external dependencies — runs with node:test.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createTask, TASK_STATUS } = require("../lib/mesh-tasks");

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
