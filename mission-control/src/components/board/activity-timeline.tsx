"use client";

import { useActivity } from "@/lib/hooks";
import { format } from "date-fns";
import {
  Plus,
  ArrowRight,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Edit3,
  Activity,
} from "lucide-react";

const EVENT_ICONS: Record<string, typeof Plus> = {
  task_created: Plus,
  task_moved: ArrowRight,
  task_completed: CheckCircle2,
  task_failed: XCircle,
  task_updated: Edit3,
  sync: RefreshCw,
};

const EVENT_COLORS: Record<string, string> = {
  task_created: "text-blue-400",
  task_moved: "text-yellow-400",
  task_completed: "text-green-400",
  task_failed: "text-red-400",
  task_updated: "text-zinc-400",
  sync: "text-purple-400",
};

export function ActivityTimeline() {
  const { entries, isLoading } = useActivity(30);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-8 bg-muted rounded" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/50 py-4 text-center">
        No activity yet. Create or update a task to see events here.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const Icon = EVENT_ICONS[entry.eventType] ?? Activity;
        const color = EVENT_COLORS[entry.eventType] ?? "text-zinc-400";

        let timeStr = "";
        try {
          timeStr = format(new Date(entry.timestamp), "HH:mm");
        } catch {
          timeStr = "";
        }

        let dateStr = "";
        try {
          dateStr = format(new Date(entry.timestamp), "MMM d");
        } catch {
          dateStr = "";
        }

        return (
          <div
            key={entry.id}
            className="flex items-center gap-3 rounded-md px-3 py-1.5 hover:bg-accent/30 transition-colors"
          >
            <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
            <p className="flex-1 text-xs text-foreground/80 truncate">
              {entry.description}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-muted-foreground/60">
                {dateStr}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {timeStr}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
