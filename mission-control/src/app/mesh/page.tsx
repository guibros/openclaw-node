"use client";

import { useEffect, useState, useCallback } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  AlertTriangle,
  WifiOff,
} from "lucide-react";

import { NetworkTopology, NodeCard, ConnectionMatrix } from "@/components/mesh";
import type { MeshNode, MeshEvent } from "@/components/mesh";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function MeshEvents({ events }: { events: MeshEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Live Mesh Events
      </h2>
      <div className="space-y-1 max-h-64 overflow-y-auto">
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
            <span className="text-foreground/70 truncate">{ev.task_id}</span>
          </div>
        ))}
      </div>
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
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

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
  const offlineCount = nodes.length - onlineCount - degradedCount;

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

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
            {offlineCount > 0 && (
              <span className="flex items-center gap-1">
                <WifiOff className="h-3.5 w-3.5 text-zinc-500" />
                {offlineCount} offline
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
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

        {nodes.length > 0 && (
          <div className="flex flex-col gap-6 p-6">
            {/* Network Overview */}
            <NetworkTopology nodes={nodes} />

            {/* Connection Matrix (expandable) */}
            <ConnectionMatrix nodes={nodes} />

            {/* Node Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {nodes.map((node) => (
                <NodeCard
                  key={node.nodeId}
                  node={node}
                  isExpanded={expandedNodes.has(node.nodeId)}
                  onToggle={() => toggleNode(node.nodeId)}
                />
              ))}
            </div>

            {/* Live Events */}
            <MeshEvents events={events} />
          </div>
        )}
      </div>
    </div>
  );
}
