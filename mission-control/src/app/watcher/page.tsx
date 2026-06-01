"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Bell, Database, HardDrive } from "lucide-react";
import { useWatcher, useMemoryContent, WatcherEvent, WatcherAlert, WatcherHealth } from "@/lib/hooks";

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

// Per-op one-line summary of WHAT the op did, pulled from the full event payload.
function eventDetail(op: string, data: Record<string, unknown> | null | undefined): string {
  if (!data) return "";
  const n = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : undefined);
  switch (op) {
    case "memory.extracted": {
      const parts = [
        n("entities_count") !== undefined ? `${n("entities_count")} ent` : null,
        n("themes_count") !== undefined ? `${n("themes_count")} themes` : null,
        n("decisions_count") !== undefined ? `${n("decisions_count")} dec` : null,
      ].filter(Boolean);
      const model = data.model ? ` · ${data.model}` : "";
      return parts.join(", ") + model;
    }
    case "memory.synthesized": {
      const arr = Array.isArray(data.artifacts_written) ? (data.artifacts_written as string[]) : [];
      const trigger = data.trigger ? `${data.trigger}: ` : "";
      if (arr.length === 0) return `${trigger}no files`;
      const names = arr.map((p) => p.split("/").pop()).slice(0, 3).join(", ");
      return `${trigger}${arr.length} files — ${names}${arr.length > 3 ? "…" : ""}`;
    }
    case "memory.retrieved":
      return `${n("results_count") ?? 0} results / ${n("channels_hit") ?? 0} channels`;
    case "memory.injected":
      return `${n("blocks_count") ?? 0} blocks, ${n("token_count") ?? n("tokens") ?? 0} tok`;
    case "memory.ingested":
      return `${n("messages_added") ?? 0} msgs from ${data.source ?? "?"}`;
    case "memory.promoted":
      return `${n("entities_promoted") ?? 0} promoted`;
    case "memory.decayed":
      return `${n("entities_decayed") ?? 0} decayed`;
    case "memory.error":
      return String(data.error_message ?? data.error_code ?? data.boundary ?? "error");
    default:
      return "";
  }
}

function alertTypeLabel(t: string): string {
  switch (t) {
    case "extraction_failure": return "extraction failure";
    case "extraction_failure_rate": return "failure rate";
    case "stalled": return "stalled";
    default: return t;
  }
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

// One labeled key/value row in the tree (indented under a section).
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2 leading-[1.5]">
      <span className="text-muted-foreground shrink-0 w-[120px] text-right">{k}</span>
      <span className="text-foreground min-w-0 break-words">{v}</span>
    </div>
  );
}

// A collapsible-looking section header in the tree.
function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1 mt-2 first:mt-0">
        {title}{count !== undefined ? ` (${count})` : ""}
      </div>
      <div className="border-l border-border/60 pl-3 space-y-0.5">{children}</div>
    </div>
  );
}

function fmtVal(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-muted-foreground/50">—</span>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-muted-foreground/50">[]</span>;
    return (
      <div className="space-y-0.5">
        {v.map((item, i) => (
          <div key={i} className="truncate">
            {typeof item === "string" ? item.split("/").pop() : JSON.stringify(item)}
          </div>
        ))}
      </div>
    );
  }
  if (typeof v === "object") return <span className="font-mono">{JSON.stringify(v)}</span>;
  return String(v);
}

