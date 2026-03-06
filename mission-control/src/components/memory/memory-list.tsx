"use client";

import { format } from "date-fns";
import { FileText, BookOpen, Database, ChevronRight } from "lucide-react";
import type { MemoryDocListItem } from "@/lib/hooks";

const SOURCE_STYLES: Record<
  string,
  { color: string; dotColor: string; icon: typeof FileText; label: string }
> = {
  daily_log: {
    color: "text-blue-400",
    dotColor: "bg-blue-400",
    icon: FileText,
    label: "Daily Log",
  },
  long_term_memory: {
    color: "text-purple-400",
    dotColor: "bg-purple-400",
    icon: BookOpen,
    label: "Long-Term Memory",
  },
  clawvault: {
    color: "text-amber-400",
    dotColor: "bg-amber-400",
    icon: Database,
    label: "ClawVault",
  },
};

interface MemoryListProps {
  docs: MemoryDocListItem[];
  isLoading: boolean;
  selectedPath: string | null;
  onSelect: (filePath: string) => void;
}

export function MemoryList({
  docs,
  isLoading,
  selectedPath,
  onSelect,
}: MemoryListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-border bg-card p-3.5 h-16"
          >
            <div className="h-4 w-3/4 bg-muted rounded mb-2" />
            <div className="h-3 w-1/3 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-sm text-muted-foreground/50 gap-2">
        <FileText className="h-8 w-8" />
        <p>No memories found</p>
        <p className="text-[10px]">
          Click &ldquo;Sync Memory&rdquo; in the sidebar to index from disk
        </p>
      </div>
    );
  }

  // Group by date for chronological display
  let lastDateGroup = "";

  return (
    <div className="space-y-1">
      {docs.map((doc) => {
        const style = SOURCE_STYLES[doc.source] ?? SOURCE_STYLES.daily_log;
        const Icon = style.icon;
        const isSelected = doc.filePath === selectedPath;

        let dateStr = "";
        let dateGroup = "";
        if (doc.date) {
          try {
            dateStr = format(new Date(doc.date), "MMM d, yyyy");
            dateGroup = format(new Date(doc.date), "MMMM yyyy");
          } catch {
            dateStr = doc.date;
          }
        } else if (doc.modifiedAt) {
          try {
            dateStr = format(new Date(doc.modifiedAt), "MMM d, yyyy");
            dateGroup = format(new Date(doc.modifiedAt), "MMMM yyyy");
          } catch {
            dateStr = "";
          }
        }

        const showDateHeader = dateGroup && dateGroup !== lastDateGroup;
        if (dateGroup) lastDateGroup = dateGroup;

        const fileName = doc.filePath.split("/").pop() ?? "";

        return (
          <div key={doc.id}>
            {showDateHeader && (
              <div className="sticky top-0 bg-background/95 backdrop-blur-sm px-1 py-2 mt-3 first:mt-0">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {dateGroup}
                </p>
              </div>
            )}
            <button
              onClick={() => onSelect(doc.filePath)}
              className={`w-full text-left rounded-lg border px-3.5 py-3 transition-all group ${
                isSelected
                  ? "border-primary/50 bg-primary/5"
                  : "border-transparent hover:border-border hover:bg-card"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg bg-card border border-border shrink-0 ${
                    isSelected ? "border-primary/30" : ""
                  }`}
                >
                  <Icon className={`h-4 w-4 ${style.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {doc.title ?? fileName}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`flex items-center gap-1 text-[10px] ${style.color}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${style.dotColor}`}
                      />
                      {style.label}
                    </span>
                    {dateStr && (
                      <span className="text-[10px] text-muted-foreground">
                        {dateStr}
                      </span>
                    )}
                    {doc.category && (
                      <span className="text-[10px] text-muted-foreground/60 bg-muted rounded px-1.5 py-0.5">
                        {doc.category}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight
                  className={`h-4 w-4 shrink-0 transition-colors ${
                    isSelected
                      ? "text-primary"
                      : "text-muted-foreground/30 group-hover:text-muted-foreground"
                  }`}
                />
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
