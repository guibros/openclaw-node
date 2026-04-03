import { getNats, sc } from "@/lib/nats";
import { NODE_ID } from "@/lib/config";
import { startTraceIngestion } from "@/lib/trace-ingest";

export const dynamic = "force-dynamic";

/**
 * SSE endpoint: streams observability trace events in real-time.
 *
 * Subscribes to `openclaw.trace.>` via NATS for events from all nodes.
 * Also listens for MC-originated events on `openclaw.trace.${NODE_ID}.mc`.
 * Sends keepalive every 15s to prevent proxy/browser timeouts.
 */
export async function GET() {
  const nc = await getNats();
  if (!nc) {
    return new Response(
      JSON.stringify({ error: "NATS unavailable" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Start NATS→DB ingestion for daemon trace events (singleton, no-op if already started)
  startTraceIngestion();

  // Subscribe to all trace events across the mesh
  const sub = nc.subscribe("openclaw.trace.>");
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      console.log("[observability/stream] SSE client connected");
      const encoder = new TextEncoder();

      // Initial connection event
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // controller closed
          }
        }
      }, 15000);

      // Stream NATS trace events to SSE
      (async () => {
        try {
          for await (const msg of sub) {
            if (closed) break;
            try {
              const data = sc.decode(msg.data);
              // Extract source node from subject: openclaw.trace.<nodeId>.<module>
              const parts = msg.subject.split(".");
              const sourceNode = parts[2] || "unknown";
              controller.enqueue(
                encoder.encode(
                  `event: trace\ndata: ${JSON.stringify({ sourceNode, event: JSON.parse(data) })}\n\n`
                )
              );
            } catch {
              // skip malformed messages
            }
          }
        } catch {
          // subscription ended
        }
      })();

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
      console.log("[observability/stream] SSE client disconnected");
      closed = true;
      sub.unsubscribe();
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
