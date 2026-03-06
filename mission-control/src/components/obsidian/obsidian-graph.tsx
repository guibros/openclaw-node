"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { WikilinkGraphData } from "@/lib/hooks";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      Initializing graph...
    </div>
  ),
});

const SOURCE_COLORS: Record<string, string> = {
  daily_log: "#60a5fa",
  long_term_memory: "#a78bfa",
  clawvault: "#fbbf24",
  lore: "#34d399",
  unknown: "#6b7280",
};

interface ObsidianGraphProps {
  graph: WikilinkGraphData | null;
  isLoading: boolean;
  selectedNode: string | null;
  onNodeClick: (filePath: string) => void;
}

export function ObsidianGraph({
  graph,
  isLoading,
  selectedNode,
  onNodeClick,
}: ObsidianGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isSelected = node.id === selectedNode;
      const hasLinks = (node.linkCount || 0) > 0;
      const size = Math.max(3, Math.min(8, 3 + (node.linkCount || 0) * 0.4));
      const color =
        isSelected
          ? "#6d28d9"
          : SOURCE_COLORS[node.source] || SOURCE_COLORS.unknown;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, size + 5, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(109, 40, 217, 0.25)";
        ctx.fill();
      }

      // Subtle glow for connected nodes
      if (hasLinks && !isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, size + 2, 0, 2 * Math.PI);
        ctx.fillStyle = color.replace(")", ", 0.15)").replace("rgb", "rgba");
        ctx.fill();
      }

      // Node dot
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Labels: always show for connected nodes at moderate zoom, all nodes at high zoom
      const showLabel =
        isSelected ||
        globalScale > 3 ||
        (hasLinks && globalScale > 1.2);
      if (showLabel) {
        const fontSize = Math.max(3, 11 / globalScale);
        ctx.font = `${isSelected ? "bold " : ""}${fontSize}px sans-serif`;
        ctx.fillStyle = isSelected ? "#fafafa" : hasLinks ? "#d4d4d8" : "#71717a";
        ctx.textAlign = "center";
        const label =
          node.title.length > 28
            ? node.title.slice(0, 26) + "..."
            : node.title;
        ctx.fillText(label, node.x, node.y + size + 8 / globalScale);
      }
    },
    [selectedNode]
  );

  const pointerAreaPaint = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const size = Math.max(4, Math.min(10, 4 + (node.linkCount || 0) * 0.3));
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  const handleNodeClick = useCallback(
    (node: any) => {
      onNodeClick(node.id);
    },
    [onNodeClick]
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading document graph...
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        No documents indexed. Click &quot;Sync Memory&quot; first.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-[#09090b] relative">
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={{ nodes: graph.nodes, links: graph.links }}
        nodeId="id"
        nodeLabel="title"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={pointerAreaPaint}
        linkColor={() => "rgba(139, 92, 246, 0.25)"}
        linkWidth={0.8}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => "rgba(139, 92, 246, 0.5)"}
        onNodeClick={handleNodeClick}
        onBackgroundClick={() => onNodeClick("")}
        backgroundColor="#09090b"
        cooldownTicks={200}
        warmupTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />
      {/* Legend */}
      <div className="absolute top-3 right-3 bg-background/80 backdrop-blur border border-border rounded-lg px-3 py-2 text-[10px] space-y-1 pointer-events-none">
        <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">
          Sources
        </div>
        {Object.entries(SOURCE_COLORS)
          .filter(([k]) => k !== "unknown")
          .map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-muted-foreground">
                {type.replace(/_/g, " ")}
              </span>
            </div>
          ))}
      </div>
      {/* Controls hint */}
      <div className="absolute bottom-3 left-3 text-[10px] text-muted-foreground/50 pointer-events-none">
        Drag: pan | Scroll: zoom | Click node: open
      </div>
    </div>
  );
}
