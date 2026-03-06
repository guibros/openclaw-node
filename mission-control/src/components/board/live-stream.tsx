"use client";

import { useLiveActivity } from "@/lib/hooks";
import { format } from "date-fns";
import {
  FileText,
  Edit3,
  Eye,
  Terminal,
  Zap,
} from "lucide-react";

const TYPE_CONFIG: Record<
  string,
  { icon: typeof FileText; color: string; label: string }
> = {
  file_write: { icon: FileText, color: "text-blue-400", label: "Write" },
  file_edit: { icon: Edit3, color: "text-yellow-400", label: "Edit" },
  file_read: { icon: Eye, color: "text-zinc-400", label: "Read" },
  bash_command: { icon: Terminal, color: "text-green-400", label: "Bash" },
  message: { icon: Zap, color: "text-purple-400", label: "Message" },
};

export function LiveStream() {
  const { events, isLoading } = useLiveActivity(40);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-1.5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-6 bg-muted rounded" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/50 py-4 text-center">
        No transcript activity detected. Start working to see live events.
      </div>
    );
  }

  // Group consecutive reads into a single entry to reduce noise
  const collapsed = collapseReads(events);

  return (
    <div className="space-y-0.5 font-mono">
      {collapsed.map((event, i) => {
        const config = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.message;
        const Icon = config.icon;

        let timeStr = "";
        try {
          timeStr = format(new Date(event.timestamp), "HH:mm:ss");
        } catch {
          timeStr = "";
        }

        return (
          <div
            key={`${event.timestamp}-${i}`}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/20 transition-colors"
          >
            <span className="text-[10px] text-muted-foreground/50 w-[60px] shrink-0 tabular-nums">
              {timeStr}
            </span>
            <Icon className={`h-3 w-3 shrink-0 ${config.color}`} />
            <span className={`text-[10px] font-medium w-[36px] shrink-0 ${config.color}`}>
              {config.label}
            </span>
            <span className="text-[11px] text-foreground/70 truncate">
              {event.detail}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Collapse consecutive file_read events into a summary to reduce noise.
 */
function collapseReads(
  events: Array<{ timestamp: string; type: string; tool: string; detail: string; filePath?: string }>
) {
  const result: typeof events = [];
  let readBatch: typeof events = [];

  const flushReads = () => {
    if (readBatch.length === 0) return;
    if (readBatch.length <= 2) {
      result.push(...readBatch);
    } else {
      result.push({
        ...readBatch[0],
        detail: `Read ${readBatch.length} files`,
      });
    }
    readBatch = [];
  };

  for (const event of events) {
    if (event.type === "file_read") {
      readBatch.push(event);
    } else {
      flushReads();
      result.push(event);
    }
  }
  flushReads();

  return result;
}
