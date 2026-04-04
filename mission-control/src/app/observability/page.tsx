"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import { Search, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface TraceEvent {
  id: string;
  timestamp: string | number;
  node_id: string;
  module: string;
  function: string;
  duration_ms: number;
  tier?: number;
  category?: string;
  args_summary?: string;
  result_summary?: string;
  error?: string | null;
  error_message?: string;
  meta?: Record<string, string> | string | null;
}

// ── Color helpers ──────────────────────────────────────

const MODULE_COLORS: Record<string, string> = {
  "mesh-agent": "text-cyan-400",
  "mesh-bridge": "text-blue-400",
  "mesh-task-daemon": "text-purple-400",
  "memory-daemon": "text-amber-400",
  "mesh-health-publisher": "text-pink-400",
  "mesh-deploy-listener": "text-teal-400",
  observability: "text-gray-400",
};

function modColor(mod: string): string {
  if (MODULE_COLORS[mod]) return MODULE_COLORS[mod];
  const hash = mod.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const p = [
    "text-emerald-400",
    "text-violet-400",
    "text-rose-400",
    "text-indigo-400",
    "text-lime-400",
    "text-orange-400",
  ];
  return p[hash % p.length];
}

function levelColor(e: TraceEvent): string {
  if (e.error || e.category === "error") return "text-red-400";
  if (e.duration_ms > 2000) return "text-red-400";
  if (e.duration_ms > 500) return "text-yellow-400";
  return "text-foreground/50";
}

function levelTag(e: TraceEvent): string {
  if (e.error || e.category === "error") return "ERR ";
  if (e.function?.startsWith("log.")) {
    const lvl = e.function.split(".")[1] || "info";
    return (lvl.toUpperCase() + " ").slice(0, 5).padEnd(5);
  }
  if (e.duration_ms > 500) return "SLOW";
  return "    ";
}

function fmtTs(ts: string | number): string {
  try {
    const d = new Date(ts);
    return (
      d.getHours().toString().padStart(2, "0") +
      ":" +
      d.getMinutes().toString().padStart(2, "0") +
      ":" +
      d.getSeconds().toString().padStart(2, "0") +
      "." +
      d.getMilliseconds().toString().padStart(3, "0")
    );
  } catch {
    return "??:??:??.???";
  }
}

