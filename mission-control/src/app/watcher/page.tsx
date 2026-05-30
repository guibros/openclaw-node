"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Database, HardDrive } from "lucide-react";
import { useWatcher, WatcherEvent, WatcherHealth } from "@/lib/hooks";

function statusColor(status?: string): string {
  if (status === "error") return "text-red-400";
  if (status === "noop") return "text-yellow-400";
  return "text-green-400";
}

function statusBg(status?: string): string {
  if (status === "error") return "bg-red-500/10";
  if (status === "noop") return "bg-yellow-500/10";
  return "";
}

function statusBadge(status?: string): string {
  if (status === "error") return "bg-red-500/20 text-red-400";
  if (status === "noop") return "bg-yellow-500/20 text-yellow-400";
  return "bg-green-500/20 text-green-400";
}

function fmtTs(ts: string): string {
  try {
    const d = new Date(ts);
    return (
      d.getHours().toString().padStart(2, "0") +
      ":" +
      d.getMinutes().toString().padStart(2, "0") +
      ":" +
      d.getSeconds().toString().padStart(2, "0")
    );
  } catch {
    return "??:??:??";
  }
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function opLabel(op: string): string {
  return op.replace("memory.", "");
}

function HealthCard({ health }: { health: WatcherHealth }) {
  const stores = health.stores;
  const drift = health.drift;
  return (
    <div className="grid grid-cols-4 gap-3 px-4 py-3 border-b border-border bg-card/50">
      {stores?.state && (
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-[11px] font-mono">
            <span className="text-foreground">state.db</span>
            <span className="text-muted-foreground ml-2">
              {stores.state.sessions} sess / {stores.state.entities} ent
            </span>
            {stores.state.wal_size != null && (
              <span className="text-muted-foreground ml-1">
                WAL {(stores.state.wal_size / 1048576).toFixed(1)}MB
              </span>
            )}
          </div>
        </div>
      )}
      {stores?.knowledge && (
        <div className="flex items-center gap-2">
          <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-[11px] font-mono">
            <span className="text-foreground">knowledge.db</span>
            <span className="text-muted-foreground ml-2">
              {stores.knowledge.session_docs} docs
            </span>
            {stores.knowledge.wal_size != null && (
              <span className="text-muted-foreground ml-1">
                WAL {(stores.knowledge.wal_size / 1048576).toFixed(1)}MB
              </span>
            )}
          </div>
        </div>
      )}
      {stores?.graph_cache && (
        <div className="flex items-center gap-2">
          <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-[11px] font-mono">
            <span className="text-foreground">graph-cache</span>
            <span className="text-muted-foreground ml-2">
              {stores.graph_cache.nodes} nodes / {stores.graph_cache.edges} edges
            </span>
          </div>
        </div>
      )}
      {drift && (
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-[11px] font-mono">
            <span className="text-foreground">drift</span>
            <span className={`ml-2 ${drift.lib_symlink && drift.daemon_symlink ? "text-green-400" : "text-red-400"}`}>
              {drift.lib_symlink && drift.daemon_symlink ? "synced" : "DRIFTED"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: WatcherEvent }) {
  return (
    <div className={`flex items-center gap-0 px-4 py-[3px] font-mono text-[11px] border-b border-border/40 ${statusBg(event.status)}`}>
      <span className="text-muted-foreground w-[65px] shrink-0 tabular-nums">
        {fmtTs(event.ts)}
      </span>
      <span className={`w-[50px] shrink-0 ${statusColor(event.status)}`}>
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadge(event.status)}`}>
          {event.status || "ok"}
        </span>
      </span>
      <span className="text-foreground w-[100px] shrink-0 truncate">
        {opLabel(event.op)}
      </span>
      <span className="text-muted-foreground truncate flex-1 min-w-0">
        {event.session ? event.session.slice(0, 12) : ""}
        {event.actor ? ` (${event.actor})` : ""}
      </span>
      <span className={`w-[55px] shrink-0 text-right tabular-nums ${statusColor(event.status)}`}>
        {fmtDuration(event.duration_ms)}
      </span>
    </div>
  );
}

export default function WatcherPage() {
  const [view, setView] = useState<"stream" | "failures">("stream");

  const { events: allEvents, health, isLoading } = useWatcher(100);
  const { events: failureEvents } = useWatcher(100, "noop");
  const { events: errorEvents } = useWatcher(50, "error");

  const failures = [...failureEvents, ...errorEvents]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 100);

  const displayEvents = view === "stream" ? allEvents : failures;

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Memory Watcher</span>
        </div>

        {/* View tabs */}
        <div className="flex gap-1 ml-4">
          <button
            onClick={() => setView("stream")}
            className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
              view === "stream"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            Stream
          </button>
          <button
            onClick={() => setView("failures")}
            className={`text-xs px-3 py-1.5 rounded font-medium transition-colors flex items-center gap-1.5 ${
              view === "failures"
                ? "bg-yellow-500/10 text-yellow-400"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            Silent Failures
            {failures.length > 0 && (
              <span className="bg-yellow-500/20 text-yellow-400 text-[10px] px-1.5 py-0.5 rounded-full">
                {failures.length}
              </span>
            )}
          </button>
        </div>

        {/* Stats */}
        <div className="ml-auto flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
          <span>{displayEvents.length} events</span>
          {isLoading && <span className="text-primary animate-pulse">polling...</span>}
        </div>
      </div>

      {/* Health card */}
      {health && <HealthCard health={health} />}

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {displayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            {view === "failures" ? (
              <>
                <AlertTriangle className="h-6 w-6 text-green-400" />
                <span className="text-sm">No silent failures detected</span>
              </>
            ) : (
              <>
                <Activity className="h-6 w-6" />
                <span className="text-sm">No events yet</span>
              </>
            )}
          </div>
        ) : (
          displayEvents.map((event, i) => (
            <EventRow key={`${event.ts}-${event.op}-${i}`} event={event} />
          ))
        )}
      </div>
    </div>
  );
}
