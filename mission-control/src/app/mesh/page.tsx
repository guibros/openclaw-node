"use client";

import { useEffect, useState, useCallback } from "react";
import useSWR from "swr";
import {
  Server,
  HardDrive,
  Cpu,
  Activity,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface NodeHealth {
  nodeId: string;
  platform: string;
  role: string;
  tailscaleIp: string;
  diskPercent: number;
  mem: { total: number; free: number };
  uptimeSeconds: number;
  services: Array<{ name: string; status: string; pid?: number }>;
  agent: {
    status: string;
    currentTask: string | null;
    llm: string | null;
    model: string | null;
    budgetRemainingSeconds?: number;
  };
  capabilities: string[];
  stats: {
    tasksToday: number;
    successRate: number;
    tokenSpendTodayUsd: number;
  };
  reportedAt?: string;
}

interface ActiveTask {
  id: string;
  title: string;
  status: string;
  meshTaskId: string | null;
}

interface MeshNode {
  nodeId: string;
  status: "online" | "degraded" | "offline";
  health: NodeHealth | null;
  activeTasks: ActiveTask[];
  lastSeen: string | null;
  staleSeconds: number | null;
}

interface MeshEvent {
  event: string;
  task_id: string;
  task?: Record<string, unknown>;
  timestamp: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatNodeName(nodeId: string): string {
  return nodeId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Virtual Machine Local/i, "(macOS)")
    .replace(/Vmware Virtual Platform/i, "(Linux)");
}

/**
 * Format staleness as a human-readable "ago" string.
 * Shows exactly how fresh the health data is — critical for
 * understanding whether a "degraded" node is actually down or
 * just slightly behind on its heartbeat.
 */
function formatStaleness(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const STATUS_DOT: Record<string, string> = {
  online: "bg-green-400",
  degraded: "bg-yellow-400",
  offline: "bg-zinc-500",
};

const STATUS_BORDER: Record<string, string> = {
  online: "border-green-500/30",
  degraded: "border-yellow-500/30",
  offline: "border-border",
};

function ServiceRow({ name, status, pid }: { name: string; status: string; pid?: number }) {
  const isUp = status === "active" || status === "running" || status === "idle";
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className={isUp ? "text-foreground/80" : "text-red-400"}>
        {isUp ? "✅" : "❌"} {name}
      </span>
      {pid && (
        <span className="text-muted-foreground/50 font-mono text-[9px]">
          PID {pid}
        </span>
      )}
    </div>
  );
}

function NodeCard({ node }: { node: MeshNode }) {
  const [expanded, setExpanded] = useState(false);
  const h = node.health;

  const roleLabel = h?.role === "lead" ? "LEAD" : h?.role === "worker" ? "WORKER" : "NODE";
  const diskColor =
    h && h.diskPercent > 90
      ? "text-red-400"
      : h && h.diskPercent > 80
      ? "text-yellow-400"
      : "text-muted-foreground";
  const memUsed = h ? Math.round(((h.mem.total - h.mem.free) / h.mem.total) * 100) : 0;

  // Staleness color: green < 30s, yellow 30-60s, red > 60s
  const stalenessColor =
    node.staleSeconds === null
      ? "text-zinc-500"
      : node.staleSeconds < 30
      ? "text-green-400/60"
      : node.staleSeconds < 60
      ? "text-yellow-400/60"
      : "text-red-400/60";

  return (
    <div
      className={`rounded-xl border ${STATUS_BORDER[node.status]} bg-card overflow-hidden transition-all hover:shadow-md hover:shadow-black/20`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="relative">
          <Server className="h-5 w-5 text-muted-foreground" />
          <span
            className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ${STATUS_DOT[node.status]} ${
              node.status === "online" ? "animate-pulse" : ""
            }`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {formatNodeName(node.nodeId)}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {roleLabel}
            </span>
          </div>
        </div>
        {/* Staleness indicator — shows how fresh the health data is */}
        <span className={`text-[9px] font-mono ${stalenessColor}`}>
          {formatStaleness(node.staleSeconds)}
        </span>
        {node.status === "offline" && (
          <WifiOff className="h-4 w-4 text-zinc-500" />
        )}
      </div>

      {/* Quick stats row */}
      {h && (
        <div className="grid grid-cols-4 gap-1 px-4 pb-3 text-[10px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Wifi className="h-3 w-3" />
            <span className="font-mono">{h.tailscaleIp}</span>
          </div>
          <div className={`flex items-center gap-1 ${diskColor}`}>
            <HardDrive className="h-3 w-3" />
            <span>Disk: {h.diskPercent}%</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Cpu className="h-3 w-3" />
            <span>RAM: {memUsed}%</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{formatUptime(h.uptimeSeconds)}</span>
          </div>
        </div>
      )}

      {/* Agent status */}
      {h && (
        <div className="border-t border-border/50 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-foreground">
              Agent:{" "}
              <span
                className={
                  h.agent.status === "working" || h.agent.status === "active"
                    ? "text-green-400 font-medium"
                    : h.agent.status === "idle"
                    ? "text-muted-foreground"
                    : "text-yellow-400"
                }
              >
                {h.agent.status}
              </span>
            </span>
            {h.agent.llm && (
              <span className="text-[10px] text-muted-foreground/60 font-mono">
                {h.agent.llm}
                {h.agent.model ? ` (${h.agent.model})` : ""}
              </span>
            )}
          </div>
          {h.agent.currentTask && (
            <p className="text-[11px] text-cyan-400 mt-1 font-mono truncate">
              → {h.agent.currentTask}
            </p>
          )}
        </div>
      )}

      {/* Active mesh tasks */}
      {node.activeTasks.length > 0 && (
        <div className="border-t border-border/50 px-4 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            Active Tasks
          </p>
          {node.activeTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-[11px] py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
              <span className="text-foreground truncate">{t.title}</span>
              {t.meshTaskId && (
                <span className="text-muted-foreground/50 font-mono text-[9px] shrink-0">
                  {t.meshTaskId}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stats row */}
      {h && (
        <div className="border-t border-border/50 px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>
            Today: {h.stats.tasksToday} tasks
          </span>
          <span>
            {Math.round(h.stats.successRate * 100)}% success
          </span>
          <span className="flex items-center gap-0.5">
            <Coins className="h-3 w-3" />
            ${h.stats.tokenSpendTodayUsd.toFixed(2)}
          </span>
        </div>
      )}

      {/* Expanded: services + capabilities */}
      {expanded && h && (
        <div className="border-t border-border/50 px-4 py-3 space-y-3">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
              Services ({h.services.filter(s => s.status === "active" || s.status === "running" || s.status === "idle").length}/{h.services.length} healthy)
            </p>
            <div className="space-y-0.5">
              {h.services.map((s) => (
                <ServiceRow key={s.name} {...s} />
              ))}
            </div>
          </div>
          {h.capabilities.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
                Capabilities
              </p>
              <div className="flex flex-wrap gap-1">
                {h.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent text-muted-foreground"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Offline fallback — still shows last-known health if available */}
      {node.status === "offline" && !h && (
        <div className="px-4 py-4 text-center">
          <WifiOff className="h-6 w-6 text-zinc-600 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            Node unreachable
          </p>
          {node.lastSeen && (
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Last seen: {node.lastSeen}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MeshPage() {
  const { data, error, isLoading } = useSWR<{ nodes: MeshNode[] }>(
    "/api/mesh/nodes",
    fetcher,
    { refreshInterval: 10_000 }
  );

  const [events, setEvents] = useState<MeshEvent[]>([]);

  // SSE subscription for real-time mesh events
  const handleEvent = useCallback((event: MeshEvent) => {
    setEvents((prev) => [event, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/mesh/events");
    es.addEventListener("completed", (e) => {
      try { handleEvent(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener("claimed", (e) => {
      try { handleEvent(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener("started", (e) => {
      try { handleEvent(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener("failed", (e) => {
      try { handleEvent(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener("submitted", (e) => {
      try { handleEvent(JSON.parse(e.data)); } catch {}
    });
    es.onerror = () => {
      // EventSource auto-reconnects on error
    };
    return () => es.close();
  }, [handleEvent]);

  const nodes = data?.nodes ?? [];
  const onlineCount = nodes.filter((n) => n.status === "online").length;
  const degradedCount = nodes.filter((n) => n.status === "degraded").length;

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">Mesh Nodes</h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {onlineCount > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                {onlineCount} online
              </span>
            )}
            {degradedCount > 0 && (
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                {degradedCount} degraded
              </span>
            )}
            {nodes.length - onlineCount - degradedCount > 0 && (
              <span className="flex items-center gap-1">
                <WifiOff className="h-3.5 w-3.5 text-zinc-500" />
                {nodes.length - onlineCount - degradedCount} offline
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading && !data && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Connecting to mesh...
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full text-destructive text-sm">
            Failed to reach mesh nodes API
          </div>
        )}

        {/* Node grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {nodes.map((node) => (
            <NodeCard key={node.nodeId} node={node} />
          ))}
        </div>

        {/* Recent mesh events */}
        {events.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Live Mesh Events
            </h2>
            <div className="space-y-1">
              {events.map((ev, i) => (
                <div
                  key={`${ev.timestamp}-${i}`}
                  className="flex items-center gap-3 text-[11px] py-1.5 px-3 rounded-md bg-card border border-border/50"
                >
                  <span className="text-muted-foreground/60 font-mono shrink-0">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`font-medium shrink-0 ${
                      ev.event === "completed"
                        ? "text-green-400"
                        : ev.event === "failed"
                        ? "text-red-400"
                        : ev.event === "claimed"
                        ? "text-cyan-400"
                        : "text-foreground/80"
                    }`}
                  >
                    {ev.event}
                  </span>
                  <span className="text-foreground/70 truncate">
                    {ev.task_id}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
