import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

export const dynamic = "force-dynamic";

// Read-only viewer over the notifier's append-only ledger — never writes.
const LEDGER_PATH =
  process.env.OPENCLAW_NOTIFY_LEDGER ||
  path.join(os.homedir(), ".openclaw", "notifications", "ledger.jsonl");

interface NotificationEvent {
  id: string;
  ts: string;
  source?: string;
  kind?: string;
  title?: string;
  subtitle?: string;
  message?: string;
  url?: string;
  node?: string;
  delivery?: { method?: string; clickable?: boolean };
  clicked_at?: string;
}

function foldLedger(raw: string): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  const clicks = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    if (obj.type === "notification" && typeof obj.id === "string" && typeof obj.ts === "string") {
      events.push({
        id: obj.id,
        ts: obj.ts,
        source: typeof obj.source === "string" ? obj.source : undefined,
        kind: typeof obj.kind === "string" ? obj.kind : undefined,
        title: typeof obj.title === "string" ? obj.title : undefined,
        subtitle: typeof obj.subtitle === "string" ? obj.subtitle : undefined,
        message: typeof obj.message === "string" ? obj.message : undefined,
        url: typeof obj.url === "string" ? obj.url : undefined,
        node: typeof obj.node === "string" ? obj.node : undefined,
        delivery:
          obj.delivery && typeof obj.delivery === "object"
            ? (obj.delivery as { method?: string; clickable?: boolean })
            : undefined,
      });
    } else if (obj.type === "click" && typeof obj.ref === "string" && typeof obj.ts === "string") {
      if (!clicks.has(obj.ref)) clicks.set(obj.ref, obj.ts);
    }
  }
  for (const e of events) {
    const clickedAt = clicks.get(e.id);
    if (clickedAt) e.clicked_at = clickedAt;
  }
  events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return events;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(params.get("limit") || "100", 10) || 100, 1), 500);
  const source = params.get("source");
  const kind = params.get("kind");

  if (!fs.existsSync(LEDGER_PATH)) {
    return NextResponse.json({ events: [], total: 0, ledgerPath: LEDGER_PATH });
  }
  try {
    let events = foldLedger(fs.readFileSync(LEDGER_PATH, "utf-8"));
    if (source) events = events.filter((e) => e.source === source);
    if (kind) events = events.filter((e) => e.kind === kind);
    return NextResponse.json({
      events: events.slice(0, limit),
      total: events.length,
      ledgerPath: LEDGER_PATH,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, events: [], total: 0, ledgerPath: LEDGER_PATH },
      { status: 500 },
    );
  }
}
