import { NextRequest } from "next/server";
import { getTasksKv, sc } from "@/lib/nats";
import { NODE_ID, NODE_ROLE } from "@/lib/config";
import { withTrace } from "@/lib/tracer";

export const dynamic = "force-dynamic";

/**
 * GET /api/mesh/tasks/:id — Get a single task from KV.
 */
export const GET = withTrace("mesh", "GET /api/mesh/tasks/:id", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const kv = await getTasksKv();
  if (!kv) {
    return Response.json({ error: "NATS unavailable" }, { status: 503 });
  }

  const entry = await kv.get(id);
  if (!entry?.value) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const task = JSON.parse(sc.decode(entry.value));
  return Response.json({ task, revision: entry.revision });
});

/**
 * PATCH /api/mesh/tasks/:id — Update a task with CAS.
 *
 * Authority rules:
 * - Lead can update any task
 * - Workers can only update tasks they originated
 * - Revision must match (CAS) to prevent stale writes
 */
export const PATCH = withTrace("mesh", "PATCH /api/mesh/tasks/:id", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const kv = await getTasksKv();
  if (!kv) {
    return Response.json({ error: "NATS unavailable" }, { status: 503 });
  }

  const body = await req.json();
  const { revision, ...updates } = body;

  if (!revision) {
    return Response.json({ error: "revision is required for CAS update" }, { status: 400 });
  }

  // Read current state
  const entry = await kv.get(id);
  if (!entry?.value) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const current = JSON.parse(sc.decode(entry.value));

  // Authority check
  if (NODE_ROLE !== "lead" && current.origin !== NODE_ID) {
    return Response.json(
      { error: "workers can only update tasks they originated" },
      { status: 403 }
    );
  }

  // Merge updates
  const updated = { ...current, ...updates };

  // CAS write
  try {
    await kv.update(id, sc.encode(JSON.stringify(updated)), revision);
  } catch (err: any) {
    // Revision mismatch — return current state so client can retry
    const freshEntry = await kv.get(id);
    const freshTask = freshEntry?.value
      ? JSON.parse(sc.decode(freshEntry.value))
      : null;
    return Response.json(
      {
        error: `revision mismatch: expected ${revision}, got ${entry.revision}`,
        currentTask: freshTask,
        currentRevision: freshEntry?.revision,
      },
      { status: 409 }
    );
  }

  return Response.json({ ok: true, task: updated });
});
