"use client";

import { Wifi, Database, Globe, Clock, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
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

function formatLastSeen(ts: string | null | undefined): string {
  if (!ts) return "never";
  try {
    const d = new Date(ts);
    const ago = Math.round((Date.now() - d.getTime()) / 1000);
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
    if (ago < 86400) return `${Math.round(ago / 3600)}h ago`;
    return `${Math.round(ago / 86400)}d ago`;
  } catch {
    return String(ts);
  }
}

export function NetworkTopology({ nodes, meshStatus }: Props) {
  // ── NATS state ──
  const natsUrl =
    meshStatus?.natsUrl && meshStatus.natsUrl !== "unknown"
      ? meshStatus.natsUrl
      : nodes.find((n) => n.nats?.serverUrl && n.nats.serverUrl !== "unknown")?.nats?.serverUrl || null;

  // "connected" from meshStatus means the MC NATS client has a TCP socket open.
  // But if no health data is flowing (all nodes offline), NATS is NOT functional.
  const anyHealthData = nodes.some((n) => n.health !== null && n.staleSeconds !== null && n.staleSeconds < 120);
  const natsSocketOpen = meshStatus?.natsConnected ?? false;
  const natsFunctional = natsSocketOpen && anyHealthData;

  // Derive NATS host from URL
  let natsHostIp = "";
  try {
    if (natsUrl) natsHostIp = new URL(natsUrl).hostname;
  } catch {}
  const natsHostNode = nodes.find((n) => {
    const ip = n.tailscale?.selfIp || n.health?.tailscaleIp;
    return ip && ip === natsHostIp;
  });
  const natsHostName = natsHostNode ? natsHostNode.nodeId.split("-")[0] : natsHostIp || "unknown";
  const natsHostOnline = natsHostNode ? natsHostNode.status !== "offline" : null;

  // ── Tailscale state ──
  const localNode = nodes.find((n) => n.health !== null);
  const allPeers = localNode?.tailscale?.peers || [];
  const onlinePeers = allPeers.filter((p: any) => p.online);
  const offlinePeers = allPeers.filter((p: any) => !p.online);
  const localIp = localNode?.tailscale?.selfIp || localNode?.health?.tailscaleIp || null;
  const natType = localNode?.tailscale?.natType || null;

  // Overall health verdict
  const onlineNodes = nodes.filter((n) => n.status !== "offline").length;
  let verdict = "";
  let verdictColor = "text-zinc-500";
  if (natsFunctional && onlineNodes === nodes.length) {
    verdict = "All systems operational";
    verdictColor = "text-green-400";
  } else if (natsSocketOpen && !natsFunctional) {
    verdict = "NATS connected but no health data flowing — publisher may be down";
    verdictColor = "text-yellow-400";
  } else if (!natsSocketOpen && natsHostNode && natsHostNode.status === "offline") {
    verdict = `NATS unreachable — host node (${natsHostName}) is offline`;
    verdictColor = "text-red-400";
  } else if (!natsSocketOpen) {
    verdict = `NATS unreachable at ${natsUrl || "unknown URL"}`;
    verdictColor = "text-red-400";
  } else if (onlineNodes < nodes.length) {
    const downCount = nodes.length - onlineNodes;
    verdict = `${downCount} node${downCount > 1 ? "s" : ""} offline`;
    verdictColor = "text-yellow-400";
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Header with verdict */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Network Status
          </h2>
        </div>
        <span className={`text-[10px] font-medium ${verdictColor}`}>{verdict}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border/50">
        {/* ── Column 1: NATS ── */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
            <Database className="h-3 w-3" /> NATS Message Bus
          </div>

          <div className="grid grid-cols-[80px_1fr] gap-y-1.5 gap-x-2 text-[10px]">
            <span className="text-muted-foreground/50">Status</span>
            <div className="flex items-center gap-1.5">
              {natsFunctional ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                  <span className="text-green-400 font-medium">Operational</span>
                </>
              ) : natsSocketOpen ? (
                <>
                  <AlertTriangle className="h-3 w-3 text-yellow-400" />
                  <span className="text-yellow-400 font-medium">Socket open, no data</span>
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 text-red-400" />
                  <span className="text-red-400 font-medium">Unreachable</span>
                </>
              )}
            </div>

            <span className="text-muted-foreground/50">Server URL</span>
            <span className="font-mono text-foreground/70 break-all">
              {natsUrl || "not configured"}
            </span>

            <span className="text-muted-foreground/50">Hosted by</span>
            <span>
              {natsHostNode ? (
                <span className={natsHostOnline ? "text-green-400" : "text-red-400"}>
                  ★ {natsHostName} ({natsHostOnline ? "online" : "offline"})
                </span>
              ) : natsHostIp ? (
                <span className="font-mono text-foreground/60">{natsHostIp}</span>
              ) : (
                <span className="text-zinc-500">unknown</span>
              )}
            </span>

            {!natsFunctional && (
              <>
                <span className="text-muted-foreground/50">Diagnosis</span>
                <span className="text-red-400/80 leading-tight">
                  {!natsSocketOpen && natsHostNode?.status === "offline"
                    ? `Host machine (${natsHostName}) is offline — NATS server is down with it. Bring the machine back online to restore mesh.`
                    : !natsSocketOpen
                    ? `Cannot reach ${natsUrl || "NATS server"}. Check if the NATS service is running on the host machine and Tailscale VPN is connected.`
                    : "MC has a NATS socket but health KV is empty. The mesh-health-publisher service may not be running."}
                </span>
              </>
            )}

            {localNode?.nats?.serverVersion && localNode.nats.serverVersion !== "unknown" && (
              <>
                <span className="text-muted-foreground/50">Version</span>
                <span className="font-mono text-foreground/40">{localNode.nats.serverVersion}</span>
              </>
            )}
          </div>
        </div>

        {/* ── Column 2: Tailscale ── */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
            <Wifi className="h-3 w-3" /> Tailscale VPN
          </div>

          <div className="grid grid-cols-[80px_1fr] gap-y-1.5 gap-x-2 text-[10px]">
            <span className="text-muted-foreground/50">Status</span>
            <div className="flex items-center gap-1.5">
              {localIp ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                  <span className="text-green-400 font-medium">Connected</span>
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 text-red-400" />
                  <span className="text-red-400 font-medium">No Tailscale IP detected</span>
                </>
              )}
            </div>

            {localIp && (
              <>
                <span className="text-muted-foreground/50">Local IP</span>
                <span className="font-mono text-foreground/70">{localIp}</span>
              </>
            )}

            {natType && natType !== "unknown" && (
              <>
                <span className="text-muted-foreground/50">NAT type</span>
                <span className="text-foreground/60">{natType}</span>
              </>
            )}

            <span className="text-muted-foreground/50">Peers</span>
            <span>
              {allPeers.length === 0 ? (
                <span className="text-zinc-500">No peers discovered</span>
              ) : (
                <>
                  <span className={onlinePeers.length > 0 ? "text-green-400" : "text-zinc-500"}>
                    {onlinePeers.length} online
                  </span>
                  {offlinePeers.length > 0 && (
                    <span className="text-red-400/70 ml-2">{offlinePeers.length} offline</span>
                  )}
                </>
              )}
            </span>
          </div>

          {/* Peer details */}
          {allPeers.length > 0 && (
            <div className="mt-1 space-y-1.5 border-t border-border/30 pt-2">
              {allPeers.map((peer: any, i: number) => (
                <div
                  key={peer.hostname || i}
                  className="flex items-start gap-2 text-[9px] leading-tight"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 mt-1 ${
                      peer.online ? "bg-green-400" : "bg-red-400"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-foreground/80 font-medium">{peer.hostname || "unknown"}</span>
                      <span className="font-mono text-muted-foreground/40">{peer.ip}</span>
                      {peer.os && <span className="text-muted-foreground/30">{peer.os}</span>}
                    </div>
                    <div className="text-muted-foreground/60 mt-0.5">
                      {peer.online ? (
                        <>
                          {peer.direct ? (
                            <span className="text-green-400">Direct connection</span>
                          ) : peer.relay ? (
                            <span className="text-yellow-400">Via relay ({peer.relay})</span>
                          ) : (
                            <span className="text-zinc-400">Connected</span>
                          )}
                          {(peer.latency?.latencyMs ?? peer.latencyMs) != null && (
                            <span className="font-mono ml-2">
                              {Math.round(peer.latency?.latencyMs ?? peer.latencyMs)}ms RTT
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-red-400/70">
                          Offline
                          {peer.lastSeen && ` — last seen ${formatLastSeen(peer.lastSeen)}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
