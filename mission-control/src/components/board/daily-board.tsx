"use client";

import { useState, useMemo } from "react";
import { UnifiedTaskDialog } from "./unified-task-dialog";
import { useTasks, type Task } from "@/lib/hooks";
import { Plus, ChevronLeft, ChevronRight, Calendar, GripVertical } from "lucide-react";
import {
  format,
  addDays,
  subDays,
  startOfDay,
  isToday,
  parseISO,
} from "date-fns";

const DEPT_COLORS: Record<string, string> = {
  DEV: "#3B82F6",
  CHAIN: "#8B5CF6",
  ART: "#EC4899",
  DESIGN: "#F59E0B",
  NARR: "#14B8A6",
  QA: "#10B981",
  INFRA: "#6B7280",
  MKT: "#EF4444",
  COMM: "#06B6D4",
  BIZ: "#22C55E",
  LEGAL: "#F97316",
  HIRE: "#A855F7",
};

function extractDept(taskId: string): string | null {
  const match = taskId.match(/^([A-Z]+)-/);
  return match ? match[1] : null;
}

function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  running: "bg-green-500/15 text-green-400 border-green-500/20",
  blocked: "bg-red-500/15 text-red-400 border-red-500/20",
  "waiting-user": "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  done: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  cancelled: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

export function DailyBoard() {
  const { tasks, isLoading } = useTasks();
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deptFilter, setDeptFilter] = useState<string | null>(null);

  // Date strip: 7 days centered on selected date
  const stripDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(selectedDate, i - 3));
  }, [selectedDate]);

  // Tasks for the selected date (leaf tasks only)
  const { dayTasks, deptCounts } = useMemo(() => {
    const key = dayKey(selectedDate);
    const filtered: Task[] = [];
    const counts: Record<string, number> = {};

    for (const task of tasks) {
      if (task.scheduledDate !== key) continue;
      if (task.type === "project" || task.type === "pipeline" || task.type === "phase") continue;
      filtered.push(task);
      const dept = extractDept(task.id);
      if (dept) counts[dept] = (counts[dept] || 0) + 1;
    }

    // Sort: critical first, then by ID
    filtered.sort((a, b) => {
      const aCrit = a.description?.includes("CRITICAL") ? 0 : 1;
      const bCrit = b.description?.includes("CRITICAL") ? 0 : 1;
      if (aCrit !== bCrit) return aCrit - bCrit;
      return a.id.localeCompare(b.id);
    });

    return { dayTasks: filtered, deptCounts: counts };
  }, [tasks, selectedDate]);

  // Apply dept filter
  const visibleTasks = useMemo(() => {
    if (!deptFilter) return dayTasks;
    return dayTasks.filter((t) => extractDept(t.id) === deptFilter);
  }, [dayTasks, deptFilter]);

  // Depts present on selected day
  const depts = useMemo(() => {
    return Object.entries(deptCounts).sort((a, b) => b[1] - a[1]);
  }, [deptCounts]);

  const handleTaskClick = (task: Task) => {
    setEditTask(task);
    setDialogOpen(true);
  };

  const handleNewTask = () => {
    setEditTask(null);
    setDialogOpen(true);
  };

  const goToDate = (date: Date) => setSelectedDate(startOfDay(date));
  const goPrev = () => setSelectedDate((d) => subDays(d, 1));
  const goNext = () => setSelectedDate((d) => addDays(d, 1));
  const goToday = () => setSelectedDate(startOfDay(new Date()));
  const goStart = () => {
    // Navigate to the earliest task date, or today if no tasks
    const earliest = tasks.reduce((min: Date, t: Task) => {
      const d = t.createdAt ? startOfDay(parseISO(t.createdAt)) : new Date();
      return d < min ? d : min;
    }, new Date());
    setSelectedDate(startOfDay(earliest));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading tasks...
        </div>
      </div>
    );
  }

  const selectedKey = dayKey(selectedDate);
  const isCurrentDay = isToday(selectedDate);

  return (
    <>
      {/* Date navigation strip */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={goPrev}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex gap-1 flex-1 justify-center">
          {stripDates.map((date) => {
            const key = dayKey(date);
            const isSelected = key === selectedKey;
            const today = isToday(date);
            const count = tasks.filter(
              (t) =>
                t.scheduledDate === key &&
                t.type !== "project" &&
                t.type !== "pipeline" &&
                t.type !== "phase"
            ).length;

            return (
              <button
                key={key}
                onClick={() => goToDate(date)}
                className={`flex flex-col items-center px-3 py-2 rounded-lg transition-all min-w-[72px] ${
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-md scale-105"
                    : today
                    ? "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                    : "bg-card border border-border hover:bg-accent hover:border-accent"
                }`}
              >
                <span className="text-[10px] uppercase font-medium opacity-80">
                  {format(date, "EEE")}
                </span>
                <span className="text-lg font-bold leading-tight">
                  {format(date, "d")}
                </span>
                <span className="text-[10px] opacity-70">
                  {format(date, "MMM")}
                </span>
                {count > 0 && (
                  <span
                    className={`text-[9px] font-medium mt-0.5 px-1.5 rounded-full ${
                      isSelected
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={goNext}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Quick nav + day header */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={goToday}
          className={`px-3 py-1 text-xs rounded-md border transition-colors ${
            isCurrentDay
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          Today
        </button>
        <button
          onClick={goStart}
          className="px-3 py-1 text-xs rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors"
        >
          Pipeline Start
        </button>

        <input
          type="date"
          value={selectedKey}
          onChange={(e) => {
            if (e.target.value) goToDate(parseISO(e.target.value));
          }}
          className="px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />

        <div className="ml-auto text-right">
          <h2 className="text-base font-semibold text-foreground">
            {format(selectedDate, "EEEE, MMMM d, yyyy")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {dayTasks.length} task{dayTasks.length !== 1 ? "s" : ""} scheduled
          </p>
        </div>
      </div>

      {/* Department filter pills */}
      {depts.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <button
            onClick={() => setDeptFilter(null)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              !deptFilter
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            All ({dayTasks.length})
          </button>
          {depts.map(([dept, count]) => (
            <button
              key={dept}
              onClick={() => setDeptFilter(deptFilter === dept ? null : dept)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                deptFilter === dept
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: DEPT_COLORS[dept] || "#6B7280" }}
              />
              {dept}
              <span className="opacity-60">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Task list */}
      <div className="space-y-2 pb-20">
        {visibleTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Calendar className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No tasks scheduled for this day</p>
            <p className="text-xs opacity-60 mt-1">
              Navigate to a pipeline day or create a new task
            </p>
          </div>
        )}

        {visibleTasks.map((task) => {
          const dept = extractDept(task.id);
          const deptColor = dept ? DEPT_COLORS[dept] : "#6B7280";
          const isCritical = task.description?.includes("CRITICAL");
          const isImportant = task.description?.includes("IMPORTANT");
          const statusClass = STATUS_BADGE[task.status] ?? STATUS_BADGE.queued;

          return (
            <div
              key={task.id}
              onClick={() => handleTaskClick(task)}
              className={`group flex items-start gap-3 px-4 py-3 rounded-xl border bg-card hover:bg-accent/30 cursor-pointer transition-all ${
                isCritical
                  ? "border-red-500/30 bg-red-500/5"
                  : isImportant
                  ? "border-yellow-500/30 bg-yellow-500/5"
                  : "border-border"
              }`}
            >
              {/* Dept color bar */}
              <div
                className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                style={{ backgroundColor: deptColor }}
              />

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span
                    className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: `${deptColor}15`,
                      color: deptColor,
                    }}
                  >
                    {task.id}
                  </span>

                  {isCritical && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                      CRITICAL
                    </span>
                  )}
                  {isImportant && !isCritical && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                      IMPORTANT
                    </span>
                  )}

                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${statusClass}`}
                  >
                    {task.status}
                  </span>
                </div>

                <p className="text-sm text-foreground leading-snug">
                  {task.title}
                </p>

                {task.nextAction && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <span className="text-primary">&#8594;</span> {task.nextAction}
                  </p>
                )}
              </div>

              <GripVertical className="h-4 w-4 text-muted-foreground/30 shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          );
        })}
      </div>

      <UnifiedTaskDialog
        item={editTask}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />

      <button
        onClick={handleNewTask}
        className="fixed bottom-6 right-6 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors flex items-center justify-center"
      >
        <Plus className="h-5 w-5" />
      </button>
    </>
  );
}
