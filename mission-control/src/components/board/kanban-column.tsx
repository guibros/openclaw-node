"use client";

import { useState, useMemo } from "react";
import { TaskCard, SignetCard } from "./task-card";
import type { Task } from "@/lib/hooks";
import { X, ChevronDown } from "lucide-react";

export type CardSize = "full" | "compact" | "signet";

const COLUMN_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

const COLUMN_DOT_COLORS: Record<string, string> = {
  backlog: "bg-blue-400",
  in_progress: "bg-green-400",
  review: "bg-yellow-400",
  done: "bg-zinc-400",
};

const DONE_WINDOWS = [
  { key: "1d", label: "Today", ms: 24 * 60 * 60 * 1000 },
  { key: "3d", label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Week", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All", ms: 0 },
] as const;

interface KanbanColumnProps {
  column: string;
  tasks: Task[];
  childrenMap: Record<string, Task[]>;
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: string, targetColumn: string) => void;
  onClearDone?: () => void;
  label?: string;
  dotColor?: string;
  highlight?: boolean;
  bulkMode?: boolean;
  bulkSelection?: Set<string>;
  cardSize?: CardSize;
}

export function KanbanColumn({
  column,
  tasks,
  childrenMap,
  onTaskClick,
  onMoveTask,
  onClearDone,
  label,
  dotColor,
  highlight,
  bulkMode,
  bulkSelection,
  cardSize = column === "done" ? "signet" : "full",
}: KanbanColumnProps) {
  const [dragOver, setDragOver] = useState(false);
  const [doneWindow, setDoneWindow] = useState<string>("3d");
  const [doneWindowOpen, setDoneWindowOpen] = useState(false);
  // Track expanded signets (signet → full card inline)
  const [expandedSignets, setExpandedSignets] = useState<Set<string>>(new Set());

  // Filter done column by time window
  const filteredTasks = useMemo(() => {
    if (column !== "done" || doneWindow === "all") return tasks;
    const windowDef = DONE_WINDOWS.find((w) => w.key === doneWindow);
    if (!windowDef || windowDef.ms === 0) return tasks;
    const cutoff = Date.now() - windowDef.ms;
    return tasks.filter((t) => {
      const ts = new Date(t.updatedAt).getTime();
      return ts >= cutoff;
    });
  }, [tasks, column, doneWindow]);

  const hiddenCount = tasks.length - filteredTasks.length;

  return (
    <div
      className={`flex flex-col rounded-xl border bg-background min-w-0 w-full transition-colors ${
        dragOver ? "border-primary bg-primary/5" : highlight ? "border-primary/40 bg-primary/5" : "border-border"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const taskId = e.dataTransfer.getData("text/plain");
        if (taskId) {
          onMoveTask(taskId, column);
        }
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <div
          className={`h-2 w-2 rounded-full ${
            dotColor ?? COLUMN_DOT_COLORS[column] ?? "bg-zinc-400"
          }`}
        />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          {label ?? COLUMN_LABELS[column] ?? column}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {filteredTasks.length}
          {hiddenCount > 0 && (
            <span className="text-muted-foreground/40"> ({hiddenCount} older)</span>
          )}
        </span>
      </div>

      {/* Done column controls */}
      {column === "done" && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/50">
          {/* Time window selector */}
          <div className="relative">
            <button
              onClick={() => setDoneWindowOpen(!doneWindowOpen)}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-muted-foreground rounded hover:bg-accent transition-colors"
            >
              {DONE_WINDOWS.find((w) => w.key === doneWindow)?.label ?? "3 days"}
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
            {doneWindowOpen && (
              <div className="absolute top-full left-0 mt-0.5 z-20 bg-card border border-border rounded-md shadow-lg py-0.5">
                {DONE_WINDOWS.map((w) => (
                  <button
                    key={w.key}
                    onClick={() => {
                      setDoneWindow(w.key);
                      setDoneWindowOpen(false);
                    }}
                    className={`block w-full text-left px-3 py-1 text-[10px] hover:bg-accent transition-colors ${
                      doneWindow === w.key ? "text-foreground font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear done button */}
          {onClearDone && filteredTasks.length > 0 && (
            <button
              onClick={onClearDone}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
              title="Archive visible done tasks"
            >
              <X className="h-2.5 w-2.5" />
              Clear
            </button>
          )}
        </div>
      )}

      <div className={`flex-1 overflow-y-auto p-2 ${cardSize === "signet" ? "space-y-1" : "space-y-2"} min-h-[120px]`}>
        {filteredTasks.map((task) => {
          const isExpandedSignet = expandedSignets.has(task.id);
          const effectiveSize = isExpandedSignet ? "full" : cardSize;

          if (effectiveSize === "signet") {
            return (
              <SignetCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task)}
                onExpand={() => {
                  setExpandedSignets((prev) => {
                    const next = new Set(prev);
                    next.add(task.id);
                    return next;
                  });
                }}
              />
            );
          }

          return (
            <TaskCard
              key={task.id}
              task={task}
              children={childrenMap[task.id] ?? []}
              currentColumn={column}
              onClick={() => {
                if (isExpandedSignet) {
                  // Expanded signet → click opens edit dialog
                  onTaskClick(task);
                  // Collapse back to signet
                  setExpandedSignets((prev) => {
                    const next = new Set(prev);
                    next.delete(task.id);
                    return next;
                  });
                } else {
                  onTaskClick(task);
                }
              }}
              onTaskClick={onTaskClick}
              onMove={(targetCol) => onMoveTask(task.id, targetCol)}
              selected={bulkMode && bulkSelection?.has(task.id)}
              bulkMode={bulkMode}
            />
          );
        })}

        {filteredTasks.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50">
            {dragOver ? "Drop here" : "No tasks"}
          </div>
        )}
      </div>
    </div>
  );
}
