"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";

interface Backlink {
  filePath: string;
  title: string;
}

interface BacklinksPanelProps {
  backlinks: Backlink[];
  onSelect: (filePath: string) => void;
}

export function BacklinksPanel({ backlinks, onSelect }: BacklinksPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (backlinks.length === 0) return null;

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <ArrowLeft className="h-3 w-3" />
        <span className="font-semibold uppercase tracking-wider">
          Backlinks ({backlinks.length})
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-1 max-h-36 overflow-y-auto">
          {backlinks.map((bl) => (
            <button
              key={bl.filePath}
              onClick={() => onSelect(bl.filePath)}
              className="w-full text-left text-xs text-purple-400 hover:text-purple-300 truncate py-0.5"
            >
              {bl.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
