"use client";

import { Wifi, WifiOff, Server, Database, Globe, Clock, AlertTriangle, CheckCircle2, XCircle, Star, ArrowRight } from "lucide-react";
import type { MeshNode } from "./types";

interface Props {
  nodes: MeshNode[];
  meshStatus?: {
    natsConnected: boolean;
    natsUrl: string;
    localNodeId: string;
    nodesOnline: number;
    nodesTotal: number;
  };
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatLastSeen(ts: string | null | undefined): string {
  if (!ts) return "never";
  try {
    const d = new Date(ts);
    const ago = Math.round((Date.now() - d.getTime()) / 1000);
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
    if (ago < 86400) return `${Math.round(ago / 3600)}h ago`;
    return `${Math.round(ago / 86400)}d ago`;
  } catch { return ts; }
}

export function NetworkTopology({ nodes, meshStatus }: Props) {
  const natsUrl = meshStatus?.natsUrl || nodes.find(n => n.nats?.serverUrl && n.nats.serverUrl !== "unknown")?.nats?.serverUrl || "unknown";
  const natsConnected = meshStatus?.natsConnected ?? nodes.some(n => n.nats?.connected);
  const natsHost = nodes.find(n => n.isNatsHost);
  const localNode = nodes.find(n => n.health !== null);
  const onlineCount = nodes.filter(n => n.status !== "offline").length;

  // Extract NATS host IP from URL
  let natsHostIp = "unknown";
  try {
    if (natsUrl && natsUrl !== "unknown") {
      natsHostIp = new URL(natsUrl).hostname;
    }
  } catch {}

  // Find which known node matches the NATS host IP
  const natsHostNode = nodes.find(n => {
    const ip = n.tailscale?.selfIp || n.health?.tailscaleIp;
    return ip === natsHostIp;
  });
  const natsHostName = natsHostNode
    ? natsHostNode.nodeId.split("-")[0]
    : natsHost
    ? natsHost.nodeId.split("-")[0]
    : natsHostIp;

  // Gather all peer info
  const allPeers = localNode?.tailscale?.peers || [];
  const onlinePeers = allPeers.filter((p: any) => p.online);
  const offlinePeers = allPeers.filter((p: any) => !p.online);

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Network Status
          </h2>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className={onlineCount > 0 ? "text-green-400" : "text-red-400"}>
            {onlineCount}/{nodes.length} nodes
          </span>
          <span className={natsConnected ? "text-green-400" : "text-red-400"}>
            NATS {natsConnected ? "●" : "✗"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-border/50">

        {/* Column 1: NATS Infrastructure */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
            <Database className="h-3 w-3" /> NATS Message Bus
          </div>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${natsConnected ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
              <span className={natsConnected ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
                {natsConnected ? "Connected" : "Disconnected"}
              </span>
            </div>

            <div className="grid grid-cols-[70px_1fr] gap-y-1 gap-x-2 text-muted-foreground">
              <span className="text-muted-foreground/50">Server</span>
              <span className="font-mono text-foreground/70 break-all">{natsUrl !== "unknown" ? natsUrl : "not configured"}</span>

              <span className="text-muted-foreground/50">Host</span>
              <span>
                {natsHostName !== "unknown" ? (
                  <span className="text-amber-400">★ {natsHostName}</span>
                ) : (
                  <span className="text-zinc-500">{natsHostIp}</span>
                )}
              </span>

              {localNode?.nats?.serverVersion && localNode.nats.serverVersion !== "unknown" && (
                <>
                  <span className="text-muted-foreground/50">Version</span>
                  <span className="font-mono text-foreground/40">{localNode.nats.serverVersion}</span>
                </>
              )}

              {!natsConnected && natsHostNode && (
                <>
                  <span className="text-muted-foreground/50">Cause</span>
                  <span className="text-red-400/80">
                    {natsHostNode.status === "offline"
                      ? `Host node (${natsHostName}) is offline`
                      : "Connection refused"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Column 2: Tailscale VPN */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
            <Wifi className="h-3 w-3" /> Tailscale VPN
          </div>
          <div className="space-y-1.5 text-[10px]">
            <div className="grid grid-cols-[70px_1fr] gap-y-1 gap-x-2 text-muted-foreground">
              <span className="text-muted-foreground/50">Local IP</span>
              <span className="font-mono text-foreground/70">
                {localNode?.tailscale?.selfIp || localNode?.health?.tailscaleIp || "unknown"}
              </span>

              <span className="text-muted-foreground/50">NAT type</span>
              <span className="text-foreground/60">{localNode?.tailscale?.natType || "unknown"}</span>

              <span className="text-muted-foreground/50">Peers</span>
              <span>
                <span className={onlinePeers.length > 0 ? "text-green-400" : "text-zinc-500"}>
                  {onlinePeers.length} online
                </span>
                {offlinePeers.length > 0 && (
                  <span className="text-red-400/70 ml-2">{offlinePeers.length} offline</span>
                )}
              </span>
            </div>

            {/* Peer details */}
            {allPeers.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-border/30 pt-2">
                {allPeers.map((peer: any, i: number) => (
                  <div key={peer.hostname || i} className="flex items-center gap-1.5 text-[9px]">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${peer.online ? "bg-green-400" : "bg-red-400"}`} />
                    <span className="text-foreground/70 truncate">{peer.hostname}</span>
                    <span className="font-mono text-muted-foreground/40 shrink-0">{peer.ip}</span>
                    <span className="ml-auto shrink-0">
                      {peer.online ? (
                        <span className={peer.direct ? "text-green-400" : "text-yellow-400"}>
                          {peer.direct ? "direct" : peer.relay ? `relay` : "—"}
                        </span>
                      ) : (
                        <span className="text-red-400/60">
                          off {peer.lastSeen ? formatLastSeen(peer.lastSeen) : ""}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Node Summary */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
            <Server className="h-3 w-3" /> Nodes
          </div>
          <div className="space-y-2 text-[10px]">
            {nodes.map((node) => {
              const h = node.health;
              const statusColor = node.status === "online" ? "text-green-400" : node.status === "degraded" ? "text-yellow-400" : "text-zinc-500";
              const dotColor = node.status === "online" ? "bg-green-400" : node.status === "degraded" ? "bg-yellow-400" : "bg-zinc-600";
              const svcCount = h?.services?.length || 0;
              const svcUp = h?.services?.filter((s: any) => s.status === "active").length || 0;
              const svcDown = svcCount - svcUp;

              return (
                <div key={node.nodeId} className="border border-border/30 rounded-lg px-3 py-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                    <span className="font-medium text-foreground/80 truncate">
                      {node.nodeId.split("-")[0]}
                    </span>
                    <span className="text-[8px] font-mono text-muted-foreground/40 uppercase">
                      {h?.role || "?"}
                    </span>
                    {node.isNatsHost && <span className="text-amber-400 text-[8px]">★ NATS</span>}
                    <span className={`ml-auto text-[8px] ${statusColor}`}>
                      {node.status}
                    </span>
                  </div>

                  {h ? (
                    <div className="grid grid-cols-[55px_1fr] gap-y-0.5 gap-x-1 text-[9px] text-muted-foreground">
                      <span className="text-muted-foreground/40">platform</span>
                      <span>{h.platform}</span>
                      <span className="text-muted-foreground/40">uptime</span>
                      <span>{formatUptime(h.uptimeSeconds)}</span>
                      <span className="text-muted-foreground/40">services</span>
                      <span>
                        {svcUp > 0 && <span className="text-green-400">{svcUp} up</span>}
                        {svcDown > 0 && <span className="text-red-400 ml-1">{svcDown} down</span>}
                        {svcCount === 0 && <span className="text-zinc-500">no data</span>}
                      </span>
                      {h.deployVersion && h.deployVersion !== "unknown" && (
                        <>
                          <span className="text-muted-foreground/40">deploy</span>
                          <span className="font-mono">{h.deployVersion}</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-[9px] text-zinc-500 italic">
                      No health data — {node.lastSeen ? `last seen ${formatLastSeen(node.lastSeen)}` : "never seen"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
