"use client";

import { useMemo } from "react";
import { Layers, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { TraceEvent } from "@/app/observability/page";

interface EventTimelineProps {
  events: TraceEvent[];
  activeGroupFilter: string | null;
  onGroupSelect: (groupKey: string | null) => void;
}

interface EventGroup {
  key: string;
  label: string;
  type: "task" | "session" | "module";
  events: TraceEvent[];
  firstTimestamp: string;
  lastTimestamp: string;
  errorCount: number;
  latestStatus: "ok" | "error" | "slow";
}

function formatTimeRange(first: string, last: string): string {
  try {
    const fmt = (iso: string) => {
      const d = new Date(iso);
      return `${d.getHours().toString().padStart(2, "0")}:${d
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;
    };
    const f = fmt(first);
    const l = fmt(last);
    return f === l ? f : `${f} - ${l}`;
  } catch {
    return "??:??";
  }
}

export function EventTimeline({
  events,
  activeGroupFilter,
  onGroupSelect,
}: EventTimelineProps) {
  const groups = useMemo(() => {
    const map = new Map<string, EventGroup>();

    for (const ev of events) {
      // Determine group key: prefer task_id, then session_id, fallback to module
      let key: string;
      let label: string;
      let type: "task" | "session" | "module";

      if (ev.meta?.task_id) {
        key = ev.meta.task_id;
        label = `Task: ${ev.meta.task_id}`;
        type = "task";
      } else if (ev.meta?.session_id) {
        key = ev.meta.session_id;
        label = `Session: ${ev.meta.session_id}`;
        type = "session";
      } else {
        key = ev.module;
        label = ev.module;
        type = "module";
      }

      const existing = map.get(key);
      if (existing) {
        existing.events.push(ev);
        if (ev.timestamp < existing.firstTimestamp)
          existing.firstTimestamp = ev.timestamp;
        if (ev.timestamp > existing.lastTimestamp)
          existing.lastTimestamp = ev.timestamp;
        const isError = !!(ev.error || ev.category === "error");
        if (isError) existing.errorCount++;
        if (isError) existing.latestStatus = "error";
        else if (ev.duration_ms > 500 && existing.latestStatus !== "error")
          existing.latestStatus = "slow";
      } else {
        const isError = !!(ev.error || ev.category === "error");
        map.set(key, {
          key,
          label,
          type,
          events: [ev],
          firstTimestamp: ev.timestamp,
          lastTimestamp: ev.timestamp,
          errorCount: isError ? 1 : 0,
          latestStatus: isError ? "error" : ev.duration_ms > 500 ? "slow" : "ok",
        });
      }
    }

    // Sort by most recent activity first
    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(b.lastTimestamp).getTime() -
        new Date(a.lastTimestamp).getTime()
    );
  }, [events]);

  const typeIcon: Record<string, string> = {
    task: "text-purple-400",
    session: "text-cyan-400",
    module: "text-muted-foreground",
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Event Timeline
        </span>
        <span className="text-[10px] text-muted-foreground/50 font-mono ml-auto">
          {groups.length} groups
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground/50">
            No events to group
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {groups.map((group, idx) => {
              const isActive = activeGroupFilter === group.key;
              return (
                <button
                  key={group.key || `group-${idx}`}
                  onClick={() =>
                    onGroupSelect(isActive ? null : group.key)
                  }
                  className={`w-full text-left px-4 py-2.5 hover:bg-accent/20 transition-colors ${
                    isActive ? "bg-accent/30 border-l-2 border-l-cyan-400" : ""
                  }`}
                >
                  {/* Group header */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono truncate flex-1 ${
                        typeIcon[group.type]
                      }`}
                    >
                      {group.label}
                    </span>
                    {/* Status icon */}
                    {group.latestStatus === "error" ? (
                      <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 text-green-400/50 shrink-0" />
                    )}
                  </div>

                  {/* Group stats */}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[9px] text-muted-foreground/60 font-mono">
                      {group.events.length} events
                    </span>
                    {group.errorCount > 0 && (
                      <span className="text-[9px] text-red-400/70 font-mono">
                        {group.errorCount} errors
                      </span>
                    )}
                    <span className="text-[9px] text-muted-foreground/40 font-mono flex items-center gap-1 ml-auto">
                      <Clock className="h-2.5 w-2.5" />
                      {formatTimeRange(
                        group.firstTimestamp,
                        group.lastTimestamp
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
