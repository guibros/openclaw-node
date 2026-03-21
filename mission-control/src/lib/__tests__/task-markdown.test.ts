import { describe, it, expect } from "vitest";
import { parseTasksMarkdown, serializeTasksMarkdown } from "../parsers/task-markdown";

describe("parseTasksMarkdown", () => {
  it("parses a minimal task", () => {
    const md = `# Active Tasks

Updated: 2026-03-21

## Live Tasks

- task_id: T-20260321-001
  title: Test task
  status: queued
  owner: main
  success_criteria:
  artifacts:
  next_action: do something
  updated_at: 2026-03-21T12:00:00Z
`;
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("T-20260321-001");
    expect(tasks[0].title).toBe("Test task");
    expect(tasks[0].status).toBe("queued");
    expect(tasks[0].owner).toBe("main");
    expect(tasks[0].nextAction).toBe("do something");
  });

  it("parses mesh execution fields", () => {
    const md = `## Live Tasks

- task_id: T-20260321-002
  title: Mesh task
  status: running
  owner: daedalus
  success_criteria:
  artifacts:
  next_action: n/a
  execution: mesh
  mesh_task_id: MESH-TEST-001
  mesh_node: calos-ubuntu
  metric: tests pass
  budget_minutes: 60
  scope:
    - src/lib/
    - src/app/
  updated_at: 2026-03-21T12:00:00Z
`;
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].execution).toBe("mesh");
    expect(tasks[0].meshTaskId).toBe("MESH-TEST-001");
    expect(tasks[0].meshNode).toBe("calos-ubuntu");
    expect(tasks[0].metric).toBe("tests pass");
    expect(tasks[0].budgetMinutes).toBe(60);
    expect(tasks[0].scope).toEqual(["src/lib/", "src/app/"]);
  });

  it("parses collaboration fields", () => {
    const md = `## Live Tasks

- task_id: T-20260321-003
  title: Collab task
  status: queued
  owner: main
  success_criteria:
  artifacts:
  next_action: n/a
  execution: mesh
  collaboration: {"mode":"parallel","min_nodes":2,"max_nodes":3}
  preferred_nodes:
    - node-a
    - node-b
  cluster_id: security-team
  updated_at: 2026-03-21T12:00:00Z
`;
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].collaboration).toEqual({ mode: "parallel", min_nodes: 2, max_nodes: 3 });
    expect(tasks[0].preferredNodes).toEqual(["node-a", "node-b"]);
    expect(tasks[0].clusterId).toBe("security-team");
  });

  it("parses scheduling fields", () => {
    const md = `## Live Tasks

- task_id: T-20260321-004
  title: Scheduled task
  status: queued
  owner: main
  success_criteria:
  artifacts:
  next_action: n/a
  needs_approval: false
  trigger_kind: cron
  trigger_cron: 0 10 * * 1
  trigger_tz: America/New_York
  is_recurring: true
  capacity_class: heavy
  auto_priority: 5
  updated_at: 2026-03-21T12:00:00Z
`;
    const tasks = parseTasksMarkdown(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].needsApproval).toBe(false);
    expect(tasks[0].triggerKind).toBe("cron");
    expect(tasks[0].triggerCron).toBe("0 10 * * 1");
    expect(tasks[0].triggerTz).toBe("America/New_York");
    expect(tasks[0].isRecurring).toBe(true);
    expect(tasks[0].capacityClass).toBe("heavy");
    expect(tasks[0].autoPriority).toBe(5);
  });

  it("returns empty for markdown without Live Tasks section", () => {
    const md = `# Active Tasks\n\nNo tasks here.`;
    expect(parseTasksMarkdown(md)).toEqual([]);
  });
});

describe("serializeTasksMarkdown round-trip", () => {
  it("round-trips a minimal task", () => {
    const md = `# Active Tasks

Updated: 2026-03-21

## Live Tasks

- task_id: T-20260321-001
  title: Test task
  status: queued
  owner: main
  success_criteria:
  artifacts:
  next_action: do something
  updated_at: 2026-03-21T12:00:00Z
`;
    const parsed = parseTasksMarkdown(md);
    const serialized = serializeTasksMarkdown(parsed);
    const reparsed = parseTasksMarkdown(serialized);

    expect(reparsed).toHaveLength(1);
    expect(reparsed[0].id).toBe(parsed[0].id);
    expect(reparsed[0].title).toBe(parsed[0].title);
    expect(reparsed[0].status).toBe(parsed[0].status);
    expect(reparsed[0].nextAction).toBe(parsed[0].nextAction);
  });

  it("round-trips mesh + collab fields", () => {
    const md = `## Live Tasks

- task_id: MESH-001
  title: Full mesh task
  status: running
  owner: daedalus
  success_criteria:
    - tests pass
    - no regressions
  artifacts:
    - /path/to/output.json
  next_action: wait for results
  execution: mesh
  mesh_task_id: NATS-001
  mesh_node: node-alpha
  metric: all green
  budget_minutes: 45
  scope:
    - src/
  collaboration: {"mode":"review","min_nodes":2}
  preferred_nodes:
    - node-alpha
    - node-beta
  cluster_id: dev-team
  updated_at: 2026-03-21T15:00:00Z
`;
    const parsed = parseTasksMarkdown(md);
    const serialized = serializeTasksMarkdown(parsed);
    const reparsed = parseTasksMarkdown(serialized);

    expect(reparsed[0].execution).toBe("mesh");
    expect(reparsed[0].meshTaskId).toBe("NATS-001");
    expect(reparsed[0].scope).toEqual(["src/"]);
    expect(reparsed[0].preferredNodes).toEqual(["node-alpha", "node-beta"]);
    expect(reparsed[0].clusterId).toBe("dev-team");
    expect(reparsed[0].successCriteria).toEqual(["tests pass", "no regressions"]);
    expect(reparsed[0].artifacts).toEqual(["/path/to/output.json"]);
  });
});
