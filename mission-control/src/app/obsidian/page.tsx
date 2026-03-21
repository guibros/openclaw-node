"use client";

import { useState, useCallback, useMemo } from "react";
import {
  useWikilinkGraph,
  useWorkspaceFiles,
  useWorkspaceFile,
  useMemoryDoc,
} from "@/lib/hooks";
import type { WikilinkGraphData } from "@/lib/hooks";
import { ObsidianGraph } from "@/components/obsidian/obsidian-graph";
import { ObsidianReader } from "@/components/obsidian/obsidian-reader";
import { BacklinksPanel } from "@/components/obsidian/backlinks-panel";
import { LocalGraph } from "@/components/obsidian/local-graph";
import { FileTree } from "@/components/obsidian/file-tree";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Filter,
  RefreshCw,
} from "lucide-react";

const SOURCE_FILTERS = [
  { key: "all", label: "All" },
  { key: "daily_log", label: "Daily" },
  { key: "long_term_memory", label: "Memory" },
  { key: "clawvault", label: "Vault" },
  { key: "lore", label: "Lore" },
] as const;

export default function ObsidianPage() {
  const { graph, isLoading: graphLoading } = useWikilinkGraph();
  const { tree, isLoading: treeLoading } = useWorkspaceFiles();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showFileTree, setShowFileTree] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showOrphans, setShowOrphans] = useState(true);
  const [indexing, setIndexing] = useState(false);

  const handleIndexWorkspace = async () => {
    setIndexing(true);
    try {
      await fetch("/api/memory/flush", { method: "POST" });
      // Force SWR to revalidate the graph
      window.location.reload();
    } catch {
      setIndexing(false);
    }
  };

  // Try indexed doc first (has metadata), fall back to raw workspace file
  const { doc: indexedDoc, isLoading: idxLoading } = useMemoryDoc(selectedPath);
  const { file: rawFile, isLoading: rawLoading } = useWorkspaceFile(
    selectedPath && !indexedDoc && !idxLoading ? selectedPath : null
  );
  const doc = indexedDoc || (rawFile ? {
    id: 0,
    source: rawFile.source,
    category: null,
    filePath: rawFile.filePath,
    title: rawFile.title,
    date: null,
    content: rawFile.content,
    frontmatter: null,
  } : null);
  const docLoading = idxLoading || rawLoading;

  // Filtered graph — by source type and orphan toggle
  const filteredGraph = useMemo((): WikilinkGraphData | null => {
    if (!graph) return null;

    let nodes = graph.nodes;
    let links = graph.links;

    // Source filter
    if (sourceFilter !== "all") {
      const nodeIds = new Set(
        nodes.filter((n) => n.source === sourceFilter).map((n) => n.id)
      );
      nodes = nodes.filter((n) => nodeIds.has(n.id));
      links = links.filter(
        (l) => nodeIds.has(l.source) && nodeIds.has(l.target)
      );
    }

    // Orphan filter
    if (!showOrphans) {
      const connected = new Set<string>();
      for (const l of links) {
        connected.add(l.source);
        connected.add(l.target);
      }
      nodes = nodes.filter((n) => connected.has(n.id));
    }

    return {
      nodes,
      links,
      stats: { nodeCount: nodes.length, linkCount: links.length },
    };
  }, [graph, sourceFilter, showOrphans]);

  // Backlinks for selected doc
  const backlinks = useMemo(() => {
    if (!selectedPath || !graph) return [];
    return graph.links
      .filter((l) => l.target === selectedPath)
      .map((l) => {
        const node = graph.nodes.find((n) => n.id === l.source);
        return { filePath: l.source, title: node?.title ?? l.source };
      });
  }, [selectedPath, graph]);

  // Local subgraph (2-hop)
  const localGraph = useMemo(() => {
    if (!selectedPath || !graph) return null;
    const neighborIds = new Set<string>([selectedPath]);

    const hop1Links = graph.links.filter((l) => {
      if (l.source === selectedPath || l.target === selectedPath) {
        neighborIds.add(l.source);
        neighborIds.add(l.target);
        return true;
      }
      return false;
    });

    const hop2Links = graph.links.filter((l) => {
      if (hop1Links.includes(l)) return false;
      if (neighborIds.has(l.source) || neighborIds.has(l.target)) {
        neighborIds.add(l.source);
        neighborIds.add(l.target);
        return true;
      }
      return false;
    });

    const allLinks = [...hop1Links, ...hop2Links];
    const localNodes = graph.nodes.filter((n) => neighborIds.has(n.id));
    return { nodes: localNodes, links: allLinks };
  }, [selectedPath, graph]);

  const handleNodeClick = useCallback((filePath: string) => {
    setSelectedPath(filePath || null);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedPath(null);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFileTree(!showFileTree)}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            title={showFileTree ? "Hide file tree" : "Show file tree"}
          >
            {showFileTree ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </button>
          <h1 className="text-lg font-semibold text-foreground">Obsidian</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Source filter */}
          <div className="flex items-center gap-1">
            <Filter className="h-3 w-3 text-muted-foreground" />
            {SOURCE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setSourceFilter(f.key)}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  sourceFilter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Orphan toggle */}
          <button
            onClick={() => setShowOrphans(!showOrphans)}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
              showOrphans
                ? "bg-accent text-muted-foreground"
                : "bg-primary text-primary-foreground"
            }`}
            title={showOrphans ? "Click to hide unlinked docs" : "Click to show unlinked docs"}
          >
            {showOrphans ? "Showing orphans" : "Hiding orphans"}
          </button>

          {/* Stats */}
          {filteredGraph && (
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span>{filteredGraph.stats.nodeCount} docs</span>
              <span>{filteredGraph.stats.linkCount} links</span>
            </div>
          )}
        </div>
      </header>

      {/* Main 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: File tree */}
        {showFileTree && (
          <div className="w-56 border-r border-border shrink-0 overflow-hidden">
            <FileTree
              tree={tree}
              isLoading={treeLoading}
              selectedPath={selectedPath}
              onSelect={handleNodeClick}
            />
          </div>
        )}

        {/* Center: Graph */}
        <div className="flex-1 overflow-hidden">
          {!graphLoading && filteredGraph && filteredGraph.nodes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
              <p className="text-sm">No documents indexed yet</p>
              <p className="text-xs text-muted-foreground/60 max-w-xs text-center">
                Index your workspace to build the wikilink graph from your markdown files.
              </p>
              <button
                onClick={handleIndexWorkspace}
                disabled={indexing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${indexing ? "animate-spin" : ""}`} />
                {indexing ? "Indexing..." : "Index Workspace"}
              </button>
            </div>
          ) : (
            <ObsidianGraph
              graph={filteredGraph}
              isLoading={graphLoading}
              selectedNode={selectedPath}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        {/* Right: Reader panel */}
        {selectedPath && (
          <div className="w-[400px] border-l border-border flex flex-col overflow-hidden shrink-0">
            <div className="flex-1 overflow-y-auto">
              <ObsidianReader
                doc={doc}
                filePath={selectedPath}
                isLoading={docLoading}
                onWikilinkClick={handleNodeClick}
                onClose={handleClose}
                allDocs={graph?.nodes ?? []}
              />
            </div>

            <BacklinksPanel backlinks={backlinks} onSelect={handleNodeClick} />

            {localGraph && localGraph.nodes.length > 1 && (
              <LocalGraph
                graph={localGraph}
                selectedNode={selectedPath}
                onNodeClick={handleNodeClick}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
