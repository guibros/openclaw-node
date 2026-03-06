"use client";

import { useState, useMemo } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  parseISO,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Clock, User } from "lucide-react";
import { useTasks, updateTask, type Task } from "@/lib/hooks";
import { UnifiedTaskDialog } from "@/components/board/unified-task-dialog";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-green-500/80",
  blocked: "bg-red-500/80",
  "waiting-user": "bg-yellow-500/80",
  queued: "bg-blue-500/80",
  "not started": "bg-blue-500/80",
  done: "bg-zinc-500/60",
  cancelled: "bg-zinc-500/40",
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  running: "bg-green-500/15 text-green-400 border-green-500/20",
  blocked: "bg-red-500/15 text-red-400 border-red-500/20",
  "waiting-user": "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  queued: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "not started": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  done: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  cancelled: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isMetaTask(task: Task): boolean {
  return task.type === "project" || task.type === "pipeline" || task.type === "phase";
}

const META_TYPE_LABELS: Record<string, string> = {
  project: "PRJ",
  pipeline: "PIPE",
  phase: "PH",
};

type ViewMode = "month" | "week" | "day";

const VIEW_LABELS: Record<ViewMode, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

function extractEstimate(desc: string | null): string | null {
  if (!desc) return null;
  const m = desc.match(/(\d+(?:\.\d+)?h)/);
  return m ? m[1] : null;
}

function extractDept(desc: string | null): string | null {
  if (!desc) return null;
  return desc.split(" · ")[0]?.trim() || null;
}

