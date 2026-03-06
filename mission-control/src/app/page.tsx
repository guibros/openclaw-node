"use client";

import { useState } from "react";
import { KanbanBoard } from "@/components/board/kanban-board";
import { DailyBoard } from "@/components/board/daily-board";
import { StatusBanner } from "@/components/board/status-banner";
import { ActivityTimeline } from "@/components/board/activity-timeline";
import { SkillHealthCard } from "@/components/board/skill-health-card";
import { useSchedulerTick } from "@/lib/hooks";
import { LayoutGrid, Calendar } from "lucide-react";

type ViewMode = "status" | "daily";

export default function TaskBoardPage() {
  useSchedulerTick();
  const [view, setView] = useState<ViewMode>("status");

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Task Board</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-actualizes from workspace activity
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setView("status")}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
              view === "status"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Status
          </button>
          <button
            onClick={() => setView("daily")}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
              view === "daily"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Daily
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
          <StatusBanner />
          <SkillHealthCard />
        </div>
        {view === "status" ? <KanbanBoard /> : <DailyBoard />}
        <div className="border-t border-border pt-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Task Activity
          </h2>
          <ActivityTimeline />
        </div>
      </div>
    </div>
  );
}
