import { NextRequest, NextResponse } from "next/server";
import { getNats, getCollabKv, sc } from "@/lib/nats";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { syncTasksToMarkdown } from "@/lib/sync/tasks";

export const dynamic = "force-dynamic";

/**
 * POST /api/cowork/intervene
 *
 * Operator interventions on collab sessions.
 * Actions: abort, force_converge, remove_node
 */
export async function POST(request: NextRequest) {
  const nc = await getNats();
  if (!nc) {
    return NextResponse.json({ error: "NATS unavailable" }, { status: 503 });
  }

  const kv = await getCollabKv();
  if (!kv) {
    return NextResponse.json(
      { error: "Collab KV unavailable" },
      { status: 503 }
    );
  }

  const { action, sessionId, nodeId } = await request.json();

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId required" },
      { status: 400 }
    );
  }

  // Read current session
  let session: any;
  try {
    const entry = await kv.get(sessionId);
    if (!entry || !entry.value) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }
    session = JSON.parse(sc.decode(entry.value));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }

  const now = new Date().toISOString();
  const audit = (event: string, detail?: string) => {
    if (!session.audit_log) session.audit_log = [];
    session.audit_log.push({ ts: now, event, detail, source: "mission-control" });
  };

  try {
    switch (action) {
      case "abort": {
        session.status = "aborted";
        session.completed_at = now;
        audit("manual_abort");

        await kv.put(sessionId, sc.encode(JSON.stringify(session)));

        // Cancel parent task via daemon RPC
        try {
          await nc.request(
            "mesh.tasks.cancel",
            sc.encode(JSON.stringify({ task_id: session.task_id })),
            { timeout: 5000 }
          );
        } catch {
          // Daemon may be down — KV is already updated
        }

        // Notify subscribers
        nc.publish(
          "mesh.events.collab.aborted",
          sc.encode(
            JSON.stringify({
              session_id: sessionId,
              task_id: session.task_id,
            })
          )
        );

        // Update Kanban for immediate feedback
        try {
          const db = getDb();
          db.update(tasks)
            .set({ status: "cancelled", kanbanColumn: "done", updatedAt: now })
            .where(eq(tasks.id, session.task_id))
            .run();
          syncTasksToMarkdown(db);
        } catch { /* best-effort */ }

        return NextResponse.json({ ok: true, action: "aborted" });
      }

      case "force_converge": {
        // Inject synthetic reflections for nodes that haven't submitted
        const currentRound =
          session.rounds?.[session.rounds.length - 1];
        if (currentRound) {
          const submittedNodes = new Set(
            (currentRound.reflections || []).map((r: any) => r.node_id)
          );
          const activeNodes = (session.nodes || []).filter(
            (n: any) => n.status !== "dead"
          );

          for (const node of activeNodes) {
            if (!submittedNodes.has(node.node_id)) {
              if (!currentRound.reflections) currentRound.reflections = [];
              currentRound.reflections.push({
                node_id: node.node_id,
                summary: "Synthetic reflection (force-converged by operator)",
                learnings: "",
                artifacts: [],
                confidence: 0.5,
                vote: "converged",
                synthetic: true,
                submitted_at: now,
              });
            }
          }
          currentRound.completed_at = now;
        }

        session.status = "converged";
        audit("force_converge");

        // Order matters: KV first, then event, then complete parent task.
        // If mesh.tasks.complete fires before KV is updated, the task closes
        // but the session shows as still active in the UI until next SWR poll.
        await kv.put(sessionId, sc.encode(JSON.stringify(session)));

        nc.publish(
          "mesh.events.collab.converged",
          sc.encode(
            JSON.stringify({
              session_id: sessionId,
              task_id: session.task_id,
              forced: true,
            })
          )
        );

        // Complete parent task via daemon RPC — critical fix:
        // without this, daemon's in-memory task stays running forever
        try {
          await nc.request(
            "mesh.tasks.complete",
            sc.encode(
              JSON.stringify({
                task_id: session.task_id,
                result: {
                  success: true,
                  summary: "Force-converged by operator via Mission Control",
                  forced: true,
                },
              })
            ),
            { timeout: 5000 }
          );
        } catch {
          // Daemon may be down — session is at least marked converged in KV
        }

        // Update Kanban for immediate feedback
        try {
          const db = getDb();
          db.update(tasks)
            .set({ status: "done", kanbanColumn: "done", updatedAt: now })
            .where(eq(tasks.id, session.task_id))
            .run();
          syncTasksToMarkdown(db);
        } catch { /* best-effort */ }

        return NextResponse.json({ ok: true, action: "force_converged" });
      }

      case "remove_node": {
        if (!nodeId) {
          return NextResponse.json(
            { error: "nodeId required for remove_node" },
            { status: 400 }
          );
        }

        // Use daemon RPC so it updates both KV and in-memory state atomically
        // This avoids stale quorum in the daemon's evaluateRound()
        try {
          await nc.request(
            "mesh.collab.leave",
            sc.encode(
              JSON.stringify({
                session_id: sessionId,
                node_id: nodeId,
              })
            ),
            { timeout: 5000 }
          );
        } catch {
          // Fallback: direct KV write if daemon doesn't handle leave RPC
          const node = (session.nodes || []).find(
            (n: any) => n.node_id === nodeId
          );
          if (node) {
            node.status = "dead";
            audit("node_removed", nodeId);
            await kv.put(sessionId, sc.encode(JSON.stringify(session)));
          }
        }

        // Notify the node to stop
        nc.publish(
          `mesh.agent.${nodeId}.stall`,
          sc.encode(
            JSON.stringify({
              task_id: session.task_id,
              reason: "Removed by operator",
            })
          )
        );

        nc.publish(
          "mesh.events.collab.node_removed",
          sc.encode(
            JSON.stringify({
              session_id: sessionId,
              node_id: nodeId,
            })
          )
        );

        return NextResponse.json({ ok: true, action: "node_removed", nodeId });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
