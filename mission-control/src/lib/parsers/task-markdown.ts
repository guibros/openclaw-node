import fs from "fs";
import { traceCall } from "@/lib/tracer";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ParsedTask {
  id: string;
  title: string;
  status: string;
  owner: string | null;
  successCriteria: string[];
  artifacts: string[];
  nextAction: string | null;
  scheduledDate: string | null;
  project: string | null;
  type: string | null;
  parentId: string | null;
  startDate: string | null;
  endDate: string | null;
  color: string | null;
  description: string | null;
  needsApproval: boolean;
  triggerKind: string;
  triggerAt: string | null;
  triggerCron: string | null;
  triggerTz: string;
  isRecurring: boolean;
  capacityClass: string;
  autoPriority: number;
  updatedAt: string;
  // Mesh execution fields
  execution: string | null;
  meshTaskId: string | null;
  meshNode: string | null;
  metric: string | null;
  budgetMinutes: number;
  scope: string[];
  // Collab routing fields
  collaboration: Record<string, unknown> | null;
  preferredNodes: string[];
  excludeNodes: string[];
  clusterId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Status <-> Kanban mapping                                          */
/* ------------------------------------------------------------------ */

const STATUS_TO_KANBAN: Record<string, string> = {
  queued: "backlog",
  ready: "backlog",
  submitted: "in_progress", // dispatched to mesh, awaiting agent claim
  running: "in_progress",
  blocked: "in_progress",
  "waiting-user": "review",
  done: "done",
  cancelled: "done",
  archived: "done", // hidden from view but still in done column if shown
};

const KANBAN_TO_STATUS: Record<string, string> = {
  backlog: "queued",
  in_progress: "running",
  review: "waiting-user",
  done: "done",
};

export function statusToKanban(status: string): string {
  return STATUS_TO_KANBAN[status] ?? "backlog";
}

export function kanbanToStatus(column: string): string {
  return KANBAN_TO_STATUS[column] ?? "queued";
}

/* ------------------------------------------------------------------ */
/*  Parser                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse `memory/active-tasks.md` into structured task objects.
 *
 * Each task block starts with `- task_id: ...` and subsequent fields are
 * indented by 2 spaces.  Array values (success_criteria, artifacts) use
 * 4-space-indented `- ` lines.
 */
export function parseTasksMarkdown(content: string): ParsedTask[] {
  const _start = Date.now();
  const tasks: ParsedTask[] = [];

  // Extract only the "## Live Tasks" section
  const liveIdx = content.indexOf("## Live Tasks");
  if (liveIdx === -1) return tasks;

  const liveSection = content.slice(liveIdx);
  const lines = liveSection.split("\n");

  let current: Partial<ParsedTask> | null = null;
  let currentArrayKey: "successCriteria" | "artifacts" | "scope" | "preferredNodes" | "excludeNodes" | null = null;

  function flush() {
    if (current && current.id) {
      tasks.push({
        id: current.id!,
        title: current.title ?? "",
        status: current.status ?? "queued",
        owner: current.owner ?? null,
        successCriteria: current.successCriteria ?? [],
        artifacts: current.artifacts ?? [],
        nextAction: current.nextAction ?? null,
        scheduledDate: current.scheduledDate ?? null,
        project: current.project ?? null,
        type: current.type ?? null,
        parentId: current.parentId ?? null,
        startDate: current.startDate ?? null,
        endDate: current.endDate ?? null,
        color: current.color ?? null,
        description: current.description ?? null,
        needsApproval: current.needsApproval ?? true,
        triggerKind: current.triggerKind ?? "none",
        triggerAt: current.triggerAt ?? null,
        triggerCron: current.triggerCron ?? null,
        triggerTz: current.triggerTz ?? "America/Montreal",
        isRecurring: current.isRecurring ?? false,
        capacityClass: current.capacityClass ?? "normal",
        autoPriority: current.autoPriority ?? 0,
        updatedAt: current.updatedAt ?? "",
        execution: current.execution ?? null,
        meshTaskId: current.meshTaskId ?? null,
        meshNode: current.meshNode ?? null,
        metric: current.metric ?? null,
        budgetMinutes: current.budgetMinutes ?? 30,
        scope: current.scope ?? [],
        collaboration: current.collaboration ?? null,
        preferredNodes: current.preferredNodes ?? [],
        excludeNodes: current.excludeNodes ?? [],
        clusterId: current.clusterId ?? null,
      });
    }
  }

  for (const line of lines) {
    // New task block: `- task_id: <value>`
    const taskIdMatch = line.match(/^- task_id:\s*(.+)$/);
    if (taskIdMatch) {
      flush();
      current = { id: taskIdMatch[1].trim(), successCriteria: [], artifacts: [], scope: [], preferredNodes: [], excludeNodes: [] };
      currentArrayKey = null;
      continue;
    }

    if (!current) continue;

    // Array item: `    - <value>` (4 spaces + dash)
    const arrayItemMatch = line.match(/^    - (.+)$/);
    if (arrayItemMatch && currentArrayKey) {
      (current[currentArrayKey] as string[]).push(arrayItemMatch[1].trim());
      continue;
    }

    // Field line: `  key: value` (2-space indent)
    const fieldMatch = line.match(/^  (\w[\w_]*):\s*(.*)$/);
    if (fieldMatch) {
      const [, rawKey, rawValue] = fieldMatch;
      const value = rawValue.trim();

      switch (rawKey) {
        case "title":
          current.title = value;
          currentArrayKey = null;
          break;
        case "status":
          current.status = value;
          currentArrayKey = null;
          break;
        case "owner":
          current.owner = value || null;
          currentArrayKey = null;
          break;
        case "success_criteria":
          current.successCriteria = [];
          currentArrayKey = "successCriteria";
          break;
        case "artifacts":
          current.artifacts = [];
          currentArrayKey = "artifacts";
          break;
        case "next_action":
          current.nextAction = value === "n/a" ? null : value || null;
          currentArrayKey = null;
          break;
        case "scheduled_date":
          current.scheduledDate = value || null;
          currentArrayKey = null;
          break;
        case "project":
          current.project = value || null;
          currentArrayKey = null;
          break;
        case "type":
          current.type = value || null;
          currentArrayKey = null;
          break;
        case "parent_id":
          current.parentId = value || null;
          currentArrayKey = null;
          break;
        case "start_date":
          current.startDate = value || null;
          currentArrayKey = null;
          break;
        case "end_date":
          current.endDate = value || null;
          currentArrayKey = null;
          break;
        case "color":
          current.color = value || null;
          currentArrayKey = null;
          break;
        case "description":
          current.description = value ? value.replace(/\\n/g, "\n") : null;
          currentArrayKey = null;
          break;
        case "needs_approval":
          current.needsApproval = value === "true" || value === "1";
          currentArrayKey = null;
          break;
        case "trigger_kind":
          current.triggerKind = value || "none";
          currentArrayKey = null;
          break;
        case "trigger_at":
          current.triggerAt = value || null;
          currentArrayKey = null;
          break;
        case "trigger_cron":
          current.triggerCron = value || null;
          currentArrayKey = null;
          break;
        case "trigger_tz":
          current.triggerTz = value || "America/Montreal";
          currentArrayKey = null;
          break;
        case "is_recurring":
          current.isRecurring = value === "true" || value === "1";
          currentArrayKey = null;
          break;
        case "capacity_class":
          current.capacityClass = value || "normal";
          currentArrayKey = null;
          break;
        case "auto_priority":
          current.autoPriority = parseInt(value, 10) || 0;
          currentArrayKey = null;
          break;
        // Backward compat for old auto_start format
        case "auto_start":
          if (value === "true" || value === "1") {
            current.needsApproval = false;
          }
          currentArrayKey = null;
          break;
        case "auto_start_after":
          if (value) {
            current.triggerKind = "at";
            current.triggerAt = value;
          }
          currentArrayKey = null;
          break;
        case "auto_start_before":
          currentArrayKey = null;
          break;
        // Mesh execution fields
        case "execution":
          current.execution = value || null;
          currentArrayKey = null;
          break;
        case "mesh_task_id":
          current.meshTaskId = value || null;
          currentArrayKey = null;
          break;
        case "mesh_node":
          current.meshNode = value || null;
          currentArrayKey = null;
          break;
        case "metric":
          current.metric = value || null;
          currentArrayKey = null;
          break;
        case "budget_minutes":
          current.budgetMinutes = parseInt(value, 10) || 30;
          currentArrayKey = null;
          break;
        case "scope":
          current.scope = [];
          currentArrayKey = "scope";
          break;
        // Collab routing fields
        case "collaboration":
          try {
            current.collaboration = value ? JSON.parse(value) : null;
          } catch {
            current.collaboration = null;
          }
          currentArrayKey = null;
          break;
        case "preferred_nodes":
          current.preferredNodes = [];
          currentArrayKey = "preferredNodes";
          break;
        case "exclude_nodes":
          current.excludeNodes = [];
          currentArrayKey = "excludeNodes";
          break;
        case "cluster_id":
          current.clusterId = value || null;
          currentArrayKey = null;
          break;
        case "updated_at":
          current.updatedAt = value;
          currentArrayKey = null;
          break;
        default:
          currentArrayKey = null;
          break;
      }
      continue;
    }

    // Blank line or other non-indented content resets array context
    if (line.trim() === "") {
      currentArrayKey = null;
    }
  }

  flush();
  traceCall("parsers/task-markdown", "parseTasksMarkdown", _start, `${tasks.length} tasks`);
  return tasks;
}

/* ------------------------------------------------------------------ */
/*  Serializer                                                         */
/* ------------------------------------------------------------------ */

const HEADER = `# Active Tasks

Updated: {{TIMESTAMP}}

Use this as crash-recovery state.

## Task Template

\`\`\`yaml
task_id: T-YYYYMMDD-001
title: <short title>
status: queued|running|blocked|waiting-user|done|cancelled
owner: main|sub-agent:<sessionKey>
success_criteria:
  - <criterion 1>
  - <criterion 2>
artifacts:
  - <path/or/link>
next_action: <single next step>
updated_at: YYYY-MM-DD HH:MM America/Montreal
\`\`\`

## Live Tasks
`;

function formatTimestamp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montreal",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(",", "")
    + " America/Montreal";
}

