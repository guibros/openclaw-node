"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, ChevronRight } from "lucide-react";

interface WatchResult {
  id: string;
  family: string;
  label: string;
  signal: string;
  status: "WORKING" | "BROKEN" | "OFF" | "UNKNOWN";
  detail: string;
  evidence?: string;
  latency_ms: number;
  source?: string;
  code?: string;
}

interface WatchReport {
  meta: { nodeId: string; mode: string; timestamp: string | null };
  counts: Record<string, number>;
  health?: number | null;
  results: WatchResult[];
  missing?: boolean;
  hint?: string;
  error?: string;
  fileMtime?: string;
  fileAgeMs?: number;
}

const ORDER = ["WORKING", "BROKEN", "OFF", "UNKNOWN"] as const;
const DOT: Record<string, string> = {
  WORKING: "bg-green-400", BROKEN: "bg-red-500", OFF: "bg-zinc-500", UNKNOWN: "bg-yellow-400",
};
const TEXT: Record<string, string> = {
  WORKING: "text-green-400", BROKEN: "text-red-400", OFF: "text-zinc-400", UNKNOWN: "text-yellow-400",
};
const ROWBG: Record<string, string> = {
  WORKING: "", BROKEN: "bg-red-500/5", OFF: "", UNKNOWN: "bg-yellow-500/5",
};

export default function NodeWatchPage() {
  const [report, setReport] = useState<WatchReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const fetchWatch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/node-watch");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration mount flag: standard Next client-only gate
    setMounted(true);
    fetchWatch();
    const t = setInterval(fetchWatch, 15000);
    return () => clearInterval(t);
  }, [fetchWatch]);

  // Render a stable shell on the server + first client render so hydration always
  // matches; the data-driven UI renders only after mount (client-fetched data).
  if (!mounted) {
    return (
      <div className="h-full flex flex-col">
        <header className="border-b border-border px-6 py-4 shrink-0">
          <h1 className="text-xl font-bold text-foreground">Node Watch</h1>
          <p className="text-xs text-muted-foreground mt-0.5">loading node health…</p>
        </header>
        <div className="flex-1 px-6 py-4 text-xs text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const results = report?.results ?? [];
  const c = report?.counts ?? {};
  const applicable = (c.WORKING || 0) + (c.BROKEN || 0) + (c.UNKNOWN || 0);
  const health = report?.health ?? (applicable > 0 ? Math.round(((c.WORKING || 0) / applicable) * 100) : null);
  const healthColor = health === null ? "text-muted-foreground" : health >= 90 ? "text-green-400" : health >= 70 ? "text-yellow-400" : "text-red-400";
  const families = Array.from(new Set(results.map((r) => r.family)));
  families.sort((a, b) => {
    const broke = (f: string) => (results.some((r) => r.family === f && r.status === "BROKEN") ? 0 : 1);
    return broke(a) - broke(b);
  });

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">Node Watch</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {report?.meta?.nodeId ? `node=${report.meta.nodeId} · ` : ""}every check, by category, with its result
            {report?.fileMtime ? ` · snapshot ${typeof report.fileAgeMs === "number" ? `${Math.round(report.fileAgeMs / 1000)}s ago` : report.fileMtime}` : ""}
          </p>
        </div>
        <button
          onClick={fetchWatch}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {/* overall health + tally */}
        <div className="flex items-center gap-5 rounded-lg border border-border bg-card px-5 py-4">
          <div className="text-center shrink-0">
            <div className={`text-5xl font-bold tabular-nums leading-none ${healthColor}`}>{health === null ? "—" : `${health}%`}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Node health</div>
          </div>
          <div className="h-12 w-px bg-border shrink-0" />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-mono">
            {ORDER.map((s) => (
              <span key={s} className={TEXT[s]}><b className="text-base">{report?.counts?.[s] ?? 0}</b> {s}</span>
            ))}
          </div>
          <div className="ml-auto text-[10px] text-muted-foreground/70 font-mono max-w-[220px] text-right">
            health = working / (working + broken + unknown); off excluded
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">{error}</div>}
        {report?.missing && <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-400">{report.hint}</div>}

        {/* one full-width dropdown per category; every check listed inside with its result */}
        <div className="space-y-2">
          {families.map((fam) => {
            const items = results.filter((r) => r.family === fam);
            const broken = items.filter((r) => r.status === "BROKEN").length;
            const unknown = items.filter((r) => r.status === "UNKNOWN").length;
            return (
              <details key={fam} className="group/cat rounded-lg border border-border bg-card">
                <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer list-none select-none">
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open/cat:rotate-90" />
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{fam}</span>
                  {broken > 0 && <span className="text-[10px] text-red-400 font-medium">{broken} broken</span>}
                  {unknown > 0 && <span className="text-[10px] text-yellow-400 font-medium">{unknown} unknown</span>}
                  <span className="ml-auto text-[10px] text-muted-foreground">{items.length} checks</span>
                </summary>
                <div className="border-t border-border/50 divide-y divide-border/30">
                  {items.map((r) => (
                    <details key={r.id} className={`group/chk ${ROWBG[r.status]}`}>
                      <summary className="flex items-center gap-3 px-4 py-2 cursor-pointer list-none select-none">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/60 transition-transform group-open/chk:rotate-90 shrink-0" />
                        <span className={`h-2 w-2 rounded-full shrink-0 ${DOT[r.status]}`} />
                        <span className={`text-[10px] font-mono font-semibold w-16 shrink-0 ${TEXT[r.status]}`}>{r.status}</span>
                        <span className="text-xs text-foreground flex-1 min-w-0 truncate">{r.label}</span>
                        <span className={`text-[10px] font-mono truncate max-w-[220px] ${TEXT[r.status]}`}>{r.detail}</span>
                        <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">{r.latency_ms}ms</span>
                      </summary>
                      <div className="px-4 pb-3 pl-12 space-y-1">
                        <div className="text-[10px] font-mono break-all">
                          <span className="text-muted-foreground">{r.id}</span>
                          {r.source ? <span className="text-sky-400/80"> · {r.source}</span> : null}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono break-words">check: {r.signal}</div>
                        {r.code ? (
                          <pre className="text-[10px] leading-snug font-mono whitespace-pre-wrap break-words bg-background/60 border border-border/50 rounded p-2 text-foreground/80 overflow-x-auto">{r.code}</pre>
                        ) : null}
                        <div className="text-[11px] font-mono break-words">
                          <span className="text-muted-foreground">result: </span>
                          <span className={TEXT[r.status]}>{r.detail}</span>
                        </div>
                        {r.evidence ? <div className="text-[10px] text-muted-foreground font-mono break-words">evidence: {r.evidence}</div> : null}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