// Full detail panel for one event: the interaction spec + payload + content touched.
function EventDetailPanel({ event }: { event: WatcherEvent }) {
  const session = event.session || undefined;
  const { decisions, entities, themes, isLoading } = useMemoryContent(undefined, session);
  const data = (event.data as Record<string, unknown> | null) || {};
  const dataKeys = Object.keys(data).filter((k) => k !== "session_id");

  return (
    <div className="px-4 py-3 bg-muted/20 border-b border-border/40 font-mono text-[11px]">
      <div className="border-l-2 border-primary/40 pl-3 space-y-1">
        {/* The interaction spec — every field of the event itself */}
        <Section title="Event">
          <KV k="operation" v={event.op} />
          <KV k="status" v={<span className={statusColor(event.status)}>{event.status || "ok"}</span>} />
          <KV k="timestamp" v={new Date(event.ts).toLocaleString()} />
          <KV k="duration" v={fmtDuration(event.duration_ms) || "—"} />
          {event.actor && <KV k="actor" v={event.actor} />}
          {event.session && <KV k="session" v={event.session} />}
        </Section>

        {/* The full payload the op emitted */}
        {dataKeys.length > 0 && (
          <Section title="Payload">
            {dataKeys.map((k) => (
              <KV key={k} k={k} v={fmtVal(data[k])} />
            ))}
          </Section>
        )}

        {/* The actual stored content this session touched */}
        {session && (
          isLoading ? (
            <div className="text-muted-foreground mt-2">loading content…</div>
          ) : entities.length === 0 && decisions.length === 0 && themes.length === 0 ? (
            <div className="text-muted-foreground/60 italic mt-2">No stored content tied to this session.</div>
          ) : (
            <>
              {entities.length > 0 && (
                <Section title="Entities touched" count={entities.length}>
                  <div className="flex flex-wrap gap-1">
                    {entities.slice(0, 40).map((e, i) => (
                      <span key={i} className="rounded bg-muted/60 px-1.5 py-0.5">
                        {e.name} <span className="text-muted-foreground/60">{e.type}</span>
                      </span>
                    ))}
                  </div>
                </Section>
              )}
              {decisions.length > 0 && (
                <Section title="Decisions" count={decisions.length}>
                  {decisions.slice(0, 12).map((d, i) => (
                    <div key={i} className="leading-snug">
                      <span className="text-foreground">• {d.decision}</span>
                      <span className="text-muted-foreground"> — {d.rationale}</span>
                      <span className="text-muted-foreground/60"> ({(d.confidence * 100).toFixed(0)}%)</span>
                    </div>
                  ))}
                </Section>
              )}
              {themes.length > 0 && (
                <Section title="Themes" count={themes.length}>
                  {themes.slice(0, 12).map((t, i) => (
                    <div key={i}>
                      <span className="text-foreground">{t.label}</span>
                      {t.hierarchy.length > 0 && (
                        <span className="text-muted-foreground/60"> · {t.hierarchy.join(" › ")}</span>
                      )}
                    </div>
                  ))}
                </Section>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: WatcherEvent }) {
  const [open, setOpen] = useState(false);
  // Every memory.* event is drillable — the panel always shows the interaction
  // spec + payload; session content is added when the event carries a session.
  const drillable = event.op.startsWith("memory.");
  return (
    <>
      <div
        onClick={() => drillable && setOpen((o) => !o)}
        className={`flex items-center gap-0 px-4 py-[3px] font-mono text-[11px] border-b border-border/40 ${statusBg(event.status)} ${drillable ? "cursor-pointer hover:bg-muted/40" : ""}`}
      >
        <span className="text-muted-foreground w-[65px] shrink-0 tabular-nums">
          {fmtTs(event.ts)}
        </span>
        <span className={`w-[50px] shrink-0 ${statusColor(event.status)}`}>
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadge(event.status)}`}>
            {event.status || "ok"}
          </span>
        </span>
        <span className="text-foreground w-[100px] shrink-0 truncate">
          {drillable ? (open ? "▾ " : "▸ ") : ""}{opLabel(event.op)}
        </span>
        <span className="truncate flex-1 min-w-0">
          <span className="text-foreground">
            {eventDetail(event.op, event.data as Record<string, unknown> | null)}
          </span>
          {event.session ? (
            <span className="text-muted-foreground"> · {event.session.slice(0, 8)}</span>
          ) : null}
        </span>
        <span className={`w-[55px] shrink-0 text-right tabular-nums ${statusColor(event.status)}`}>
          {fmtDuration(event.duration_ms)}
        </span>
      </div>
      {open && <EventDetailPanel event={event} />}
    </>
  );
}

function AlertRow({ alert }: { alert: WatcherAlert }) {
  return (
    <div className="flex items-center gap-0 px-4 py-[3px] font-mono text-[11px] border-b border-border/40 bg-red-500/10">
      <span className="text-muted-foreground w-[65px] shrink-0 tabular-nums">
        {fmtTs(alert.ts)}
      </span>
      <span className="w-[100px] shrink-0">
        <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400">
          {alertTypeLabel(alert.alert_type)}
        </span>
      </span>
      <span className="text-red-300 truncate flex-1 min-w-0">
        {alert.detail}
      </span>
    </div>
  );
}

export default function WatcherPage() {
  const [view, setView] = useState<"stream" | "failures" | "alerts">("stream");

  const { events: allEvents, alerts, health, isLoading } = useWatcher(100);
  const { events: failureEvents } = useWatcher(100, "noop");
  const { events: errorEvents } = useWatcher(50, "error");

  const failures = [...failureEvents, ...errorEvents]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 100);

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
          <button
            onClick={() => setView("alerts")}
            className={`text-xs px-3 py-1.5 rounded font-medium transition-colors flex items-center gap-1.5 ${
              view === "alerts"
                ? "bg-red-500/10 text-red-400"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Bell className="h-3 w-3" />
            Alerts
            {alerts.length > 0 && (
              <span className="bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded-full">
                {alerts.length}
              </span>
            )}
          </button>
        </div>

        {/* Stats */}
        <div className="ml-auto flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
          <span>
            {view === "alerts"
              ? `${alerts.length} alerts`
              : `${view === "failures" ? failures.length : allEvents.length} events`}
          </span>
          {isLoading && <span className="text-primary animate-pulse">polling...</span>}
        </div>
      </div>

      {/* Health card */}
      {health && <HealthCard health={health} />}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === "alerts" ? (
          alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Bell className="h-6 w-6 text-green-400" />
              <span className="text-sm">No anomaly alerts</span>
            </div>
          ) : (
            alerts.map((alert, i) => (
              <AlertRow key={`${alert.ts}-${alert.alert_type}-${i}`} alert={alert} />
            ))
          )
        ) : (
          (() => {
            const displayEvents = view === "stream" ? allEvents : failures;
            return displayEvents.length === 0 ? (
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
            );
          })()
        )}
      </div>
    </div>
  );
}