export function serializeTasksMarkdown(tasks: ParsedTask[]): string {
  const _start = Date.now();
  const header = HEADER.replace("{{TIMESTAMP}}", formatTimestamp());

  const blocks = tasks.map((t) => {
    const lines: string[] = [];
    lines.push(`- task_id: ${t.id}`);
    lines.push(`  title: ${t.title}`);
    lines.push(`  status: ${t.status}`);
    lines.push(`  owner: ${t.owner ?? "main"}`);

    if (t.successCriteria.length > 0) {
      lines.push("  success_criteria:");
      for (const c of t.successCriteria) {
        lines.push(`    - ${c}`);
      }
    } else {
      lines.push("  success_criteria:");
    }

    if (t.artifacts.length > 0) {
      lines.push("  artifacts:");
      for (const a of t.artifacts) {
        lines.push(`    - ${a}`);
      }
    } else {
      lines.push("  artifacts:");
    }

    lines.push(`  next_action: ${t.nextAction ?? "n/a"}`);
    if (t.scheduledDate) {
      lines.push(`  scheduled_date: ${t.scheduledDate}`);
    }
    if (t.project) {
      lines.push(`  project: ${t.project}`);
    }
    if (t.type && t.type !== "task") {
      lines.push(`  type: ${t.type}`);
    }
    if (t.parentId) {
      lines.push(`  parent_id: ${t.parentId}`);
    }
    if (t.startDate) {
      lines.push(`  start_date: ${t.startDate}`);
    }
    if (t.endDate) {
      lines.push(`  end_date: ${t.endDate}`);
    }
    if (t.color) {
      lines.push(`  color: ${t.color}`);
    }
    if (t.description) {
      // Escape newlines so multiline descriptions don't break the parser
      lines.push(`  description: ${t.description.replace(/\n/g, "\\n")}`);
    }
    if (!t.needsApproval) {
      lines.push(`  needs_approval: false`);
    }
    if (t.triggerKind !== "none") {
      lines.push(`  trigger_kind: ${t.triggerKind}`);
    }
    if (t.triggerAt) {
      lines.push(`  trigger_at: ${t.triggerAt}`);
    }
    if (t.triggerCron) {
      lines.push(`  trigger_cron: ${t.triggerCron}`);
    }
    if (t.triggerTz && t.triggerTz !== "America/Montreal") {
      lines.push(`  trigger_tz: ${t.triggerTz}`);
    }
    if (t.isRecurring) {
      lines.push(`  is_recurring: true`);
    }
    if (t.capacityClass && t.capacityClass !== "normal") {
      lines.push(`  capacity_class: ${t.capacityClass}`);
    }
    if (t.autoPriority > 0) {
      lines.push(`  auto_priority: ${t.autoPriority}`);
    }
    // Mesh execution fields
    if (t.execution) {
      lines.push(`  execution: ${t.execution}`);
    }
    if (t.meshTaskId) {
      lines.push(`  mesh_task_id: ${t.meshTaskId}`);
    }
    if (t.meshNode) {
      lines.push(`  mesh_node: ${t.meshNode}`);
    }
    if (t.metric) {
      lines.push(`  metric: ${t.metric}`);
    }
    if (t.budgetMinutes && t.budgetMinutes !== 30) {
      lines.push(`  budget_minutes: ${t.budgetMinutes}`);
    }
    if (t.scope && t.scope.length > 0) {
      lines.push("  scope:");
      for (const s of t.scope) {
        lines.push(`    - ${s}`);
      }
    }
    // Collab routing fields
    if (t.collaboration) {
      lines.push(`  collaboration: ${JSON.stringify(t.collaboration)}`);
    }
    if (t.preferredNodes && t.preferredNodes.length > 0) {
      lines.push("  preferred_nodes:");
      for (const n of t.preferredNodes) {
        lines.push(`    - ${n}`);
      }
    }
    if (t.excludeNodes && t.excludeNodes.length > 0) {
      lines.push("  exclude_nodes:");
      for (const n of t.excludeNodes) {
        lines.push(`    - ${n}`);
      }
    }
    if (t.clusterId) {
      lines.push(`  cluster_id: ${t.clusterId}`);
    }
    lines.push(`  updated_at: ${t.updatedAt}`);

    return lines.join("\n");
  });

  const result = header + "\n" + blocks.join("\n\n") + "\n";
  traceCall("parsers/task-markdown", "serializeTasksMarkdown", _start, `${tasks.length} tasks`);
  return result;
}
