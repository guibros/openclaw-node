"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import { SystemMap } from "@/components/observability/system-map";
import { LiveFeed } from "@/components/observability/live-feed";
import { EventTimeline } from "@/components/observability/event-timeline";
import { Activity, Filter, Search } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Mode = "dev" | "smart";

export interface TraceEvent {
  id: string;
  timestamp: string;
  node_id: string;
  module: string;
  function: string;
  duration_ms: number;
  status: "ok" | "error" | "slow";
  args_summary?: string;
  result_summary?: string;
  error_message?: string;
  meta?: Record<string, string>;
  category?: string;
}

export default function ObservabilityPage() {
  const [mode, setMode] = useState<Mode>("dev");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [filterNode, setFilterNode] = useState<string>("all");
  const [filterModule, setFilterModule] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [activeGroupFilter, setActiveGroupFilter] = useState<string | null>(null);
  const eventIdSet = useRef(new Set<string>());

  // Fetch nodes for filter dropdowns and system map
  const { data: nodesData } = useSWR<{
    nodes: Array<{
      nodeId: string;
      platform: string;
      status: string;
      daemons: Array<{ name: string; status: string; lastEventAt?: string }>;
    }>;
  }>("/api/observability/nodes", fetcher, { refreshInterval: 5000 });

  // Fetch historical events on load
  const { data: historyData } = useSWR<{ events: TraceEvent[] }>(
    "/api/observability/events?hours=2",
    fetcher,
    { revalidateOnFocus: false }
  );

  // Seed historical events once
  useEffect(() => {
    if (historyData?.events) {
      setEvents((prev) => {
        const merged = [...historyData.events];
        const ids = new Set(merged.map((e) => e.id));
        for (const ev of prev) {
          if (!ids.has(ev.id)) merged.push(ev);
        }
        merged.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        const trimmed = merged.slice(0, 500);
        eventIdSet.current = new Set(trimmed.map((e) => e.id));
        return trimmed;
      });
    }
  }, [historyData]);

  // SSE for live trace events
  const handleTraceEvent = useCallback((ev: TraceEvent) => {
    if (eventIdSet.current.has(ev.id)) return;
    eventIdSet.current.add(ev.id);
    setEvents((prev) => {
      const next = [ev, ...prev].slice(0, 500);
      // Prune id set when we drop events
      if (next.length < prev.length + 1) {
        eventIdSet.current = new Set(next.map((e) => e.id));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/observability/stream");
    es.addEventListener("trace", (e) => {
      try {
        handleTraceEvent(JSON.parse(e.data));
      } catch {}
    });
    es.onerror = () => {
      // EventSource auto-reconnects
    };
    return () => es.close();
  }, [handleTraceEvent]);

  // Derive filter options from events + nodes
  const nodeOptions = Array.from(new Set(events.map((e) => e.node_id))).sort();
  const moduleOptions = Array.from(new Set(events.map((e) => e.module))).sort();
  const categoryOptions = Array.from(
    new Set(events.map((e) => e.category).filter(Boolean))
  ).sort() as string[];

  // Apply filters
  const filtered = events.filter((e) => {
    if (filterNode !== "all" && e.node_id !== filterNode) return false;
    if (filterModule !== "all" && e.module !== filterModule) return false;
    if (filterCategory !== "all" && e.category !== filterCategory) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const haystack =
        `${e.module} ${e.function} ${e.args_summary ?? ""} ${e.result_summary ?? ""} ${e.error_message ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (activeGroupFilter) {
      const groupKey =
        e.meta?.task_id || e.meta?.session_id || e.module;
      if (groupKey !== activeGroupFilter) return false;
    }
    return true;
  });

  const nodes = nodesData?.nodes ?? [];

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-6 py-3 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">
            Observability
          </h1>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs ml-4">
          <button
            onClick={() => setMode("dev")}
            className={`px-3 py-1.5 transition-colors ${
              mode === "dev"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            Dev
          </button>
          <button
            onClick={() => setMode("smart")}
            className={`px-3 py-1.5 transition-colors ${
              mode === "smart"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            Smart
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 ml-4">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={filterNode}
            onChange={(e) => setFilterNode(e.target.value)}
            className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
          >
            <option value="all">All Nodes</option>
            {nodeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select
            value={filterModule}
            onChange={(e) => setFilterModule(e.target.value)}
            className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
          >
            <option value="all">All Modules</option>
            {moduleOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
          >
            <option value="all">All Categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="text-xs bg-card border border-border rounded pl-6 pr-2 py-1 text-foreground w-40 placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        {/* Event count */}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {activeGroupFilter && (
            <button
              onClick={() => setActiveGroupFilter(null)}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Clear filter
            </button>
          )}
          <span className="font-mono">
            {filtered.length} / {events.length} events
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* System Map */}
        <div className="border-b border-border shrink-0">
          <SystemMap nodes={nodes} events={events} />
        </div>

        {/* Bottom panels: Timeline + LiveFeed */}
        <div className="flex-1 grid grid-cols-[320px_1fr] min-h-0">
          <div className="border-r border-border overflow-y-auto">
            <EventTimeline
              events={filtered}
              activeGroupFilter={activeGroupFilter}
              onGroupSelect={setActiveGroupFilter}
            />
          </div>
          <div className="overflow-hidden">
            <LiveFeed events={filtered} mode={mode} />
          </div>
        </div>
      </div>
    </div>
  );
}
