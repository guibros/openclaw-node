"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

const SOURCE_COLORS: Record<string, string> = {
  daily_log: "#60a5fa",
  long_term_memory: "#a78bfa",
  clawvault: "#fbbf24",
  lore: "#34d399",
  unknown: "#6b7280",
};

interface LocalGraphProps {
  graph: { nodes: any[]; links: any[] };
  selectedNode: string;
  onNodeClick: (filePath: string) => void;
}

export function LocalGraph({
  graph,
  selectedNode,
  onNodeClick,
}: LocalGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 300, height: 200 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDims({
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
      const isCenter = node.id === selectedNode;
      const size = isCenter ? 5 : 3;
      const color = isCenter
        ? "#6d28d9"
        : SOURCE_COLORS[node.source] || "#6b7280";

      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      const fontSize = Math.max(3, 9 / globalScale);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = isCenter ? "#fafafa" : "#a1a1aa";
      ctx.textAlign = "center";
      const label =
        node.title?.length > 20
          ? node.title.slice(0, 18) + "..."
          : node.title || "";
      ctx.fillText(label, node.x, node.y + size + 6 / globalScale);
    },
    [selectedNode]
  );

  const pointerAreaPaint = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  return (
    <div className="border-t border-border">
      <div className="px-4 py-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
        Local Graph
      </div>
      <div ref={containerRef} className="h-[200px] bg-[#09090b]">
        <ForceGraph2D
          width={dims.width}
          height={dims.height}
          graphData={graph}
          nodeId="id"
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={pointerAreaPaint}
          linkColor={() => "rgba(113, 113, 122, 0.25)"}
          linkWidth={0.5}
          onNodeClick={(node: any) => onNodeClick(node.id)}
          backgroundColor="#09090b"
          cooldownTicks={50}
          enableZoomInteraction={false}
          enablePanInteraction={false}
        />
      </div>
    </div>
  );
}
