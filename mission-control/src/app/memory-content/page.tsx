"use client";

import { useState } from "react";
import { Brain, Lightbulb, Tag, ChevronRight } from "lucide-react";
import { useMemoryContent, useEntityProse } from "@/lib/hooks";

function salColor(s: number): string {
  if (s >= 0.8) return "text-green-400";
  if (s >= 0.4) return "text-yellow-400";
  return "text-muted-foreground";
}

function EntityCard({ name, type, mention_count, salience }: {
  name: string; type: string; mention_count: number; salience: number;
}) {
  const [open, setOpen] = useState(false);
  const { prose, isLoading } = useEntityProse(open ? name : null);
  return (
    <div className="border-b border-border/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/30 font-mono text-xs"
      >
        <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="text-foreground font-medium truncate flex-1">{name}</span>
        <span className="text-muted-foreground shrink-0">{type}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">{mention_count}×</span>
        <span className={`shrink-0 tabular-nums w-10 text-right ${salColor(salience)}`}>{salience.toFixed(2)}</span>
      </button>
      {open && (
        <div className="px-9 pb-3 text-xs text-muted-foreground whitespace-pre-wrap">
          {isLoading ? "loading…" : prose || <span className="italic">No concept note written yet for this entity.</span>}
        </div>
      )}
    </div>
  );
}

export default function MemoryContentPage() {
  const [tab, setTab] = useState<"entities" | "decisions" | "themes">("entities");
  const [q, setQ] = useState("");
  const { entities, decisions, themes, counts, isLoading, error } = useMemoryContent(q);

  const tabs = [
    { id: "entities" as const, label: "Entities", icon: Brain, n: counts?.entities },
    { id: "decisions" as const, label: "Decisions", icon: Lightbulb, n: counts?.decisions },
    { id: "themes" as const, label: "Themes", icon: Tag, n: counts?.themes },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <h1 className="text-sm font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4" /> Memory Content
          <span className="text-xs text-muted-foreground font-normal">— what the AI currently remembers (live state.db)</span>
        </h1>
      </div>

      <div className="flex items-center gap-1 px-4 py-2 border-b border-border">
        {tabs.map(({ id, label, icon: Icon, n }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs ${
              tab === id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/40"
            }`}
          >
            <Icon className="w-3 h-3" /> {label}
            {n !== undefined && <span className="tabular-nums opacity-70">{n}</span>}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter…"
          className="ml-auto bg-muted/40 rounded px-2 py-1 text-xs w-48 outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && <div className="p-4 text-xs text-red-400">Failed to load: {String(error)}</div>}
        {isLoading && <div className="p-4 text-xs text-muted-foreground">loading…</div>}

        {tab === "entities" &&
          entities.map((e, i) => (
            <EntityCard key={`${e.name}-${i}`} name={e.name} type={e.type} mention_count={e.mention_count} salience={e.salience} />
          ))}

        {tab === "decisions" &&
          decisions.map((d, i) => (
            <div key={i} className="px-4 py-2.5 border-b border-border/40 text-xs">
              <div className="text-foreground font-medium flex items-start gap-2">
                <Lightbulb className="w-3 h-3 mt-0.5 shrink-0 text-yellow-400" />
                <span>{d.decision}</span>
                <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{(d.confidence * 100).toFixed(0)}%</span>
              </div>
              <div className="pl-5 mt-1 text-muted-foreground">{d.rationale}</div>
            </div>
          ))}

        {tab === "themes" &&
          themes.map((t, i) => (
            <div key={i} className="px-4 py-2 border-b border-border/40 text-xs flex items-center gap-2">
              <Tag className="w-3 h-3 shrink-0 text-muted-foreground" />
              <span className="text-foreground">{t.label}</span>
              {t.hierarchy.length > 0 && (
                <span className="text-muted-foreground/70 font-mono text-[10px]">{t.hierarchy.join(" › ")}</span>
              )}
              <span className="ml-auto text-muted-foreground tabular-nums">{t.mention_count}×</span>
            </div>
          ))}
      </div>
    </div>
  );
}
