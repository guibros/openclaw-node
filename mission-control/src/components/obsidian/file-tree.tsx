"use client";

import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react";
import type { FileNode } from "@/lib/hooks";

interface FileTreeProps {
  tree: FileNode[];
  isLoading: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function FileTree({
  tree,
  isLoading,
  selectedPath,
  onSelect,
}: FileTreeProps) {
  const [search, setSearch] = useState("");

  const filteredTree = useMemo(() => {
    if (!search.trim()) return tree;
    const q = search.toLowerCase();
    return filterTree(tree, q);
  }, [tree, search]);

  if (isLoading) {
    return (
      <div className="p-3 space-y-2 animate-pulse">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-4 bg-muted rounded" style={{ width: `${50 + Math.random() * 50}%` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-2 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter files..."
            className="w-full bg-background border border-border rounded pl-7 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {filteredTree.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            {search ? "No matches" : "Empty workspace"}
          </div>
        ) : (
          filteredTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelect}
              defaultOpen={search.length > 0}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  defaultOpen,
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(
    defaultOpen || depth < 1 || isAncestor(node, selectedPath)
  );
  const isSelected = node.path === selectedPath;
  const isDir = node.type === "dir";
  const isMarkdown = node.ext === ".md" || node.ext === ".txt";
  const isCode = [".ts", ".tsx", ".js", ".sol", ".json", ".yaml", ".yml"].includes(node.ext || "");

  const textColor = isSelected
    ? "text-foreground font-medium"
    : isMarkdown
    ? "text-foreground/80"
    : isCode
    ? "text-blue-400/70"
    : "text-muted-foreground";

  if (isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={`w-full flex items-center gap-1 px-1 py-0.5 rounded text-xs hover:bg-accent/50 ${textColor}`}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          {open ? (
            <FolderOpen className="h-3 w-3 shrink-0 text-amber-400/70" />
          ) : (
            <Folder className="h-3 w-3 shrink-0 text-amber-400/70" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                defaultOpen={defaultOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`w-full flex items-center gap-1 px-1 py-0.5 rounded text-xs hover:bg-accent/50 ${
        isSelected ? "bg-accent" : ""
      } ${textColor}`}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
    >
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

/** Filter tree to only show nodes matching query (and their parent dirs) */
function filterTree(nodes: FileNode[], query: string): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "dir") {
      const filtered = filterTree(node.children || [], query);
      if (filtered.length > 0 || node.name.toLowerCase().includes(query)) {
        result.push({ ...node, children: filtered });
      }
    } else {
      if (node.name.toLowerCase().includes(query)) {
        result.push(node);
      }
    }
  }
  return result;
}

/** Check if a dir node is an ancestor of the selected path */
function isAncestor(node: FileNode, selectedPath: string | null): boolean {
  if (!selectedPath || node.type !== "dir") return false;
  return selectedPath.startsWith(node.path + "/");
}
