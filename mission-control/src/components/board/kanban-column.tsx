"use client";

import { useState } from "react";
import { TaskCard } from "./task-card";
import type { Task } from "@/lib/hooks";

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

interface KanbanColumnProps {
  column: string;
  tasks: Task[];
  childrenMap: Record<string, Task[]>;
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: string, targetColumn: string) => void;
  label?: string;
  dotColor?: string;
  highlight?: boolean;
  bulkMode?: boolean;
  bulkSelection?: Set<string>;
}

export function KanbanColumn({
  column,
  tasks,
  childrenMap,
  onTaskClick,
  onMoveTask,
  label,
  dotColor,
  highlight,
  bulkMode,
  bulkSelection,
}: KanbanColumnProps) {
  const [dragOver, setDragOver] = useState(false);

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
          {tasks.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            children={childrenMap[task.id] ?? []}
            currentColumn={column}
            onClick={() => onTaskClick(task)}
            onTaskClick={onTaskClick}
            onMove={(targetCol) => onMoveTask(task.id, targetCol)}
            selected={bulkMode && bulkSelection?.has(task.id)}
            bulkMode={bulkMode}
          />
        ))}

        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50">
            {dragOver ? "Drop here" : "No tasks"}
          </div>
        )}
      </div>
    </div>
  );
}
