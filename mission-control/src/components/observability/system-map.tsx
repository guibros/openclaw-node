"use client";

import { useMemo } from "react";
import { Server, Wifi } from "lucide-react";
import type { TraceEvent } from "@/app/observability/page";

interface DaemonInfo {
  name: string;
  status: string;
  lastEventAt?: string;
}

interface NodeInfo {
  nodeId: string;
  platform: string;
  status: string;
  daemons: DaemonInfo[];
}

interface SystemMapProps {
  nodes: NodeInfo[];
  events: TraceEvent[];
}

const STATUS_DOT: Record<string, string> = {
  online: "bg-green-400",
  degraded: "bg-yellow-400",
  offline: "bg-zinc-500",
};

/** Derive daemon liveness from the event stream. */
function useDaemonActivity(events: TraceEvent[]) {
  return useMemo(() => {
    const map = new Map<string, number>(); // "nodeId:module" -> latest timestamp ms
    const now = Date.now();
    for (const ev of events) {
      const key = `${ev.node_id}:${ev.module}`;
      const ts = new Date(ev.timestamp).getTime();
      const prev = map.get(key) ?? 0;
      if (ts > prev) map.set(key, ts);
    }
    // Return a function that checks status
    return (nodeId: string, daemonName: string): "active" | "idle" | "error" => {
      const key = `${nodeId}:${daemonName}`;
      const lastTs = map.get(key);
      if (!lastTs) return "idle";
      const ageSec = (now - lastTs) / 1000;
      // Check if recent events had errors
      const recentErrors = events.some(
        (e) =>
          e.node_id === nodeId &&
          e.module === daemonName &&
          (e.error || e.category === "error") &&
          (now - new Date(e.timestamp).getTime()) / 1000 < 60
      );
      if (recentErrors) return "error";
      if (ageSec < 60) return "active";
      return "idle";
    };
  }, [events]);
}

const DAEMON_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  idle: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  error: "bg-red-500/20 text-red-400 border-red-500/30",
};

function DaemonPill({
  name,
  status,
}: {
  name: string;
  status: "active" | "idle" | "error";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border ${DAEMON_STATUS_COLORS[status]}`}
      title={`${name}: ${status}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "active"
            ? "bg-green-400 animate-pulse"
            : status === "error"
            ? "bg-red-400"
            : "bg-zinc-500"
        }`}
      />
      {name}
    </span>
  );
}

function NodeCard({
  node,
  getDaemonStatus,
}: {
  node: NodeInfo;
  getDaemonStatus: (nodeId: string, daemon: string) => "active" | "idle" | "error";
}) {
  const platformLabel = node.platform.includes("darwin")
    ? "macOS"
    : node.platform.includes("linux")
    ? "Linux"
    : node.platform;

  return (
    <div className="rounded-xl border border-border bg-card p-4 min-w-[260px] max-w-[340px] flex-1">
      {/* Node header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span
            className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
              STATUS_DOT[node.status] ?? "bg-zinc-500"
            } ${node.status === "online" ? "animate-pulse" : ""}`}
          />
        </div>
        <span className="text-sm font-semibold text-foreground truncate">
          {node.nodeId}
        </span>
        <span className="text-[9px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded ml-auto">
          {platformLabel}
        </span>
      </div>

      {/* Daemon pills */}
      <div className="flex flex-wrap gap-1">
        {(node.daemons || []).map((d) => (
          <DaemonPill
            key={d.name}
            name={d.name}
            status={getDaemonStatus(node.nodeId, d.name)}
          />
        ))}
        {(!node.daemons || node.daemons.length === 0) && (
          <span className="text-[10px] text-muted-foreground/50 italic">
            No daemons reported
          </span>
        )}
      </div>
    </div>
  );
}

export function SystemMap({ nodes, events }: SystemMapProps) {
  const getDaemonStatus = useDaemonActivity(events);

  if (nodes.length === 0) {
    return (
      <div className="px-6 py-6 text-center text-sm text-muted-foreground/50">
        Waiting for node data...
      </div>
    );
  }

  return (
    <div className="px-6 py-4">
      <h2 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        System Map
      </h2>
      <div className="flex items-center justify-center gap-6 flex-wrap">
        {nodes.map((node, idx) => (
          <div key={node.nodeId} className="flex items-center gap-6">
            <NodeCard node={node} getDaemonStatus={getDaemonStatus} />
            {/* NATS connector between nodes */}
            {idx < nodes.length - 1 && (
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="h-px w-16 bg-cyan-500/40" />
                <div className="flex items-center gap-1 text-[9px] text-cyan-400/70 font-mono">
                  <Wifi className="h-3 w-3" />
                  NATS
                </div>
                <div className="h-px w-16 bg-cyan-500/40" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
