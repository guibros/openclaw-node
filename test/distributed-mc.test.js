#!/usr/bin/env node

/**
 * distributed-mc.test.js — Integration tests for distributed Mission Control.
 *
 * Requires:
 *   - NATS running at OPENCLAW_NATS or nats://127.0.0.1:4222
 *   - mesh-task-daemon.js running (for proposal lifecycle tests)
 *
 * Skips gracefully if NATS or daemon is unavailable.
 *
 * Run: node test/distributed-mc.test.js
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

let connect, StringCodec, sc, nc;

// Resolve NATS URL same way as mesh.js
const NATS_URL = process.env.OPENCLAW_NATS || "nats://127.0.0.1:4222";

before(async () => {
  try {
    ({ connect, StringCodec } = require("nats"));
    sc = StringCodec();
  } catch {
    console.log("SKIP: nats package not installed");
    process.exit(0);
  }

  try {
    nc = await connect({ servers: NATS_URL, timeout: 5000 });
    console.log(`Connected to NATS at ${NATS_URL}`);
  } catch {
    console.log(`SKIP: NATS unreachable at ${NATS_URL}`);
    process.exit(0);
  }

  // Check daemon availability — skip gracefully if not running
  const daemonAlive = await nc
    .request("mesh.tasks.list", sc.encode(JSON.stringify({})), {
      timeout: 3000,
    })
    .catch(() => null);

  if (!daemonAlive) {
    console.log(
      "SKIP: mesh-task-daemon not running — integration tests require it"
    );
    console.log("Start with: node bin/mesh-task-daemon.js");
    await nc.close();
    process.exit(0);
  }
  console.log("mesh-task-daemon confirmed alive");
});

after(async () => {
  if (nc && !nc.isClosed()) {
    await nc.close();
  }
});

// ── Helper ──

function uniqueTaskId() {
  return `T-TEST-${crypto.randomBytes(4).toString("hex")}`;
}

async function rpc(subject, payload) {
  const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), {
    timeout: 10000,
  });
  return JSON.parse(sc.decode(msg.data));
}

// ── Tests ──

describe("NATS Task RPC", () => {
  it("mesh.tasks.list returns tasks array", async () => {
    const res = await rpc("mesh.tasks.list", {});
    assert.ok(res.ok, "Response should be ok");
    assert.ok(Array.isArray(res.data), "data should be an array");
  });

  it("mesh.tasks.submit creates a new task", async () => {
    const taskId = uniqueTaskId();
    const res = await rpc("mesh.tasks.submit", {
      task_id: taskId,
      title: "Integration test task",
      budget_minutes: 5,
    });
    assert.ok(res.ok, `Submit failed: ${res.error}`);
    assert.equal(res.data.task_id, taskId);
    assert.equal(res.data.status, "queued");
  });

  it("mesh.tasks.get retrieves a submitted task", async () => {
    const taskId = uniqueTaskId();
    await rpc("mesh.tasks.submit", {
      task_id: taskId,
      title: "Get test",
    });

    const res = await rpc("mesh.tasks.get", { task_id: taskId });
    assert.ok(res.ok);
    assert.equal(res.data.task_id, taskId);
    assert.equal(res.data.title, "Get test");
  });

  it("mesh.tasks.submit rejects duplicate task_id", async () => {
    const taskId = uniqueTaskId();
    await rpc("mesh.tasks.submit", {
      task_id: taskId,
      title: "First",
    });

    const res = await rpc("mesh.tasks.submit", {
      task_id: taskId,
      title: "Duplicate",
    });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes("already exists"));
  });
});

describe("Task state transitions", () => {
  it("claim → start → complete lifecycle", async () => {
    const taskId = uniqueTaskId();
    const nodeId = "test-node-" + crypto.randomBytes(2).toString("hex");

    // Submit
    await rpc("mesh.tasks.submit", {
      task_id: taskId,
      title: "Lifecycle test",
      budget_minutes: 60,
    });

    // Claim
    const claimRes = await rpc("mesh.tasks.claim", { node_id: nodeId });
    assert.ok(claimRes.ok, `Claim failed: ${claimRes.error}`);
    assert.equal(claimRes.data.task_id, taskId);
    assert.equal(claimRes.data.status, "claimed");
    assert.equal(claimRes.data.owner, nodeId);

    // Start
    const startRes = await rpc("mesh.tasks.start", { task_id: taskId });
    assert.ok(startRes.ok);
    assert.equal(startRes.data.status, "running");

    // Complete
    const completeRes = await rpc("mesh.tasks.complete", {
      task_id: taskId,
      result: { success: true, summary: "All tests passed" },
    });
    assert.ok(completeRes.ok);
    assert.equal(completeRes.data.status, "completed");
  });

  it("cancel transitions task to cancelled", async () => {
    const taskId = uniqueTaskId();
    await rpc("mesh.tasks.submit", {
      task_id: taskId,
      title: "Cancel test",
    });

    const res = await rpc("mesh.tasks.cancel", { task_id: taskId });
    assert.ok(res.ok);
    assert.equal(res.data.status, "cancelled");
  });
});

describe("Collision-proof task IDs", () => {
  it("sequential ID generation produces no collisions", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      const suffix = crypto.randomBytes(3).toString("hex");
      const now = new Date();
      const dateStr =
        now.getFullYear().toString() +
        (now.getMonth() + 1).toString().padStart(2, "0") +
        now.getDate().toString().padStart(2, "0");
      ids.add(`T-${dateStr}-${suffix}`);
    }
    assert.equal(ids.size, 100);
  });

  it("parallel ID generation produces no collisions", async () => {
    const promises = Array.from({ length: 20 }, () => {
      return new Promise((resolve) => {
        const suffix = crypto.randomBytes(3).toString("hex");
        const now = new Date();
        const dateStr =
          now.getFullYear().toString() +
          (now.getMonth() + 1).toString().padStart(2, "0") +
          now.getDate().toString().padStart(2, "0");
        resolve(`T-${dateStr}-${suffix}`);
      });
    });

    const ids = await Promise.all(promises);
    const unique = new Set(ids);
    assert.equal(
      unique.size,
      ids.length,
      `Expected ${ids.length} unique IDs, got ${unique.size}`
    );
  });
});

describe("Mesh events", () => {
  it("submitted event fires on task creation", async () => {
    const taskId = uniqueTaskId();

    // Subscribe to event before submitting
    const sub = nc.subscribe("mesh.events.submitted", { max: 1 });
    const eventPromise = (async () => {
      for await (const msg of sub) {
        return JSON.parse(sc.decode(msg.data));
      }
    })();

    // Give subscription time to register
    await new Promise((r) => setTimeout(r, 100));

    await rpc("mesh.tasks.submit", {
      task_id: taskId,
      title: "Event test",
    });

    const event = await Promise.race([
      eventPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Event timeout")), 5000)
      ),
    ]);

    assert.equal(event.task_id, taskId);
    assert.equal(event.event, "submitted");
  });
});
