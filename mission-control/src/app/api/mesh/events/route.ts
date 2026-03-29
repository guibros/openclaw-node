import { getNats, getTasksKv, sc } from "@/lib/nats";

export const dynamic = "force-dynamic";

/**
 * MANUAL VERIFICATION PROTOCOL (SSE dual-iterator cleanup):
 *
 * The zombie watcher leak is the highest-risk bug in this route.
 * It cannot be unit tested (no real HTTP server in Vitest).
 *
 * To verify after deployment:
 * 1. Open MC on worker node in browser
 * 2. Open DevTools > Network tab > filter "events" (SSE stream)
 * 3. Trigger a task state change on the lead (create/complete a task)
 * 4. Verify the SSE event arrives in the stream ("kv.task.updated" event type)
 * 5. Close the browser tab
 * 6. Check NATS connections: curl http://localhost:8222/connz | jq '.connections | length'
 *    -> Connection count should drop by 1 (the SSE watcher + sub are cleaned up)
 * 7. Repeat with 3 tabs open -> close all -> verify count drops by 3
 *
 * If connection count doesn't drop: the cancel() handler isn't calling watcher.stop()
 * or sub.unsubscribe(). Check the dual-iterator lifecycle in this file.
 */

/**
 * SSE endpoint: dual-iterator (NATS pub/sub + KV watcher).
 *
 * Iterator 1: NATS subscription on mesh.events.> (task lifecycle events)
 * Iterator 2: KV watcher on MESH_TASKS (real-time task state changes)
 *
 * Both feed into a single SSE stream. On client disconnect, both are cleaned up.
 */
export async function GET() {
  const nc = await getNats();
  if (!nc) {
    return new Response("NATS unavailable", { status: 503 });
  }

  const sub = nc.subscribe("mesh.events.>");
  const kv = await getTasksKv();
  let watcher: any = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      controller.enqueue(encoder.encode(": connected\n\n"));

      // Keepalive every 30s
      const keepalive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // controller closed
          }
        }
      }, 30000);

      // Iterator 1: NATS pub/sub events
      (async () => {
        try {
          for await (const msg of sub) {
            if (closed) break;
            try {
              const data = sc.decode(msg.data);
              const eventType = msg.subject.replace("mesh.events.", "");
              controller.enqueue(
                encoder.encode(`event: ${eventType}\ndata: ${data}\n\n`)
              );
            } catch {
              // skip malformed
            }
          }
        } catch {
          // subscription ended
        }
      })();

      // Iterator 2: KV watcher (task state changes)
      if (kv) {
        try {
          watcher = await kv.watch();
          (async () => {
            try {
              for await (const entry of watcher) {
                if (closed) break;
                try {
                  const task = entry.value
                    ? JSON.parse(sc.decode(entry.value))
                    : null;
                  const payload = JSON.stringify({
                    key: entry.key,
                    operation: entry.value ? "PUT" : "DEL",
                    task,
                    revision: entry.revision,
                  });
                  controller.enqueue(
                    encoder.encode(`event: kv.task.updated\ndata: ${payload}\n\n`)
                  );
                } catch {
                  // skip malformed
                }
              }
            } catch {
              // watcher ended
            }
          })();
        } catch {
          // KV watch failed — continue with pub/sub only
        }
      }

      // Wait for cancel (client disconnect)
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (closed) {
            clearInterval(check);
            clearInterval(keepalive);
            resolve();
          }
        }, 1000);
      });
    },
    cancel() {
      closed = true;
      sub.unsubscribe();
      if (watcher && typeof watcher.stop === "function") {
        watcher.stop();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
