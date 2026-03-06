"use client";

import { useState, useEffect } from "react";
import { Search } from "lucide-react";

const SOURCES = [
  { key: undefined as string | undefined, label: "All" },
  { key: "daily_log", label: "Daily Logs" },
  { key: "long_term_memory", label: "Long-Term" },
  { key: "clawvault", label: "ClawVault" },
];

interface SearchBarProps {
  onQueryChange: (query: string) => void;
  onSourceChange: (source: string | undefined) => void;
  source: string | undefined;
  showInput?: boolean;
}

export function SearchBar({
  onQueryChange,
  onSourceChange,
  source,
  showInput = true,
}: SearchBarProps) {
  const [input, setInput] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      onQueryChange(input);
    }, 300);
    return () => clearTimeout(timer);
  }, [input, onQueryChange]);

  return (
    <div className="space-y-3">
      {showInput && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search memory..."
            className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
        </div>
      )}
      <div className="flex gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.label}
            onClick={() => onSourceChange(s.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              source === s.key
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
