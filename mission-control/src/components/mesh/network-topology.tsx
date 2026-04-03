"use client";

import { Wifi, Database, Globe, Clock, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { useState } from "react";

function InfoBubble({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
      >
        <Info className="h-3 w-3" />
      </button>
      {show && (
        <div className="absolute left-5 top-0 z-50 w-72 rounded-lg border border-border bg-zinc-900 p-3 text-[10px] leading-relaxed text-zinc-200 shadow-2xl">
          {text}
        </div>
      )}
    </span>
  );
}
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

      {/* ── Infrastructure Identity ── */}
      {(() => {
        const svcList = localNode?.health?.services || [];
        const svcUp = svcList.filter((s: any) => s.status === "active").length;
        const svcDown = svcList.filter((s: any) => s.status === "error" || s.status === "down").length;
        const agentStatus = localNode?.health?.agent?.status || "unknown";
        const localPlatform = localNode?.health?.platform || "unknown";
        const localRole = localNode?.health?.role || "unknown";
        const deployVer = localNode?.health?.deployVersion || null;

        // Derive tailnet name from DNS
        const tsDnsRaw = localNode?.tailscale?.dnsName || "";
        const tailnetName = tsDnsRaw
          ? tsDnsRaw.replace(/\.$/, "").split(".").slice(-3).join(".")
          : localIp ? "connected" : "not connected";

        const dot = (ok: boolean | null) =>
          ok === true ? "bg-green-400" : ok === false ? "bg-red-400" : "bg-zinc-600";
        const txt = (ok: boolean | null) =>
          ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-zinc-500";

        return (
          <div className="px-4 py-3 border-b border-border/50 space-y-2 text-[10px]">
            {/* Row 1: This Machine */}
            <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground/50 font-semibold uppercase text-[8px] tracking-wider pt-0.5">This machine</span>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground/90">{meshStatus?.localNodeId || "unknown"}</span>
                  <span className="text-muted-foreground/40 font-mono text-[9px]">{localPlatform}</span>
                  <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${localRole === "lead" ? "bg-green-500/15 text-green-400" : "bg-blue-500/15 text-blue-400"}`}>
                    {localRole}
                  </span>
                  {deployVer && deployVer !== "unknown" && (
                    <span className="font-mono text-muted-foreground/30 text-[8px]">v{deployVer}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Row 2: Tailscale */}
            <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground/50 font-semibold uppercase text-[8px] tracking-wider pt-0.5">Tailscale VPN</span>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`h-1.5 w-1.5 rounded-full ${dot(!!localIp)}`} />
                {localIp ? (
                  <>
                    <span className="font-mono text-foreground/70">{localIp}</span>
                    <span className="text-muted-foreground/40">on</span>
                    <span className="text-foreground/60">{tailnetName}</span>
                    <span className="text-muted-foreground/30">·</span>
                    <span className={onlinePeers.length > 0 ? "text-green-400/80" : "text-zinc-500"}>
                      {allPeers.length} peer{allPeers.length !== 1 ? "s" : ""} ({onlinePeers.length} online)
                    </span>
                  </>
                ) : (
                  <span className="text-red-400">Not connected — no Tailscale IP</span>
                )}
              </div>
            </div>

            {/* Row 3: NATS */}
            <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground/50 font-semibold uppercase text-[8px] tracking-wider pt-0.5">NATS bus</span>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`h-1.5 w-1.5 rounded-full ${dot(natsFunctional ? true : natsSocketOpen ? null : false)}`} />
                <span className="font-mono text-foreground/70">{natsUrl || "not configured"}</span>
                <span className="text-muted-foreground/30">·</span>
                <span className={txt(natsFunctional ? true : natsSocketOpen ? null : false)}>
                  {natsFunctional ? "operational" : natsSocketOpen ? "socket open, no data" : "unreachable"}
                </span>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-muted-foreground/50">
                  hosted on{" "}
                  <span className={natsHostOnline ? "text-green-400" : natsHostOnline === false ? "text-red-400" : "text-foreground/60"}>
                    {natsHostName}
                    {natsHostOnline === false && " (offline)"}
                  </span>
                </span>
              </div>
            </div>

            {/* Row 4: Services + Agent */}
            <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground/50 font-semibold uppercase text-[8px] tracking-wider pt-0.5">Services</span>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`h-1.5 w-1.5 rounded-full ${dot(svcDown === 0 && svcUp > 0 ? true : svcDown > 0 ? false : null)}`} />
                <span className={svcDown > 0 ? "text-yellow-400" : "text-foreground/70"}>
                  {svcUp} running{svcDown > 0 && <>, <span className="text-red-400">{svcDown} errored</span></>}
                  {svcUp === 0 && svcDown === 0 && "no data"}
                </span>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-muted-foreground/50">Agent:</span>
                {localNode?.health?.agent?.name && (
                  <span className="text-foreground/70 font-medium">{localNode.health.agent.name}</span>
                )}
                <span className={agentStatus === "working" || agentStatus === "idle" ? "text-green-400" : agentStatus === "stopped" ? "text-red-400" : "text-zinc-500"}>
                  {agentStatus}
                  {agentStatus === "working" && localNode?.health?.agent?.currentTask && ` (${localNode.health.agent.currentTask})`}
                </span>
                {localNode?.health?.agent?.llm && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="text-muted-foreground/50">LLM:</span>
                    <span className="text-foreground/60">
                      {localNode.health.agent.llm}
                      {localNode.health.agent.model && `/${localNode.health.agent.model}`}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border/50">
        {/* ── Column 1: NATS ── */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
            <Database className="h-3 w-3" /> NATS Message Bus
            <InfoBubble text="NATS is a lightweight, high-performance messaging system that connects all OpenClaw nodes. It acts as the central nervous system of the mesh — every task submission, claim, completion, health heartbeat, and collaboration event flows through NATS as publish/subscribe messages. NATS also provides a Key-Value store (JetStream KV) used for task state, health data, and collab sessions. If NATS goes down, nodes can't coordinate — tasks stop dispatching, health stops reporting, and the mesh is effectively disconnected. NATS runs as a server process on one node (the host) and all other nodes connect to it over the Tailscale VPN." />
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
            <InfoBubble text="Tailscale is a zero-config VPN built on WireGuard that creates an encrypted mesh network between your machines. Each machine gets a stable IP address (100.x.x.x) on the tailnet, and all traffic between nodes is end-to-end encrypted. Nodes can connect directly (peer-to-peer) or through relay servers (DERP) when direct connections aren't possible due to NAT. Tailscale is the trust layer for OpenClaw — if a machine is on your tailnet, it's trusted to join the mesh. NATS runs on top of Tailscale, so all mesh traffic is encrypted even though NATS itself uses plaintext." />
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
