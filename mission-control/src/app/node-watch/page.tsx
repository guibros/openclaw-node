"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";

interface WatchResult {
  id: string;
  family: string;
  label: string;
  signal: string;
  status: "WORKING" | "BROKEN" | "OFF" | "UNKNOWN";
  detail: string;
  evidence?: string;
  latency_ms: number;
}

interface WatchReport {
  meta: { nodeId: string; mode: string; timestamp: string | null };
  counts: Record<string, number>;
  results: WatchResult[];
  missing?: boolean;
  hint?: string;
  error?: string;
  fileMtime?: string;
  fileAgeMs?: number;
}

const COLOR: Record<string, string> = {
  WORKING: "text-green-400", BROKEN: "text-red-400", OFF: "text-zinc-500", UNKNOWN: "text-yellow-400",
};
const DOT: Record<string, string> = {
  WORKING: "bg-green-400", BROKEN: "bg-red-400", OFF: "bg-zinc-500", UNKNOWN: "bg-yellow-400",
};
const BORDER: Record<string, string> = {
  WORKING: "border-green-500/40", BROKEN: "border-red-500/40", OFF: "border-zinc-500/40", UNKNOWN: "border-yellow-500/40",
};
const ORDER = ["WORKING", "BROKEN", "OFF", "UNKNOWN"] as const;

export default function NodeWatchPage() {
  const [report, setReport] = useState<WatchReport | null>(null);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWatch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/node-watch");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: WatchReport = await res.json();
      setReport(d);
      const firstBroken = d.results.findIndex((r) => r.status === "BROKEN");
      setSel(firstBroken >= 0 ? firstBroken : 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatch();
  }, [fetchWatch]);

  const results = report?.results ?? [];
  const families = Array.from(new Set(results.map((r) => r.family)));
  const current = results[sel];

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">Node Watch</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real per-component status — WORKING / BROKEN / OFF / UNKNOWN
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

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* tally */}
        <div className="flex flex-wrap gap-3">
          {ORDER.map((s) => (
            <span key={s} className={`text-xs font-mono ${COLOR[s]}`}>{s} {report?.counts?.[s] ?? 0}</span>
          ))}
          {report?.fileMtime && (
            <span className="text-[10px] text-muted-foreground/60 ml-auto">
              snapshot {report.fileMtime}{typeof report.fileAgeMs === "number" ? ` (${Math.round(report.fileAgeMs / 1000)}s ago)` : ""} — node={report.meta?.nodeId}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">{error}</div>
        )}

        {report?.missing && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-400">{report.hint}</div>
        )}

        {results.length > 0 && (
          <>
            {/* dropdown of every checked item + result */}
            <div>
              <label htmlFor="nw" className="block text-xs text-muted-foreground mb-1">
                Items checked ({results.length}) — select to see the result
              </label>
              <select
                id="nw"
                value={sel}
                onChange={(e) => setSel(Number(e.target.value))}
                className="block w-full max-w-xl rounded-md border border-border bg-card text-foreground text-xs px-3 py-2"
              >
                {families.map((fam) => (
                  <optgroup key={fam} label={fam}>
                    {results.map((r, i) => (r.family === fam ? (
                      <option key={r.id} value={i}>{r.status} — {r.label}</option>
                    ) : null))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* detail panel */}
            {current && (
              <div className={`rounded-lg border bg-card p-4 ${BORDER[current.status] || "border-border"}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`h-2 w-2 rounded-full ${DOT[current.status]}`} />
                  <span className={`text-xs font-semibold ${COLOR[current.status]}`}>{current.status}</span>
                  <span className="text-sm font-semibold text-foreground">{current.label}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{current.latency_ms}ms</span>
                </div>
                <dl className="space-y-1">
                  <Row k="family" v={current.family} />
                  <Row k="signal" v={current.signal} />
                  <Row k="detail" v={current.detail} />
                  {current.evidence ? <Row k="evidence" v={current.evidence} /> : null}
                </dl>
              </div>
            )}

            {/* full grouped list */}
            <div className="space-y-4">
              {families.map((fam) => (
                <div key={fam} className="rounded-lg border border-border bg-card">
                  <div className="px-4 py-2 border-b border-border/50 text-xs font-semibold text-foreground">{fam}</div>
                  <div className="divide-y divide-border/30">
                    {results.map((r, i) => (r.family === fam ? (
                      <button
                        key={r.id}
                        onClick={() => setSel(i)}
                        className="w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-accent/40 transition-colors"
                      >
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${DOT[r.status]}`} />
                        <span className={`text-[10px] font-mono w-16 shrink-0 ${COLOR[r.status]}`}>{r.status}</span>
                        <span className="text-xs text-foreground flex-1">{r.label}</span>
                        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[280px]">{r.detail}</span>
                      </button>
                    ) : null))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</dt>
      <dd className="text-xs font-mono text-foreground break-words">{v}</dd>
    </div>
  );
}