export default function CalendarPage() {
  const { tasks, isLoading } = useTasks();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [currentDay, setCurrentDay] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedProject, setSelectedProject] = useState<string | "all">("all");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  // Get all distinct projects from tasks
  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.project) set.add(t.project);
    }
    return Array.from(set).sort();
  }, [tasks]);

  // Filter tasks by project
  const filteredTasks = useMemo(() => {
    if (selectedProject === "all") return tasks;
    return tasks.filter((t) => t.project === selectedProject);
  }, [tasks, selectedProject]);

  // Scheduled tasks grouped by date (excludes meta-tasks)
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filteredTasks) {
      if (isMetaTask(t)) continue;
      if (t.scheduledDate) {
        const key = t.scheduledDate;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(t);
      }
    }
    return map;
  }, [filteredTasks]);

  // Unscheduled tasks (no scheduledDate, not done/cancelled, not meta-tasks)
  const unscheduledTasks = useMemo(
    () =>
      filteredTasks.filter(
        (t) =>
          !isMetaTask(t) &&
          !t.scheduledDate &&
          t.status !== "done" &&
          t.status !== "cancelled" &&
          t.id !== "__LIVE_SESSION__"
      ),
    [filteredTasks]
  );

  // Month grid days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  // Week grid days
  const weekDays = useMemo(() => {
    const ws = startOfWeek(currentWeek, { weekStartsOn: 1 });
    const we = endOfWeek(currentWeek, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: ws, end: we });
  }, [currentWeek]);

  // Meta-tasks expanded per-day (for week + day views)
  const metaTasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filteredTasks) {
      if (!isMetaTask(t)) continue;
      if (!t.showInCalendar) continue;
      if (!t.startDate || !t.endDate) continue;
      const start = parseISO(t.startDate);
      const end = parseISO(t.endDate);
      const days = eachDayOfInterval({ start, end });
      for (const day of days) {
        const key = format(day, "yyyy-MM-dd");
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(t);
      }
    }
    return map;
  }, [filteredTasks]);

  // Meta-task bar segments per week row (for month view overlay)
  const metaBars = useMemo(() => {
    const bars: { key: string; task: Task; row: number; colStart: number; colEnd: number }[] = [];
    const metaTasks = filteredTasks.filter(
      (t) => isMetaTask(t) && t.showInCalendar && t.startDate && t.endDate
    );
    const totalWeeks = Math.ceil(calendarDays.length / 7);

    for (const meta of metaTasks) {
      const mStart = parseISO(meta.startDate!);
      const mEnd = parseISO(meta.endDate!);

      for (let w = 0; w < totalWeeks; w++) {
        const weekStart = calendarDays[w * 7];
        const weekEnd = calendarDays[w * 7 + 6];
        if (mEnd < weekStart || mStart > weekEnd) continue;

        const barStart = mStart < weekStart ? weekStart : mStart;
        const barEnd = mEnd > weekEnd ? weekEnd : mEnd;
        // Mon=1..Sun=7 for CSS grid
        const colStart = barStart.getDay() === 0 ? 7 : barStart.getDay();
        const colEnd = barEnd.getDay() === 0 ? 7 : barEnd.getDay();

        bars.push({ key: `${meta.id}-w${w}`, task: meta, row: w + 1, colStart, colEnd });
      }
    }
    return bars;
  }, [filteredTasks, calendarDays]);


  // Day view tasks
  const dayViewTasks = useMemo(() => {
    return tasksByDate.get(format(currentDay, "yyyy-MM-dd")) ?? [];
  }, [currentDay, tasksByDate]);

  // --- Navigation ---
  const navigateBack = () => {
    switch (viewMode) {
      case "month": setCurrentMonth(subMonths(currentMonth, 1)); break;
      case "week": setCurrentWeek(subWeeks(currentWeek, 1)); break;
      case "day": setCurrentDay(subDays(currentDay, 1)); break;
    }
  };

  const navigateForward = () => {
    switch (viewMode) {
      case "month": setCurrentMonth(addMonths(currentMonth, 1)); break;
      case "week": setCurrentWeek(addWeeks(currentWeek, 1)); break;
      case "day": setCurrentDay(addDays(currentDay, 1)); break;
    }
  };

  const navigateToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setCurrentWeek(today);
    setCurrentDay(today);
  };

  const navigationLabel = (): string => {
    switch (viewMode) {
      case "month": return format(currentMonth, "MMMM yyyy");
      case "week": {
        const ws = startOfWeek(currentWeek, { weekStartsOn: 1 });
        const we = endOfWeek(currentWeek, { weekStartsOn: 1 });
        return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
      }
      case "day": return format(currentDay, "EEEE, MMMM d, yyyy");
    }
  };

  const handleViewChange = (mode: ViewMode) => {
    if (mode === "week" && viewMode === "month") {
      setCurrentWeek(startOfMonth(currentMonth));
    } else if (mode === "day" && viewMode === "month") {
      const today = new Date();
      setCurrentDay(isSameMonth(today, currentMonth) ? today : startOfMonth(currentMonth));
    } else if (mode === "month" && viewMode === "week") {
      setCurrentMonth(currentWeek);
    } else if (mode === "month" && viewMode === "day") {
      setCurrentMonth(currentDay);
    } else if (mode === "week" && viewMode === "day") {
      setCurrentWeek(currentDay);
    } else if (mode === "day" && viewMode === "week") {
      const today = new Date();
      const ws = startOfWeek(currentWeek, { weekStartsOn: 1 });
      const we = endOfWeek(currentWeek, { weekStartsOn: 1 });
      setCurrentDay(today >= ws && today <= we ? today : ws);
    }
    setViewMode(mode);
  };

  // --- Handlers ---
  const handleDrop = async (date: Date) => {
    if (!draggedTaskId) return;
    const dateStr = format(date, "yyyy-MM-dd");
    await updateTask(draggedTaskId, {
      scheduledDate: dateStr,
    } as Record<string, unknown>);
    setDraggedTaskId(null);
  };

  const handleCreateOnDate = (date: Date) => {
    setCreateDate(format(date, "yyyy-MM-dd"));
    setEditTask(null);
    setDialogOpen(true);
  };

  const openTask = (task: Task) => {
    setEditTask(task);
    setCreateDate(null);
    setDialogOpen(true);
  };

  const drillToDay = (day: Date) => {
    setCurrentDay(day);
    setViewMode("day");
  };

  // Shared drop handlers for day cells
  const cellDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add("bg-primary/10");
  };
  const cellDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove("bg-primary/10");
  };
  const cellDrop = (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    e.currentTarget.classList.remove("bg-primary/10");
    handleDrop(day);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-foreground">Calendar</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={navigateBack}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium text-foreground min-w-[200px] text-center">
              {navigationLabel()}
            </span>
            <button
              onClick={navigateForward}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <button
            onClick={navigateToday}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
          >
            Today
          </button>

          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {(["month", "week", "day"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => handleViewChange(mode)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        {/* Project filter */}
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-auto p-4">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Loading...
            </div>
          ) : viewMode === "month" ? (
            /* ========== MONTH VIEW ========== */
            <>
              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAY_NAMES.map((day) => (
                  <div
                    key={day}
                    className="text-center text-xs font-medium text-muted-foreground py-2"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Week rows — each row has cells + a bar overlay */}
              <div className="flex flex-col gap-px bg-border/50 rounded-lg">
                {Array.from({ length: Math.ceil(calendarDays.length / 7) }, (_, wi) => {
                  const weekCells = calendarDays.slice(wi * 7, wi * 7 + 7);
                  const rowBars = metaBars.filter((b) => b.row === wi + 1);

                  return (
                    <div key={wi} className="flex flex-col">
                      {/* Meta-task bars — thin line with overflowing label */}
                      {rowBars.length > 0 && (
                        <div className="grid grid-cols-7 relative" style={{ height: "6px" }}>
                          {rowBars.map((bar) => {
                            const isFirst = bar.task.startDate === format(weekCells[bar.colStart - 1], "yyyy-MM-dd");
                            const isLast = bar.task.endDate === format(weekCells[bar.colEnd - 1], "yyyy-MM-dd");
                            return (
                              <div
                                key={bar.key}
                                onClick={(e) => { e.stopPropagation(); openTask(bar.task); }}
                                className="cursor-pointer relative overflow-visible"
                                style={{
                                  gridColumn: `${bar.colStart} / ${bar.colEnd + 1}`,
                                  height: "4px",
                                  marginTop: "1px",
                                  backgroundColor: bar.task.color || "#7c3aed",
                                  borderRadius: isFirst && isLast ? "2px" : isFirst ? "2px 0 0 2px" : isLast ? "0 2px 2px 0" : "0",
                                }}
                                title={`${bar.task.title} (${bar.task.type}) ${bar.task.startDate} → ${bar.task.endDate}`}
                              >
                                <span
                                  className="absolute left-1 top-1/2 -translate-y-1/2 whitespace-nowrap text-[8px] font-medium pointer-events-none z-10 text-white/90"
                                >
                                  {bar.task.title}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Day cells */}
                      <div className="grid grid-cols-7 gap-px">
                        {weekCells.map((day) => {
                          const dateStr = format(day, "yyyy-MM-dd");
                          const dayTasks = tasksByDate.get(dateStr) ?? [];
                          const isCurrentMonth = isSameMonth(day, currentMonth);
                          const today = isToday(day);

                          return (
                            <div
                              key={dateStr}
                              className={`min-h-[90px] p-1.5 flex flex-col ${
                                isCurrentMonth ? "bg-card" : "bg-card/40"
                              } ${today ? "ring-1 ring-inset ring-primary/50 rounded-lg" : ""}`}
                              onDragOver={cellDragOver}
                              onDragLeave={cellDragLeave}
                              onDrop={(e) => cellDrop(e, day)}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span
                                  className={`text-xs font-medium leading-none cursor-pointer hover:underline ${
                                    today
                                      ? "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center"
                                      : isCurrentMonth
                                      ? "text-foreground"
                                      : "text-muted-foreground/40"
                                  }`}
                                  onClick={() => drillToDay(day)}
                                >
                                  {format(day, "d")}
                                </span>
                                {isCurrentMonth && (
                                  <button
                                    onClick={() => handleCreateOnDate(day)}
                                    className="opacity-0 hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                )}
                              </div>

                              <div className="flex flex-col gap-0.5 overflow-y-auto flex-1">
                                {dayTasks.map((task) => (
                                  <button
                                    key={task.id}
                                    onClick={() => openTask(task)}
                                    draggable
                                    onDragStart={() => setDraggedTaskId(task.id)}
                                    className={`text-left text-[10px] leading-tight px-1.5 py-0.5 rounded truncate text-white/90 hover:brightness-110 transition-all cursor-pointer ${
                                      STATUS_COLORS[task.status] ?? "bg-zinc-600"
                                    }`}
                                    title={`${task.title}${task.project ? ` [${task.project}]` : ""}`}
                                  >
                                    {task.title}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : viewMode === "week" ? (
            /* ========== WEEK VIEW ========== */
            <>
              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {weekDays.map((day) => {
                  const today = isToday(day);
                  return (
                    <div
                      key={format(day, "yyyy-MM-dd")}
                      className={`text-center text-xs font-medium py-2 ${
                        today ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {format(day, "EEE d")}
                    </div>
                  );
                })}
              </div>

              {/* Week container — bars + columns */}
              <div className="flex flex-col flex-1 bg-border/50 rounded-lg overflow-hidden">
                {/* Meta-task bars — spanning across week like month view */}
                {(() => {
                  const metaTasks = filteredTasks.filter(
                    (t) => isMetaTask(t) && t.showInCalendar && t.startDate && t.endDate
                  );
                  const weekStart = weekDays[0];
                  const weekEnd = weekDays[6];
                  const bars: { key: string; task: Task; colStart: number; colEnd: number }[] = [];

                  for (const meta of metaTasks) {
                    const mStart = parseISO(meta.startDate!);
                    const mEnd = parseISO(meta.endDate!);
                    if (mEnd < weekStart || mStart > weekEnd) continue;

                    const barStart = mStart < weekStart ? weekStart : mStart;
                    const barEnd = mEnd > weekEnd ? weekEnd : mEnd;
                    const colStart = barStart.getDay() === 0 ? 7 : barStart.getDay();
                    const colEnd = barEnd.getDay() === 0 ? 7 : barEnd.getDay();

                    bars.push({ key: `week-${meta.id}`, task: meta, colStart, colEnd });
                  }

                  if (bars.length === 0) return null;
                  return (
                    <div className="grid grid-cols-7 relative" style={{ height: "8px" }}>
                      {bars.map((bar) => {
                        const isFirst = bar.task.startDate === format(weekDays[bar.colStart - 1], "yyyy-MM-dd");
                        const isLast = bar.task.endDate === format(weekDays[bar.colEnd - 1], "yyyy-MM-dd");
                        return (
                          <div
                            key={bar.key}
                            onClick={(e) => { e.stopPropagation(); openTask(bar.task); }}
                            className="cursor-pointer relative overflow-visible"
                            style={{
                              gridColumn: `${bar.colStart} / ${bar.colEnd + 1}`,
                              height: "5px",
                              marginTop: "2px",
                              backgroundColor: bar.task.color || "#7c3aed",
                              borderRadius: isFirst && isLast ? "2px" : isFirst ? "2px 0 0 2px" : isLast ? "0 2px 2px 0" : "0",
                            }}
                            title={`${bar.task.title} (${bar.task.type}) ${bar.task.startDate} → ${bar.task.endDate}`}
                          >
                            <span className="absolute left-1 top-1/2 -translate-y-1/2 whitespace-nowrap text-[8px] font-medium pointer-events-none z-10 text-white/90">
                              {bar.task.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Day columns */}
                <div className="grid grid-cols-7 flex-1 gap-px">
                  {weekDays.map((day) => {
                    const dateStr = format(day, "yyyy-MM-dd");
                    const dayTasks = tasksByDate.get(dateStr) ?? [];
                    const today = isToday(day);

                    return (
                      <div
                        key={dateStr}
                        className={`min-h-[200px] p-2 flex flex-col bg-card ${
                          today ? "ring-1 ring-inset ring-primary/50 rounded-lg" : ""
                        }`}
                        onDragOver={cellDragOver}
                        onDragLeave={cellDragLeave}
                        onDrop={(e) => cellDrop(e, day)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className={`text-xs font-medium cursor-pointer hover:underline ${
                              today
                                ? "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center"
                                : "text-foreground"
                            }`}
                            onClick={() => drillToDay(day)}
                          >
                            {format(day, "d")}
                          </span>
                          <button
                            onClick={() => handleCreateOnDate(day)}
                            className="opacity-0 hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>

                        <div className="flex flex-col gap-1 overflow-y-auto flex-1">
                          {dayTasks.map((task) => {
                            const hours = extractEstimate(task.description);
                            return (
                              <button
                                key={task.id}
                                onClick={() => openTask(task)}
                                draggable
                                onDragStart={() => setDraggedTaskId(task.id)}
                                className={`text-left text-[11px] leading-snug px-2 py-1.5 rounded text-white/90 hover:brightness-110 transition-all cursor-pointer ${
                                  STATUS_COLORS[task.status] ?? "bg-zinc-600"
                                }`}
                                title={`${task.title}${task.project ? ` [${task.project}]` : ""}`}
                              >
                                <div className="truncate font-medium">{task.title}</div>
                                <div className="flex items-center gap-2 mt-0.5 text-[9px] text-white/60">
                                  {task.owner && (
                                    <span className="flex items-center gap-0.5">
                                      <User className="h-2.5 w-2.5" />
                                      {task.owner}
                                    </span>
                                  )}
                                  {hours && (
                                    <span className="flex items-center gap-0.5">
                                      <Clock className="h-2.5 w-2.5" />
                                      {hours}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            /* ========== DAY VIEW ========== */
            <div
              className="flex-1 overflow-y-auto"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleDrop(currentDay); }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {format(currentDay, "EEEE, MMMM d, yyyy")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {dayViewTasks.length} task{dayViewTasks.length !== 1 ? "s" : ""} scheduled
                  </p>
                </div>
                <button
                  onClick={() => handleCreateOnDate(currentDay)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Task
                </button>
              </div>

              {/* Meta-tasks spanning this day */}
              {(() => {
                const dayMeta = metaTasksByDate.get(format(currentDay, "yyyy-MM-dd")) ?? [];
                if (dayMeta.length === 0) return null;
                return (
                  <div className="mb-3 space-y-1">
                    <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                      Active Phases
                    </h3>
                    {dayMeta.map((meta) => (
                      <div
                        key={`meta-${meta.id}`}
                        onClick={() => openTask(meta)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-accent/30 transition-colors"
                        style={{
                          borderLeft: `3px solid ${meta.color || '#7c3aed'}`,
                          backgroundColor: `${meta.color || '#7c3aed'}08`,
                        }}
                      >
                        <span
                          className="text-[10px] font-bold uppercase shrink-0"
                          style={{ color: meta.color || '#7c3aed' }}
                        >
                          {meta.type}
                        </span>
                        <span className="text-sm text-foreground/80 truncate flex-1">
                          {meta.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {meta.startDate} → {meta.endDate}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {dayViewTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <p className="text-sm">No tasks scheduled for this day</p>
                  <p className="text-xs mt-1 text-muted-foreground/50">
                    Drag tasks from the sidebar or click Add Task
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {dayViewTasks.map((task) => {
                    const hours = extractEstimate(task.description);
                    const dept = extractDept(task.description);
                    return (
                      <div
                        key={task.id}
                        onClick={() => openTask(task)}
                        draggable
                        onDragStart={() => setDraggedTaskId(task.id)}
                        className="group flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-accent/30 cursor-pointer transition-all"
                      >
                        {/* Status color bar */}
                        <div
                          className={`w-1 self-stretch rounded-full shrink-0 ${
                            STATUS_COLORS[task.status] ?? "bg-zinc-600"
                          }`}
                        />

                        <div className="flex-1 min-w-0">
                          {/* Badges */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                STATUS_BADGE_COLORS[task.status] ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/20"
                              }`}
                            >
                              {task.status}
                            </span>
                            {task.project && (
                              <span className="text-[10px] text-muted-foreground bg-accent/50 px-1.5 py-0.5 rounded">
                                {task.project}
                              </span>
                            )}
                            {dept && (
                              <span className="text-[10px] font-mono text-muted-foreground">
                                {dept}
                              </span>
                            )}
                          </div>

                          {/* Title */}
                          <p className="text-sm font-medium text-foreground leading-snug">
                            {task.title}
                          </p>

                          {/* Meta */}
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            {task.owner && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" /> {task.owner}
                              </span>
                            )}
                            {hours && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3 text-cyan-400" /> {hours}
                              </span>
                            )}
                          </div>

                          {/* Next action */}
                          {task.nextAction && (
                            <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1">
                              <span className="text-primary shrink-0">&rarr;</span>
                              <span>{task.nextAction}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Unscheduled tasks sidebar */}
        <div className="w-64 border-l border-border flex flex-col bg-card/50">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Unscheduled ({unscheduledTasks.length})
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {unscheduledTasks.map((task) => (
              <div
                key={task.id}
                draggable
                onDragStart={() => setDraggedTaskId(task.id)}
                onClick={() => openTask(task)}
                className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-grab active:cursor-grabbing transition-colors group"
              >
                <div
                  className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                    STATUS_COLORS[task.status] ?? "bg-zinc-600"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate">
                    {task.title}
                  </p>
                  {task.project && (
                    <p className="text-[10px] text-muted-foreground">
                      {task.project}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {unscheduledTasks.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                All tasks scheduled
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Task dialog */}
      <UnifiedTaskDialog
        item={editTask}
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditTask(null);
          setCreateDate(null);
        }}
        defaultScheduledDate={createDate}
      />
    </div>
  );
}
