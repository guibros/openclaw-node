"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, ExternalLink, MousePointerClick } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

interface NotificationsResponse {
  events: NotificationEvent[];
  total: number;
  ledgerPath?: string;
  error?: string;
}

const KINDS = ["info", "success", "warn", "error", "block"] as const;
const BADGE: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  success: "bg-green-500/10 text-green-400 border-green-500/30",
  warn: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  error: "bg-red-500/10 text-red-400 border-red-500/30",
  block: "bg-purple-500/10 text-purple-400 border-purple-500/30",
};

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications?limit=500");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    fetchNotifications();
    const t = setInterval(fetchNotifications, 15000);
    return () => clearInterval(t);
  }, [fetchNotifications]);

  if (!mounted) {
    return (
      <div className="h-full flex flex-col">
        <header className="border-b border-border px-6 py-4 shrink-0">
          <h1 className="text-xl font-bold text-foreground">Notifications</h1>
          <p className="text-xs text-muted-foreground mt-0.5">loading notification ledger…</p>
        </header>
        <div className="flex-1 px-6 py-4 text-xs text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const all = data?.events ?? [];
  const sources = Array.from(new Set(all.map((e) => e.source).filter(Boolean))) as string[];
  sources.sort();
  const events = all.filter(
    (e) => (!sourceFilter || e.source === sourceFilter) && (!kindFilter || e.kind === kindFilter),
  );

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">Notifications</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            every ledgered notification, newest first · {events.length} shown
            {all.length !== events.length ? ` of ${all.length}` : ""}
          </p>
        </div>
        <button
          onClick={fetchNotifications}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Filters</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            <option value="">all sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            <option value="">all kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          {(sourceFilter || kindFilter) && (
            <button
              onClick={() => { setSourceFilter(""); setKindFilter(""); }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              clear
            </button>
          )}
        </div>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">{error}</div>}

        {events.length === 0 && !error ? (
          <div className="rounded-lg border border-border bg-card px-4 py-6 text-center">
            <div className="text-xs text-muted-foreground">No notifications ledgered yet</div>
            {data?.ledgerPath && (
              <div className="text-[10px] font-mono text-muted-foreground/60 mt-1">{data.ledgerPath}</div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border/30">
            {events.map((e) => (
              <div key={e.id} className="px-4 py-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded border ${BADGE[e.kind ?? ""] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"}`}>
                    {e.kind ?? "?"}
                  </span>
                  {e.source && <span className="text-[10px] font-mono text-sky-400/80">{e.source}</span>}
                  <span className="text-sm text-foreground font-medium">{e.title ?? "(untitled)"}</span>
                  {e.subtitle && <span className="text-xs text-muted-foreground">{e.subtitle}</span>}
                  {e.url && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      origin
                    </a>
                  )}
                  {e.clicked_at && (
                    <span
                      className="flex items-center gap-1 text-[10px] text-green-400"
                      title={`clicked ${e.clicked_at}`}
                    >
                      <MousePointerClick className="h-3 w-3" />
                      clicked
                    </span>
                  )}
                </div>
                {e.message && <div className="text-xs text-muted-foreground break-words">{e.message}</div>}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60 font-mono flex-wrap">
                  <span title={e.ts}>{formatDistanceToNow(new Date(e.ts), { addSuffix: true })}</span>
                  <span>{e.ts}</span>
                  {e.node && <span>node={e.node}</span>}
                  {e.delivery?.method && <span>via {e.delivery.method}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
