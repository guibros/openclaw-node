"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";

// Dynamic import — react-force-graph-3d requires WebGL, no SSR
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      Initializing 3D engine...
    </div>
  ),
});

// ── Types ──

interface GraphNode {
  id: number;
  name: string;
  type: string;
  accessCount: number;
  lastSeen: string;
}

interface GraphEdge {
  id: number;
  source: number;
  target: number;
  relationType: string;
  confidence: number;
}

interface GraphStats {
  entityCount: number;
  relationCount: number;
  activeRelations: number;
  topTypes: Array<{ type: string; count: number }>;
}

// ── Color Scheme ──

const TYPE_COLORS: Record<string, string> = {
  person: "#f59e0b",
  project: "#3b82f6",
  contract: "#8b5cf6",
  tool: "#10b981",
  concept: "#ec4899",
  file: "#6b7280",
};

const RELATION_COLORS: Record<string, string> = {
  uses: "#60a5fa",
  depends_on: "#f97316",
  blocks: "#ef4444",
  part_of: "#a78bfa",
  owns: "#fbbf24",
  supersedes: "#6b7280",
  related_to: "#9ca3af",
};

// ── Component ──

export default function GraphPage() {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphEdge[] } | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);

  // Resize observer
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

  // Fetch data
  useEffect(() => {
    fetch("/api/memory/graph?format=viz")
      .then((r) => r.json())
      .then((data) => {
        // react-force-graph expects { nodes, links } with source/target matching node ids
        setGraphData({
          nodes: data.nodes,
          links: data.edges.map((e: GraphEdge) => ({
            ...e,
            source: e.source,
            target: e.target,
          })),
        });
        setStats(data.stats);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // Node click handler
  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);

    // Fly camera to the clicked node
    if (fgRef.current) {
      const distance = 120;
      const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
      fgRef.current.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
        node,
        1000
      );
    }
  }, []);

  // Node color
  const nodeColor = useCallback((node: any) => {
    return TYPE_COLORS[node.type] || "#6b7280";
  }, []);

  // Node size by access count
  const nodeVal = useCallback((node: any) => {
    return Math.max(2, Math.min(12, 2 + (node.accessCount || 0) * 0.8));
  }, []);

  // Link color
  const linkColor = useCallback((link: any) => {
    return RELATION_COLORS[link.relationType] || "#9ca3af";
  }, []);

  // Node label (shown on hover)
  const nodeLabel = useCallback((node: any) => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const name = esc(String(node.name ?? ""));
    const type = esc(String(node.type ?? ""));
    return `<div style="background:rgba(0,0,0,0.85);color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;max-width:280px;line-height:1.4">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="width:8px;height:8px;border-radius:50%;background:${TYPE_COLORS[node.type] || "#6b7280"};display:inline-block"></span>
        <strong>${name}</strong>
        <span style="color:#9ca3af">(${type})</span>
      </div>
      <div style="color:#9ca3af">
        Access count: ${node.accessCount || 0}<br/>
        Last seen: ${node.lastSeen?.split("T")[0] || "unknown"}
      </div>
    </div>`;
  }, []);

  // Link label (shown on hover)
  const linkLabel = useCallback((link: any) => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const srcName = esc(String(typeof link.source === "object" ? link.source.name : link.source));
    const tgtName = esc(String(typeof link.target === "object" ? link.target.name : link.target));
    const relType = esc(String(link.relationType ?? ""));
    return `<div style="background:rgba(0,0,0,0.85);color:#fff;padding:6px 10px;border-radius:6px;font-size:11px">
      ${srcName} → <strong>${relType}</strong> → ${tgtName}
    </div>`;
  }, []);

  // Connected nodes for selected node
  const connectedInfo = useMemo(() => {
    if (!selectedNode || !graphData) return [];
    return graphData.links
      .filter((l: any) => {
        const sid = typeof l.source === "object" ? l.source.id : l.source;
        const tid = typeof l.target === "object" ? l.target.id : l.target;
        return sid === selectedNode.id || tid === selectedNode.id;
      })
      .map((l: any) => {
        const sid = typeof l.source === "object" ? l.source.id : l.source;
        const tid = typeof l.target === "object" ? l.target.id : l.target;
        const otherId = sid === selectedNode.id ? tid : sid;
        const otherNode = graphData.nodes.find((n) => n.id === otherId);
        const direction = sid === selectedNode.id ? "out" : "in";
        return {
          name: otherNode?.name || `#${otherId}`,
          type: otherNode?.type || "unknown",
          relationType: l.relationType,
          direction,
        };
      });
  }, [selectedNode, graphData]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading graph...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-400 text-sm">
        Error: {error}
      </div>
    );
  }

  // Empty state: no entities seeded
  if (!loading && graphData && graphData.nodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
        <p className="text-sm">No entities in the knowledge graph</p>
        <p className="text-xs text-muted-foreground/60 max-w-xs text-center">
          Seed known entities to populate the graph with people, projects, tools, and their relationships.
        </p>
        <button
          onClick={async () => {
            setLoading(true);
            try {
              await fetch("/api/memory/graph", { method: "POST" });
              window.location.reload();
            } catch {
              setLoading(false);
            }
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
        >
          Seed Known Entities
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">Knowledge Graph</h1>
          <span className="text-[10px] text-muted-foreground bg-accent px-2 py-0.5 rounded">3D</span>
        </div>
        {stats && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{stats.entityCount} entities</span>
            <span>{stats.activeRelations} relations</span>
            {stats.topTypes.map((t) => (
              <span key={t.type} className="flex items-center gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: TYPE_COLORS[t.type] || "#6b7280" }}
                />
                {t.type}: {t.count}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-hidden relative">
        <div ref={containerRef} className="w-full h-full bg-[#0a0a0f]">
          {graphData && (
            <ForceGraph3D
              ref={fgRef}
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              nodeId="id"
              nodeLabel={nodeLabel}
              nodeColor={nodeColor}
              nodeVal={nodeVal}
              nodeOpacity={0.9}
              nodeResolution={16}
              linkLabel={linkLabel}
              linkColor={linkColor}
              linkWidth={1.5}
              linkOpacity={0.4}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              linkDirectionalArrowColor={linkColor}
              linkDirectionalParticles={1}
              linkDirectionalParticleWidth={1.5}
              linkDirectionalParticleSpeed={0.005}
              onNodeClick={handleNodeClick}
              onBackgroundClick={() => setSelectedNode(null)}
              backgroundColor="#0a0a0f"
              showNavInfo={false}
              enableNodeDrag={true}
              cooldownTicks={100}
              warmupTicks={50}
            />
          )}
        </div>

        {/* Legend overlay */}
        <div className="absolute top-4 right-4 bg-background/80 backdrop-blur border border-border rounded-lg px-3 py-2 text-[10px] space-y-1 pointer-events-none">
          <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Entity Types</div>
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-muted-foreground">{type}</span>
            </div>
          ))}
          <div className="border-t border-border my-1.5 pt-1.5">
            <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Relations</div>
            {Object.entries(RELATION_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-0.5"
                  style={{ backgroundColor: color }}
                />
                <span className="text-muted-foreground">{type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Controls hint */}
        <div className="absolute bottom-4 left-4 text-[10px] text-muted-foreground/50 pointer-events-none">
          Orbit: drag | Zoom: scroll | Pan: right-drag | Click node: focus
        </div>

        {/* Selected node detail panel */}
        {selectedNode && (
          <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur border border-border rounded-lg px-4 py-3 text-xs shadow-lg w-72">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: TYPE_COLORS[selectedNode.type] || "#6b7280" }}
                />
                <span className="font-semibold text-foreground text-sm">{selectedNode.name}</span>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
              >
                x
              </button>
            </div>
            <div className="text-muted-foreground space-y-1 mb-2">
              <p>Type: {selectedNode.type}</p>
              <p>Access count: {selectedNode.accessCount}</p>
              <p>Last seen: {selectedNode.lastSeen?.split("T")[0] || "unknown"}</p>
            </div>
            {connectedInfo.length > 0 && (
              <div className="border-t border-border pt-2">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">
                  Relations ({connectedInfo.length})
                </p>
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {connectedInfo.map((c, i) => (
                    <div key={i} className="flex items-center gap-1 text-muted-foreground">
                      <span className="text-[10px]">{c.direction === "out" ? "→" : "←"}</span>
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: RELATION_COLORS[c.relationType] || "#9ca3af" }}
                      />
                      <span>{c.relationType}</span>
                      <span className="text-foreground font-medium">{c.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
