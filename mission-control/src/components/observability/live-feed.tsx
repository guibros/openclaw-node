"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Pause, Play, ChevronDown, ChevronRight } from "lucide-react";
import type { TraceEvent } from "@/app/observability/page";

interface LiveFeedProps {
  events: TraceEvent[];
  mode: "dev" | "smart";
}

const MODULE_COLORS: Record<string, string> = {
  "mesh-agent": "bg-cyan-500/20 text-cyan-400",
  "mesh-bridge": "bg-blue-500/20 text-blue-400",
  "task-daemon": "bg-purple-500/20 text-purple-400",
  "cas": "bg-orange-500/20 text-orange-400",
  "shell": "bg-green-500/20 text-green-400",
  "scheduler": "bg-yellow-500/20 text-yellow-400",
  "sync": "bg-teal-500/20 text-teal-400",
  "nats": "bg-pink-500/20 text-pink-400",
};

function getModuleColor(mod: string): string {
  if (!mod) return "bg-gray-500/20 text-gray-400";
  if (MODULE_COLORS[mod]) return MODULE_COLORS[mod];
  // Deterministic fallback based on hash
  const hash = mod.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const palette = [
    "bg-emerald-500/20 text-emerald-400",
    "bg-violet-500/20 text-violet-400",
    "bg-rose-500/20 text-rose-400",
    "bg-amber-500/20 text-amber-400",
    "bg-indigo-500/20 text-indigo-400",
    "bg-lime-500/20 text-lime-400",
  ];
  return palette[hash % palette.length];
}

function formatTimestamp(iso: string | number): string {
  try {
    const d = new Date(iso);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    const s = d.getSeconds().toString().padStart(2, "0");
    const ms = d.getMilliseconds().toString().padStart(3, "0");
    return `${h}:${m}:${s}.${ms}`;
  } catch {
    return "??:??:??.???";
  }
}

function getRowColor(event: TraceEvent): string {
  if (event.error || event.category === "error") return "border-l-red-500";
  if (event.duration_ms > 500) return "border-l-yellow-500";
  if (event.category === "state_transition" || event.category === "lifecycle")
    return "border-l-blue-500";
  return "border-l-green-500/50";
}

function getDurationColor(ms: number): string {
  if (ms > 2000) return "text-red-400";
  if (ms > 500) return "text-yellow-400";
  if (ms > 100) return "text-foreground/60";
  return "text-muted-foreground/50";
}

function EventRow({ event, mode }: { event: TraceEvent; mode: "dev" | "smart" }) {
  const [expanded, setExpanded] = useState(false);
  const rowColor = getRowColor(event);

  return (
    <div className={`border-l-2 ${rowColor}`}>
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/20 cursor-pointer transition-colors"
      >
        {/* Expand indicator */}
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        )}

        {/* Timestamp */}
        <span className="text-[10px] font-mono text-muted-foreground/60 w-[80px] shrink-0 tabular-nums">
          {formatTimestamp(event.timestamp)}
        </span>

        {/* Module badge */}
        <span
          className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${getModuleColor(event.module)}`}
        >
          {event.module}
        </span>

        {/* Function name */}
        <span className="text-[11px] font-mono text-foreground/80 truncate">
          {event.function}
        </span>

        {/* Duration */}
        <span
          className={`text-[10px] font-mono ml-auto shrink-0 tabular-nums ${getDurationColor(event.duration_ms)}`}
        >
          {event.duration_ms}ms
        </span>

        {/* Status indicator */}
        <span className="shrink-0">
          {event.error || event.category === "error" ? (
            <span className="text-[9px] font-bold text-red-400">ERR</span>
          ) : event.duration_ms > 500 ? (
            <span className="text-[9px] font-bold text-yellow-400">SLOW</span>
          ) : (
            <span className="text-[9px] text-green-400/60">OK</span>
          )}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-10 pb-2 space-y-1">
          {event.node_id && (
            <div className="flex gap-2 text-[10px]">
              <span className="text-muted-foreground/50 w-16 shrink-0">node</span>
              <span className="text-foreground/60 font-mono">{event.node_id}</span>
            </div>
          )}
          {event.args_summary && (
            <div className="flex gap-2 text-[10px]">
              <span className="text-muted-foreground/50 w-16 shrink-0">args</span>
              <span className="text-foreground/60 font-mono break-all">
                {event.args_summary}
              </span>
            </div>
          )}
          {event.result_summary && (
            <div className="flex gap-2 text-[10px]">
              <span className="text-muted-foreground/50 w-16 shrink-0">result</span>
              <span className="text-foreground/60 font-mono break-all">
                {event.result_summary}
              </span>
            </div>
          )}
          {(event.error || event.error_message) && (
            <div className="flex gap-2 text-[10px]">
              <span className="text-red-400/70 w-16 shrink-0">error</span>
              <span className="text-red-400/80 font-mono break-all">
                {event.error || event.error_message}
              </span>
            </div>
          )}
          {event.meta && typeof event.meta === "object" && Object.keys(event.meta).length > 0 && (
            <div className="flex gap-2 text-[10px]">
              <span className="text-muted-foreground/50 w-16 shrink-0">meta</span>
              <span className="text-foreground/40 font-mono break-all">
                {JSON.stringify(event.meta)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LiveFeed({ events, mode }: LiveFeedProps) {
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    wasAtBottomRef.current = atBottom;
    if (!atBottom && !paused) {
      setPaused(true);
    }
  }, [paused]);

  // Auto-scroll to bottom when new events arrive (if not paused)
  useEffect(() => {
    if (paused) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length, paused]);

  const handleResume = () => {
    setPaused(false);
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // In smart mode, filter to only errors and slow events
  const displayEvents =
    mode === "smart"
      ? events.filter(
          (e) => e.error || e.category === "error" || e.duration_ms > 500
        )
      : events;

  return (
    <div className="h-full flex flex-col">
      {/* Feed header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Live Feed
          </span>
          <span className="text-[10px] text-muted-foreground/50 font-mono">
            {displayEvents.length} events
          </span>
        </div>
        <button
          onClick={paused ? handleResume : () => setPaused(true)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent/30"
        >
          {paused ? (
            <>
              <Play className="h-3 w-3" />
              Resume
            </>
          ) : (
            <>
              <Pause className="h-3 w-3" />
              Pause
            </>
          )}
        </button>
      </div>

      {/* Event list */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono"
      >
        {displayEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground/50">
            {mode === "smart"
              ? "No errors or slow events detected"
              : "Waiting for trace events..."}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {/* Show events in chronological order (oldest first) for feed feel */}
            {[...displayEvents].reverse().map((event) => (
              <EventRow key={event.id} event={event} mode={mode} />
            ))}
          </div>
        )}
      </div>

      {/* Paused indicator */}
      {paused && (
        <div className="border-t border-yellow-500/30 bg-yellow-500/5 px-4 py-1.5 text-center">
          <span className="text-[10px] text-yellow-400/80">
            Auto-scroll paused — click Resume to follow new events
          </span>
        </div>
      )}
    </div>
  );
}
