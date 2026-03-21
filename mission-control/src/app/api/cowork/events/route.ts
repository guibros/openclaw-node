import { getNats, sc } from "@/lib/nats";

export const dynamic = "force-dynamic";

/**
 * SSE endpoint for collab-specific events.
 * Subscribes to mesh.events.collab.> and forwards to connected browsers.
 */
export async function GET() {
  const nc = await getNats();
  if (!nc) {
    return new Response("NATS unavailable", { status: 503 });
  }

  const sub = nc.subscribe("mesh.events.collab.>");
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      controller.enqueue(encoder.encode(": connected\n\n"));

      const keepalive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // controller closed
          }
        }
      }, 30000);

      try {
        for await (const msg of sub) {
          if (closed) break;
          try {
            const data = sc.decode(msg.data);
            const eventType = msg.subject.replace("mesh.events.collab.", "");
            controller.enqueue(
              encoder.encode(`event: ${eventType}\ndata: ${data}\n\n`)
            );
          } catch {
            // skip malformed
          }
        }
      } finally {
        clearInterval(keepalive);
      }
    },
    cancel() {
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
