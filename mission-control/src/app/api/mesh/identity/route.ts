import { NODE_ID, NODE_ROLE, NODE_PLATFORM } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    nodeId: NODE_ID,
    role: NODE_ROLE,
    platform: NODE_PLATFORM,
  });
}
