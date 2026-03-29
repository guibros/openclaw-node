import { getTasksKv, sc } from "@/lib/nats";
import { NODE_ID, NODE_ROLE } from "@/lib/config";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/mesh/tasks — List all tasks from NATS KV.
 * Available on all nodes (read from shared KV).
 */
export async function GET() {
  const kv = await getTasksKv();
  if (!kv) {
    return Response.json({ tasks: [], natsAvailable: false });
  }

  const tasks: any[] = [];
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

  tasks.sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  });

  return Response.json({ tasks, natsAvailable: true });
}

/**
 * POST /api/mesh/tasks — Propose a new task.
 *
 * On lead: creates directly with status "queued".
 * On worker: creates with status "proposed" — daemon validates within 30s.
 */
export async function POST(req: Request) {
  const kv = await getTasksKv();
  if (!kv) {
    return Response.json({ error: "NATS unavailable" }, { status: 503 });
  }

  const body = await req.json();
  if (!body.title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const suffix = crypto.randomBytes(3).toString("hex");
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const taskId = body.task_id || `T-${dateStr}-${suffix}`;

  const status = NODE_ROLE === "lead" ? "queued" : "proposed";

  const task = {
    task_id: taskId,
    title: body.title,
    description: body.description || "",
    status,
    origin: NODE_ID,
    owner: null,
    priority: body.priority || 0,
    budget_minutes: body.budget_minutes || 30,
    metric: body.metric || null,
    success_criteria: body.success_criteria || [],
    scope: body.scope || [],
    tags: body.tags || [],
    preferred_nodes: body.preferred_nodes || [],
    exclude_nodes: body.exclude_nodes || [],
    created_at: now.toISOString(),
    claimed_at: null,
    started_at: null,
    completed_at: null,
    last_activity: null,
    result: null,
    attempts: [],
  };

  await kv.put(taskId, sc.encode(JSON.stringify(task)));

  return Response.json({ ok: true, task }, { status: 201 });
}
