"use client";

import { format } from "date-fns";
import { FileText, BookOpen, Database } from "lucide-react";
import type { MemoryResult } from "@/lib/hooks";

const SOURCE_STYLES: Record<string, { color: string; icon: typeof FileText }> = {
  daily_log: { color: "bg-blue-500/20 text-blue-400", icon: FileText },
  long_term_memory: { color: "bg-purple-500/20 text-purple-400", icon: BookOpen },
  clawvault: { color: "bg-amber-500/20 text-amber-400", icon: Database },
};

interface SearchResultsProps {
  results: MemoryResult[];
  total: number;
  isLoading: boolean;
  query: string;
  selectedPath: string | null;
  onSelect: (filePath: string) => void;
}

export function SearchResults({
  results,
  total,
  isLoading,
  query,
  selectedPath,
  onSelect,
}: SearchResultsProps) {
  if (query.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground/50">
        Type at least 2 characters to search...
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg bg-card p-4">
            <div className="h-4 w-2/3 bg-muted rounded" />
            <div className="mt-2 h-3 w-full bg-muted rounded" />
            <div className="mt-1 h-3 w-4/5 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground/50">
        No results for &ldquo;{query}&rdquo;
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground mb-2">
        {total} result{total !== 1 ? "s" : ""}
      </p>
      {results.map((result) => {
        const sourceStyle = SOURCE_STYLES[result.source] ?? SOURCE_STYLES.daily_log;
        const Icon = sourceStyle.icon;
        const isSelected = result.filePath === selectedPath;

        let dateStr = "";
        if (result.date) {
          try {
            dateStr = format(new Date(result.date), "MMM d, yyyy");
          } catch {
            dateStr = result.date;
          }
        }

        return (
          <button
            key={result.id}
            onClick={() => onSelect(result.filePath)}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              isSelected
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-border hover:bg-accent/50"
            }`}
          >
            <div className="flex items-start gap-2">
              <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {result.title ?? result.filePath.split("/").pop()}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${sourceStyle.color}`}
                  >
                    {result.source.replace("_", " ")}
                  </span>
                  {dateStr && (
                    <span className="text-[10px] text-muted-foreground">
                      {dateStr}
                    </span>
                  )}
                </div>
                <p
                  className="mt-1.5 text-xs text-muted-foreground line-clamp-2 [&_mark]:bg-yellow-500/30 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5"
                  dangerouslySetInnerHTML={{ __html: result.excerpt.replace(/<(?!\/?mark\b)[^>]*>/gi, "") }}
                />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
