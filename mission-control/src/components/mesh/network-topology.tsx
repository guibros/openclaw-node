"use client";

import { Star, Circle } from "lucide-react";
import type { MeshNode } from "./types";

interface Props {
  nodes: MeshNode[];
}

const STATUS_DOT: Record<string, string> = {
  online: "bg-green-400",
  degraded: "bg-yellow-400",
  offline: "bg-zinc-500",
};

/** Determine line style between two nodes based on peer data */
function getConnectionStyle(a: MeshNode, b: MeshNode): {
  color: string;
  dash: string;
  label: string;
} {
  // Find peer data from a's perspective looking at b
  const peerFromA = a.tailscale?.peers?.find(
    (p) => p.nodeId === b.nodeId || p.ip === b.health?.tailscaleIp
  );
  const peerFromB = b.tailscale?.peers?.find(
    (p) => p.nodeId === a.nodeId || p.ip === a.health?.tailscaleIp
  );

  const peer = peerFromA || peerFromB;

  if (!peer) {
    return { color: "stroke-zinc-600", dash: "4 4", label: "no data" };
  }

  if (!peer.online) {
    return { color: "stroke-red-500", dash: "2 4", label: "offline" };
  }

  const latency = peer.latencyMs;
  if (peer.relay || (latency !== null && latency > 100)) {
    const ms = latency !== null ? `${Math.round(latency)}ms` : "relay";
    return { color: "stroke-yellow-400", dash: "6 3", label: ms };
  }

  const ms = latency !== null ? `${Math.round(latency)}ms` : "direct";
  return { color: "stroke-green-400", dash: "none", label: ms };
}

function formatNodeName(nodeId: string): string {
  return nodeId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Virtual Machine Local/i, "(macOS)")
    .replace(/Vmware Virtual Platform/i, "(Linux)");
}

/** Build summary text */
function buildSummary(nodes: MeshNode[]): string {
  const count = nodes.length;
  const onlineNodes = nodes.filter((n) => n.status !== "offline");

  // Connectivity summary
  const allDirect = nodes.every((n) => n.peerConnectivity === "all_direct" || n.peerConnectivity === "unknown");
  const hasRelay = nodes.some((n) => n.peerConnectivity === "some_relay");

  // Average latency across all peers
  const latencies: number[] = [];
  for (const node of nodes) {
    for (const peer of node.tailscale?.peers ?? []) {
      if (peer.latencyMs !== null && peer.online) {
        latencies.push(peer.latencyMs);
      }
    }
  }
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  // NATS host
  const natsHost = nodes.find((n) => n.isNatsHost);
  const natsHostName = natsHost ? formatNodeName(natsHost.nodeId).split(" ")[0].toLowerCase() : null;

  let parts = [`${count} node${count !== 1 ? "s" : ""}`];

  if (allDirect && !hasRelay) {
    parts.push("all direct");
  } else if (hasRelay) {
    const relayCount = nodes.filter((n) => n.peerConnectivity === "some_relay").length;
    parts.push(`${relayCount} relay`);
  }

  if (avgLatency !== null) {
    parts.push(`avg ${avgLatency}ms`);
  }

  if (natsHostName) {
    parts.push(`NATS hosted by ${natsHostName}`);
  }

  return parts.join(" \u00b7 ");
}

export function NetworkTopology({ nodes }: Props) {
  if (nodes.length === 0) return null;

  // Layout: evenly spaced horizontally
  const nodeSpacing = 180;
  const svgWidth = Math.max(400, nodes.length * nodeSpacing + 80);
  const svgHeight = 140;
  const cy = 60;

  const positions = nodes.map((_, i) => ({
    x: 60 + i * nodeSpacing,
    y: cy,
  }));

  // Generate connection lines between all pairs
  const connections: Array<{
    from: number;
    to: number;
    style: ReturnType<typeof getConnectionStyle>;
  }> = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      connections.push({
        from: i,
        to: j,
        style: getConnectionStyle(nodes[i], nodes[j]),
      });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Network Overview
      </h2>

      <div className="overflow-x-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="mx-auto"
        >
          {/* Connection lines */}
          {connections.map(({ from, to, style }, idx) => (
            <g key={`conn-${idx}`}>
              <line
                x1={positions[from].x}
                y1={positions[from].y}
                x2={positions[to].x}
                y2={positions[to].y}
                className={style.color}
                strokeWidth={2}
                strokeDasharray={style.dash === "none" ? undefined : style.dash}
              />
              {/* Latency label on the line */}
              <text
                x={(positions[from].x + positions[to].x) / 2}
                y={(positions[from].y + positions[to].y) / 2 - 10}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
                style={{ fontSize: "9px" }}
              >
                {style.label}
              </text>
            </g>
          ))}

          {/* Nodes */}
          {nodes.map((node, i) => {
            const pos = positions[i];
            const roleLabel =
              node.health?.role === "lead"
                ? "LEAD"
                : node.health?.role === "worker"
                ? "WORKER"
                : "NODE";
            const statusColor = STATUS_DOT[node.status] || "bg-zinc-500";
            const fillColor =
              node.status === "online"
                ? "#1a2e1a"
                : node.status === "degraded"
                ? "#2e2a1a"
                : "#1a1a1a";
            const strokeColor =
              node.status === "online"
                ? "#22c55e"
                : node.status === "degraded"
                ? "#eab308"
                : "#52525b";

            return (
              <g key={node.nodeId}>
                {/* Node circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={28}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={2}
                />

                {/* Status dot */}
                <circle
                  cx={pos.x + 20}
                  cy={pos.y - 20}
                  r={5}
                  fill={
                    node.status === "online"
                      ? "#4ade80"
                      : node.status === "degraded"
                      ? "#facc15"
                      : "#71717a"
                  }
                />

                {/* NATS host star */}
                {node.isNatsHost && (
                  <text
                    x={pos.x - 22}
                    y={pos.y - 18}
                    className="fill-yellow-400 text-[14px]"
                    style={{ fontSize: "14px" }}
                  >
                    &#9733;
                  </text>
                )}

                {/* Role badge */}
                <text
                  x={pos.x}
                  y={pos.y - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[8px] font-bold uppercase"
                  style={{ fontSize: "8px", letterSpacing: "0.05em" }}
                >
                  {roleLabel}
                </text>

                {/* Node name */}
                <text
                  x={pos.x}
                  y={pos.y + 10}
                  textAnchor="middle"
                  className="fill-foreground text-[10px] font-medium"
                  style={{ fontSize: "10px" }}
                >
                  {formatNodeName(node.nodeId).split(" ")[0]}
                </text>

                {/* Platform below */}
                <text
                  x={pos.x}
                  y={pos.y + 50}
                  textAnchor="middle"
                  className="fill-muted-foreground/60 text-[9px]"
                  style={{ fontSize: "9px" }}
                >
                  {node.health?.platform ?? "unknown"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Summary text */}
      <p className="text-center text-[11px] text-muted-foreground mt-2">
        {buildSummary(nodes)}
      </p>
    </div>
  );
}
