"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import type { MeshNode } from "./types";

interface Props {
  nodes: MeshNode[];
}

function formatNodeShort(nodeId: string): string {
  return nodeId.split("-")[0];
}

/** Look up latency from node A to node B using tailscale peer data */
function getPeerInfo(
  from: MeshNode,
  to: MeshNode
): { latencyMs: number | null; relay: boolean; online: boolean } | null {
  const peers = from.tailscale?.peers ?? [];
  const peer = peers.find(
    (p) => p.nodeId === to.nodeId || p.ip === to.health?.tailscaleIp
  );
  if (!peer) return null;
  return { latencyMs: peer.latencyMs, relay: peer.relay, online: peer.online };
}

function CellContent({
  info,
}: {
  info: ReturnType<typeof getPeerInfo>;
}) {
  if (!info) {
    return <span className="text-zinc-600">--</span>;
  }

  if (!info.online) {
    return <span className="text-red-400">offline</span>;
  }

  const latency = info.latencyMs;
  const color =
    latency === null
      ? "text-zinc-500"
      : latency < 50
      ? "text-green-400"
      : latency < 200
      ? "text-yellow-400"
      : "text-red-400";

  const bgColor =
    latency === null
      ? ""
      : latency < 50
      ? "bg-green-500/5"
      : latency < 200
      ? "bg-yellow-500/5"
      : "bg-red-500/5";

  return (
    <span className={`${color} ${bgColor} px-1 rounded`}>
      {latency !== null ? `${latency.toFixed(1)}ms` : "?"}
      {info.relay && (
        <span className="text-yellow-400/60 ml-1 text-[8px]">(relay)</span>
      )}
      {!info.relay && latency !== null && (
        <span className="text-green-400/40 ml-1 text-[8px]">(direct)</span>
      )}
    </span>
  );
}

export function ConnectionMatrix({ nodes }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (nodes.length < 2) return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <Network className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Connection Matrix
        </span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr>
                <th className="text-left text-muted-foreground/60 font-normal pb-2 pr-4">
                  &nbsp;
                </th>
                {nodes.map((n) => (
                  <th
                    key={n.nodeId}
                    className="text-center text-muted-foreground/80 font-medium pb-2 px-2 min-w-[100px]"
                  >
                    {formatNodeShort(n.nodeId)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map((row) => (
                <tr key={row.nodeId} className="border-t border-border/30">
                  <td className="text-muted-foreground/80 font-medium py-2 pr-4 whitespace-nowrap">
                    {formatNodeShort(row.nodeId)}
                  </td>
                  {nodes.map((col) => (
                    <td
                      key={col.nodeId}
                      className="text-center py-2 px-2"
                    >
                      {row.nodeId === col.nodeId ? (
                        <span className="text-zinc-700">&mdash;</span>
                      ) : (
                        <CellContent info={getPeerInfo(row, col)} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 text-[9px] text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-400" /> &lt;50ms
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-yellow-400" /> &lt;200ms
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-400" /> &gt;200ms
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-zinc-600" /> no data
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
