"use client";

import { useTasks } from "@/lib/hooks";
import { Loader2, Coffee, Zap, Server } from "lucide-react";

const CAP_WEIGHTS: Record<string, number> = { light: 0.5, normal: 1.0, heavy: 2.0 };
const MAX_CAP = 2.0;

export function StatusBanner() {
  const { tasks } = useTasks();

  const activeTasks = tasks.filter(
    (t) => t.kanbanColumn === "in_progress" && t.status !== "done"
  );

  // Separate live session task from regular tasks
  const liveTask = activeTasks.find((t) => t.id === "__LIVE_SESSION__");
  const regularActive = activeTasks.filter((t) => t.id !== "__LIVE_SESSION__");

  // Scheduler capacity
  const usedCap = regularActive.reduce(
    (sum, t) => sum + (CAP_WEIGHTS[t.capacityClass || "normal"] || 1.0),
    0
  );
  const readyCount = tasks.filter((t) => t.status === "ready").length;

  if (!liveTask && regularActive.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <Coffee className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Daedalus is idle — no active work
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            Waiting for instructions or drag a task to In Progress
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {liveTask && (
        <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3.5">
          <div className="relative">
            <Zap className="h-5 w-5 text-green-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-green-400/80 uppercase tracking-wider">
              Live Session
            </p>
            <p className="text-sm font-medium text-foreground mt-0.5">
              {liveTask.title}
            </p>
            {liveTask.nextAction && (
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">
                Next: {liveTask.nextAction}
              </p>
            )}
          </div>
        </div>
      )}

      {regularActive.map((task) => {
        const isMesh = task.execution === "mesh";
        const borderColor = isMesh ? "border-cyan-500/30 bg-cyan-500/5" : "border-blue-500/30 bg-blue-500/5";
        const accentColor = isMesh ? "text-cyan-400" : "text-blue-400";
        return (
          <div
            key={task.id}
            className={`flex items-center gap-3 rounded-lg border ${borderColor} px-4 py-3`}
          >
            {isMesh ? (
              <Server className={`h-4 w-4 ${accentColor}`} />
            ) : (
              <Loader2 className={`h-4 w-4 ${accentColor} animate-spin`} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {task.title}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {task.owner && (
                  <span className={`text-[10px] ${accentColor}/80`}>
                    {task.owner}
                  </span>
                )}
                {isMesh && task.meshNode && (
                  <span className="text-[10px] text-cyan-400/80 font-mono">
                    on {task.meshNode}
                  </span>
                )}
                {isMesh && task.budgetMinutes && (
                  <span className="text-[10px] text-muted-foreground">
                    {task.budgetMinutes}m budget
                  </span>
                )}
                {task.meshTaskId && (
                  <span className="text-[10px] text-muted-foreground/60 font-mono">
                    {task.meshTaskId}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {(usedCap > 0 || readyCount > 0) && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-1 pt-1">
          <span>Capacity: {usedCap.toFixed(1)} / {MAX_CAP}</span>
          {readyCount > 0 && (
            <span className="text-orange-400">
              {readyCount} triggered, awaiting dispatch
            </span>
          )}
        </div>
      )}
    </div>
  );
}
