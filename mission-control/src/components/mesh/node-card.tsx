"use client";

import { useState } from "react";
import {
  Server,
  HardDrive,
  Cpu,
  Activity,
  Wifi,
  WifiOff,
  Clock,
  Coins,
  ChevronDown,
  ChevronRight,
  Star,
  Globe,
  Database,
  Gauge,
  MemoryStick,
  CheckCircle2,
  XCircle,
  Circle,
} from "lucide-react";
import type { MeshNode } from "./types";

interface Props {
  node: MeshNode;
  isExpanded?: boolean;
  onToggle?: () => void;
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

function formatStaleness(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/** Color-coded resource bar */
function ResourceBar({
  label,
  percent,
  icon: Icon,
}: {
  label: string;
  percent: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const barColor =
    percent > 90
      ? "bg-red-500"
      : percent > 70
      ? "bg-yellow-500"
      : "bg-green-500";
  const textColor =
    percent > 90
      ? "text-red-400"
      : percent > 70
      ? "text-yellow-400"
      : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-3 w-3 ${textColor} shrink-0`} />
      <span className={`text-[10px] w-8 ${textColor}`}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className={`text-[10px] font-mono w-8 text-right ${textColor}`}>
        {Math.round(percent)}%
      </span>
    </div>
  );
}

export function NodeCard({ node, isExpanded: controlledExpanded, onToggle }: Props) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const toggleExpand = onToggle ?? (() => setInternalExpanded((p) => !p));

  const h = node.health;
  const roleLabel = h?.role === "lead" ? "LEAD" : h?.role === "worker" ? "WORKER" : "NODE";
  const memUsed = h ? Math.round(((h.mem.total - h.mem.free) / h.mem.total) * 100) : 0;
  const cpuPercent = node.cpuLoadPercent ?? h?.cpuLoadPercent ?? 0;

  const stalenessColor =
    node.staleSeconds === null
      ? "text-zinc-500"
      : node.staleSeconds < 30
      ? "text-green-400/60"
      : node.staleSeconds < 60
      ? "text-yellow-400/60"
      : "text-red-400/60";

  const [servicesExpanded, setServicesExpanded] = useState(false);

  return (
    <div
      className={`rounded-xl border ${STATUS_BORDER[node.status]} bg-card overflow-hidden transition-all hover:shadow-md hover:shadow-black/20`}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={toggleExpand}
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
            {node.isNatsHost && (
              <Star className="h-3 w-3 text-yellow-400 fill-yellow-400 shrink-0" />
            )}
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {roleLabel}
            </span>
            {h?.platform && (
              <span className="text-[9px] text-muted-foreground/60 font-mono">
                {h.platform}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground/70">
            {h?.deployVersion && (
              <span className="font-mono">v{h.deployVersion}</span>
            )}
            {h && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {formatUptime(h.uptimeSeconds)}
              </span>
            )}
          </div>
        </div>
        <span className={`text-[9px] font-mono ${stalenessColor}`}>
          {formatStaleness(node.staleSeconds)}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </div>

      {/* ── Network & Connectivity ──────────────────────────────── */}
      {h && (
        <div className="border-t border-border/50 px-4 py-3 space-y-2.5 text-[10px]">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
            <Wifi className="h-3 w-3" /> Network
          </div>

          {/* Tailscale */}
          <div className="grid grid-cols-[80px_1fr] gap-y-1 gap-x-2 pl-1">
            <span className="text-muted-foreground/50">Tailscale IP</span>
            <span className="font-mono text-foreground/80">{node.tailscale?.selfIp ?? h.tailscaleIp ?? "unknown"}</span>

            <span className="text-muted-foreground/50">Connection</span>
            <span>
              {node.peerConnectivity === "all_direct" ? (
                <span className="text-green-400">✓ Direct</span>
              ) : node.peerConnectivity === "some_relay" ? (
                <span className="text-yellow-400">⚡ Via relay</span>
              ) : node.peerConnectivity === "degraded" ? (
                <span className="text-red-400">✗ Degraded</span>
              ) : (
                <span className="text-zinc-500">— No peer data</span>
              )}
            </span>

            <span className="text-muted-foreground/50">Data age</span>
            <span className={stalenessColor}>{formatStaleness(node.staleSeconds) || "no data"}</span>
          </div>

          {/* NATS */}
          <div className="grid grid-cols-[80px_1fr] gap-y-1 gap-x-2 pl-1 pt-1 border-t border-border/30">
            <span className="text-muted-foreground/50">NATS</span>
            <span>
              {node.nats?.connected ? (
                <span className="text-green-400">● Connected</span>
              ) : (
                <span className="text-red-400">● Disconnected</span>
              )}
            </span>

            {node.nats?.serverUrl && node.nats.serverUrl !== "unknown" && (
              <>
                <span className="text-muted-foreground/50">NATS server</span>
                <span className="font-mono text-foreground/60">{node.nats.serverUrl}</span>
              </>
            )}

            {node.isNatsHost && (
              <>
                <span className="text-muted-foreground/50">Role</span>
                <span className="text-amber-400">★ NATS Host</span>
              </>
            )}

            {node.nats?.serverVersion && node.nats.serverVersion !== "unknown" && (
              <>
                <span className="text-muted-foreground/50">Server ver.</span>
                <span className="font-mono text-foreground/40">{node.nats.serverVersion}</span>
              </>
            )}
          </div>

          {/* Peers */}
          {(node.tailscale?.peers?.length ?? 0) > 0 && (
            <div className="pt-1 border-t border-border/30">
              <div className="text-muted-foreground/50 mb-1">Peers</div>
              <div className="space-y-1 pl-1">
                {node.tailscale!.peers!.map((peer: any, i: number) => (
                  <div key={peer.hostname || i} className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${peer.online ? "bg-green-400" : "bg-red-400"}`} />
                    <span className="text-foreground/70">{peer.hostname || "unknown"}</span>
                    <span className="font-mono text-muted-foreground/40">{peer.ip || ""}</span>
                    {peer.online ? (
                      <span className={`ml-auto ${peer.direct ? "text-green-400" : "text-yellow-400"}`}>
                        {peer.direct ? "direct" : peer.relay ? `relay (${peer.relay})` : "relay"}
                        {peer.latency?.latencyMs != null && (
                          <span className="font-mono ml-1">{Math.round(peer.latency.latencyMs)}ms</span>
                        )}
                        {peer.latencyMs != null && !peer.latency && (
                          <span className="font-mono ml-1">{Math.round(peer.latencyMs)}ms</span>
                        )}
                      </span>
                    ) : (
                      <span className="ml-auto text-red-400/70">
                        offline
                        {peer.lastSeen && (
                          <span className="text-muted-foreground/40 ml-1">
                            (last: {new Date(peer.lastSeen).toLocaleString()})
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Resources ───────────────────────────────────────────── */}
      {h && (
        <div className="border-t border-border/50 px-4 py-2.5 space-y-1.5">
          <ResourceBar label="CPU" percent={cpuPercent} icon={Cpu} />
          <ResourceBar label="RAM" percent={memUsed} icon={MemoryStick} />
          <ResourceBar label="Disk" percent={h.diskPercent} icon={HardDrive} />
        </div>
      )}

      {/* ── Agent ───────────────────────────────────────────────── */}
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
            {h.agent.budgetRemainingSeconds != null && (
              <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono">
                {Math.round(h.agent.budgetRemainingSeconds / 60)}m budget
              </span>
            )}
          </div>
          {h.agent.currentTask && (
            <p className="text-[11px] text-cyan-400 mt-1 font-mono truncate">
              &rarr; {h.agent.currentTask}
            </p>
          )}
        </div>
      )}

      {/* ── Active mesh tasks ───────────────────────────────────── */}
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

      {/* ── Today's Stats ───────────────────────────────────────── */}
      {h && (
        <div className="border-t border-border/50 px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>Today: {h.stats.tasksToday} tasks</span>
          <span>{Math.round(h.stats.successRate * 100)}% success</span>
          <span className="flex items-center gap-0.5">
            <Coins className="h-3 w-3" />
            ${h.stats.tokenSpendTodayUsd.toFixed(2)}
          </span>
        </div>
      )}

      {/* ── Expanded: Services ──────────────────────────────────── */}
      {expanded && h && (
        <div className="border-t border-border/50 px-4 py-3 space-y-3">
          <div>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setServicesExpanded((p) => !p);
              }}
            >
              {servicesExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Services (
              {h.services.filter(
                (s) =>
                  s.status === "active" ||
                  s.status === "running" ||
                  s.status === "idle"
              ).length}
              /{h.services.length} healthy)
            </button>
            {servicesExpanded && (
              <div className="space-y-0.5 ml-4">
                {h.services.map((s) => {
                  const isUp =
                    s.status === "active" ||
                    s.status === "running" ||
                    s.status === "idle";
                  return (
                    <div
                      key={s.name}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <span className="flex items-center gap-1.5">
                        {isUp ? (
                          <CheckCircle2 className="h-3 w-3 text-green-400" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-400" />
                        )}
                        <span
                          className={
                            isUp ? "text-foreground/80" : "text-red-400"
                          }
                        >
                          {s.name}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground/50 text-[9px]">
                          {s.status}
                        </span>
                        {s.pid && (
                          <span className="text-muted-foreground/40 font-mono text-[9px]">
                            PID {s.pid}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
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

      {/* ── Offline fallback ────────────────────────────────────── */}
      {node.status === "offline" && !h && (
        <div className="px-4 py-4 text-center">
          <WifiOff className="h-6 w-6 text-zinc-600 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Node unreachable</p>
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