function fmtDuration(ms: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Main page ──────────────────────────────────────────

export default function ObservabilityPage() {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [filterModule, setFilterModule] = useState<string>("all");
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [follow, setFollow] = useState(true);
  const [limit, setLimit] = useState(500);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventIdSet = useRef(new Set<string>());

  // Fetch all events from DB — no artificial cap, real data
  const { data: historyData, mutate } = useSWR<{ events: TraceEvent[] }>(
    `/api/observability/events?hours=24&limit=${limit}`,
    fetcher,
    { refreshInterval: 3000 }
  );

  // Seed events
  useEffect(() => {
    if (!historyData?.events) return;
    const incoming = historyData.events;
    const ids = new Set(incoming.map((e) => e.id));
    eventIdSet.current = ids;
    setEvents(incoming);
  }, [historyData]);

  // Auto-scroll to bottom when following
  useEffect(() => {
    if (!follow) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events, follow]);

  // Detect user scroll to pause follow
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (!atBottom && follow) setFollow(false);
    if (atBottom && !follow) setFollow(true);
  }, [follow]);

  // Derive filter options from data
  const moduleOptions = Array.from(
    new Set(events.map((e) => e.module).filter(Boolean))
  ).sort();

  // Apply filters
  const filtered = events.filter((e) => {
    if (filterModule !== "all" && e.module !== filterModule) return false;
    if (filterLevel === "error" && !e.error && e.category !== "error") return false;
    if (filterLevel === "warn" && !e.error && e.category !== "error" && e.duration_ms <= 500) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const haystack = `${e.module} ${e.function} ${e.args_summary ?? ""} ${e.result_summary ?? ""} ${e.error ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Show newest at bottom (chronological terminal style)
  const display = [...filtered].reverse();

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#21262d] shrink-0 bg-[#161b22]">
        <span className="text-xs font-bold text-[#58a6ff] tracking-wide">
          TRACE LOG
        </span>

        {/* Module filter */}
        <select
          value={filterModule}
          onChange={(e) => setFilterModule(e.target.value)}
          className="text-[11px] bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-[#c9d1d9] font-mono"
        >
          <option value="all">all modules</option>
          {moduleOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {/* Level filter */}
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="text-[11px] bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-[#c9d1d9] font-mono"
        >
          <option value="all">all levels</option>
          <option value="warn">warn+err+slow</option>
          <option value="error">errors only</option>
        </select>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="h-3 w-3 text-[#484f58] absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="grep..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="text-[11px] bg-[#0d1117] border border-[#30363d] rounded pl-6 pr-2 py-1 text-[#c9d1d9] w-full font-mono placeholder:text-[#484f58]"
          />
        </div>

        {/* Count + controls */}
        <span className="text-[11px] text-[#484f58] font-mono ml-auto">
          {filtered.length}/{events.length}
        </span>

        {limit <= events.length && (
          <button
            onClick={() => setLimit((l) => l + 500)}
            className="text-[10px] text-[#58a6ff] hover:text-[#79c0ff] font-mono px-2 py-1 rounded hover:bg-[#1f2937]"
          >
            load more
          </button>
        )}

        <button
          onClick={() => mutate()}
          className="text-[#484f58] hover:text-[#c9d1d9] p-1 rounded hover:bg-[#1f2937]"
          title="Refresh"
        >
          <RotateCcw className="h-3 w-3" />
        </button>

        <button
          onClick={() => {
            setFollow(!follow);
            if (!follow) {
              const el = containerRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }
          }}
          className={`text-[10px] font-mono px-2 py-1 rounded ${
            follow
              ? "text-green-400 bg-green-400/10"
              : "text-[#484f58] hover:text-[#c9d1d9] hover:bg-[#1f2937]"
          }`}
        >
          {follow ? (
            <span className="flex items-center gap-1">
              <ChevronDown className="h-3 w-3" /> follow
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <ChevronUp className="h-3 w-3" /> paused
            </span>
          )}
        </button>
      </div>

      {/* Log stream */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-[11px] leading-[18px]"
      >
        {display.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#484f58]">
            no events
          </div>
        ) : (
          display.map((e) => {
            const isErr = !!(e.error || e.category === "error");
            const isSlow = e.duration_ms > 500;
            const rowBg = isErr
              ? "bg-red-500/5 hover:bg-red-500/10"
              : isSlow
                ? "bg-yellow-500/5 hover:bg-yellow-500/10"
                : "hover:bg-[#161b22]";

            return (
              <div key={e.id} className={`flex gap-0 px-3 py-[2px] ${rowBg} border-b border-[#21262d]/40`}>
                {/* Timestamp */}
                <span className="text-[#484f58] w-[85px] shrink-0 tabular-nums">
                  {fmtTs(e.timestamp)}
                </span>

                {/* Level tag */}
                <span className={`w-[40px] shrink-0 ${levelColor(e)}`}>
                  {levelTag(e)}
                </span>

                {/* Module — fixed width */}
                <span className={`w-[140px] shrink-0 truncate ${modColor(e.module)}`}>
                  {e.module}
                </span>

                {/* Function */}
                <span className="text-[#e6edf3] w-[200px] shrink-0 truncate">
                  {e.function}
                </span>

                {/* Args summary — the actual useful info, fills remaining space */}
                <span className="text-[#8b949e] truncate flex-1 min-w-0">
                  {e.args_summary || ""}
                </span>

                {/* Duration */}
                <span className={`w-[55px] shrink-0 text-right tabular-nums ${levelColor(e)}`}>
                  {fmtDuration(e.duration_ms)}
                </span>

                {/* Error indicator */}
                {isErr && (
                  <span className="text-red-500 ml-1 shrink-0" title={e.error || ""}>
                    ✗
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
