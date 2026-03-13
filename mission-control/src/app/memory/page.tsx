"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useMemorySearch, useMemoryDocs, useMemoryDoc } from "@/lib/hooks";
import { MemoryList } from "@/components/memory/memory-list";
import { SearchResults } from "@/components/memory/search-results";
import { DocReader } from "@/components/memory/doc-reader";
import { Search, FileText, BookOpen, Database, Brain } from "lucide-react";

const SOURCES = [
  { key: undefined as string | undefined, label: "All", icon: Brain },
  { key: "daily_log", label: "Daily Logs", icon: FileText },
  { key: "long_term_memory", label: "Long-Term", icon: BookOpen },
  { key: "clawvault", label: "ClawVault", icon: Database },
];

export default function MemoryPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [source, setSource] = useState<string | undefined>(undefined);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const { docs, total: docCount, isLoading: docsLoading } = useMemoryDocs(source);
  const { results, total: searchTotal, isLoading: searchLoading } = useMemorySearch(
    debouncedQuery,
    30,
    source
  );

  const isSearching = debouncedQuery.length >= 2;

  // Debounce search input
  const debounceRef = useRef<NodeJS.Timeout>();
  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
    },
    []
  );

  // Stats for the header
  const stats = useMemo(() => {
    const bySource: Record<string, number> = {};
    for (const doc of docs) {
      bySource[doc.source] = (bySource[doc.source] || 0) + 1;
    }
    return bySource;
  }, [docs]);

  return (
    <div className="h-full flex flex-col">
      {/* Header with stats */}
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Memory</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Every memory Daedalus has ever created
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3 text-blue-400" />
              {stats.daily_log ?? 0} daily logs
            </span>
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3 text-purple-400" />
              {stats.long_term_memory ?? 0} long-term
            </span>
            <span className="flex items-center gap-1">
              <Database className="h-3 w-3 text-amber-400" />
              {stats.clawvault ?? 0} vault docs
            </span>
          </div>
        </div>
      </header>

      {/* Search + filter bar */}
      <div className="px-6 py-3 border-b border-border space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search all memories..."
            className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              {searchTotal} result{searchTotal !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            const count = s.key ? (stats[s.key] ?? 0) : docCount;
            return (
              <button
                key={s.label}
                onClick={() => setSource(s.key)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  source === s.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3" />
                {s.label}
                <span className="opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main content: document list + reader */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: memory list or search results */}
        <div className="w-[40%] min-w-[320px] border-r border-border overflow-y-auto">
          {isSearching ? (
            <div className="p-4">
              <SearchResults
                results={results}
                total={searchTotal}
                isLoading={searchLoading}
                query={debouncedQuery}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            </div>
          ) : (
            <div className="p-4">
              <MemoryList
                docs={docs}
                isLoading={docsLoading}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            </div>
          )}
        </div>

        {/* Right panel: document reader */}
        <div className="flex-1 overflow-hidden">
          <DocReader filePath={selectedPath} />
        </div>
      </div>
    </div>
  );
}
