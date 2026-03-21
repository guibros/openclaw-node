"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { KanbanColumn } from "./kanban-column";
import { UnifiedTaskDialog } from "./unified-task-dialog";
import { useTasks, updateTask, type Task } from "@/lib/hooks";
import { Plus, Search, X, CheckSquare, ArrowRight } from "lucide-react";

const COLUMNS = ["backlog", "in_progress", "review", "done"] as const;
const NUM_COLS = COLUMNS.length;

function ColumnResizeHandle({
  onDrag,
}: {
  onDrag: (deltaX: number) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(delta);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onDrag]);

  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      className="w-1 shrink-0 cursor-col-resize rounded-full hover:bg-accent transition-colors self-stretch"
    />
  );
}

export function KanbanBoard() {
  const { tasks, isLoading } = useTasks();
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Column widths as flex-basis percentages (default: equal)
  const [colWidths, setColWidths] = useState<number[]>(
    () => Array(NUM_COLS).fill(100 / NUM_COLS)
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter tasks: exclude archived + roadmap hierarchy types, then apply search
  const filteredTasks = useMemo(() => {
    let filtered = tasks.filter(
      (t) =>
        t.status !== "archived" &&
        t.type !== "project" &&
        t.type !== "phase" &&
        t.type !== "pipeline"
    );
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q) ||
          (t.owner || "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [tasks, searchQuery]);

  // Build parent→children map and separate top-level vs child tasks
  const { columns, childrenMap } = useMemo(() => {
    const cMap: Record<string, Task[]> = {};
    const colMap: Record<string, Task[]> = {};
    for (const col of COLUMNS) {
      colMap[col] = [];
    }
    // First pass: index children
    for (const task of filteredTasks) {
      if (task.parentId) {
        if (!cMap[task.parentId]) cMap[task.parentId] = [];
        cMap[task.parentId].push(task);
      }
    }
    // Second pass: top-level tasks always go into columns;
    // child tasks appear too when they have an active status
    const activeColumns = new Set(["in_progress", "review"]);
    for (const task of filteredTasks) {
      if (task.parentId && !activeColumns.has(task.kanbanColumn)) continue;
      const col = colMap[task.kanbanColumn];
      if (col) {
        col.push(task);
      } else {
        colMap.backlog.push(task);
      }
    }
    return { columns: colMap, childrenMap: cMap };
  }, [filteredTasks]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      switch (e.key) {
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "Escape":
          if (dialogOpen) setDialogOpen(false);
          else if (bulkMode) {
            setBulkMode(false);
            setBulkSelection(new Set());
          } else if (searchQuery) {
            setSearchQuery("");
          }
          break;
        case "b":
          if (!dialogOpen) {
            setBulkMode((prev) => {
              if (prev) setBulkSelection(new Set());
              return !prev;
            });
          }
          break;
        case "n":
          if (!dialogOpen) {
            e.preventDefault();
            handleNewTask();
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dialogOpen, bulkMode, searchQuery]);

  // Bulk actions
  const handleBulkMove = async (targetColumn: string) => {
    for (const id of bulkSelection) {
      await updateTask(id, { kanbanColumn: targetColumn });
    }
    setBulkSelection(new Set());
    setBulkAction(null);
  };

  const handleBulkStatus = async (status: string) => {
    for (const id of bulkSelection) {
      await updateTask(id, { status } as Record<string, unknown>);
    }
    setBulkSelection(new Set());
    setBulkAction(null);
  };

  const toggleBulkSelect = (taskId: string) => {
    setBulkSelection((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleResize = useCallback(
    (handleIndex: number) => (deltaX: number) => {
      if (!containerRef.current) return;
      const totalWidth = containerRef.current.offsetWidth;
      const deltaPct = (deltaX / totalWidth) * 100;
      const minPct = 10; // minimum 10% per column

      setColWidths((prev) => {
        const next = [...prev];
        const leftNew = next[handleIndex] + deltaPct;
        const rightNew = next[handleIndex + 1] - deltaPct;
        if (leftNew < minPct || rightNew < minPct) return prev;
        next[handleIndex] = leftNew;
        next[handleIndex + 1] = rightNew;
        return next;
      });
    },
    []
  );

  // Done-gate state
  const [doneConfirmTaskId, setDoneConfirmTaskId] = useState<string | null>(null);

  const handleMoveTask = (taskId: string, targetColumn: string) => {
    if (targetColumn === "done") {
      // Prompt Gui to confirm — only they can mark tasks done
      setDoneConfirmTaskId(taskId);
      return;
    }
    updateTask(taskId, { kanbanColumn: targetColumn });
  };

  const confirmDone = () => {
    if (doneConfirmTaskId) {
      updateTask(doneConfirmTaskId, { kanbanColumn: "done", force_done: true } as Record<string, unknown>);
      setDoneConfirmTaskId(null);
    }
  };

  const cancelDone = () => {
    setDoneConfirmTaskId(null);
  };

  const handleTaskClick = (task: Task) => {
    if (bulkMode) {
      toggleBulkSelect(task.id);
      return;
    }
    setEditTask(task);
    setDialogOpen(true);
  };

  const handleNewTask = () => {
    setEditTask(null);
    setDialogOpen(true);
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

  return (
    <>
      {/* Search + Bulk mode toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks... (press /)"
            className="w-full rounded-md border border-border bg-background pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          onClick={() => {
            setBulkMode((prev) => {
              if (prev) setBulkSelection(new Set());
              return !prev;
            });
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
            bulkMode
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <CheckSquare className="h-3.5 w-3.5" />
          {bulkMode ? `Select (${bulkSelection.size})` : "Bulk"}
        </button>

        {searchQuery && (
          <span className="text-xs text-muted-foreground">
            {filteredTasks.length} result{filteredTasks.length !== 1 ? "s" : ""}
          </span>
        )}

        {/* Keyboard hints */}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/50">
          <kbd className="px-1 py-0.5 rounded border border-border bg-accent/30">/</kbd> search
          <kbd className="px-1 py-0.5 rounded border border-border bg-accent/30">b</kbd> bulk
          <kbd className="px-1 py-0.5 rounded border border-border bg-accent/30">n</kbd> new
          <kbd className="px-1 py-0.5 rounded border border-border bg-accent/30">esc</kbd> close
        </div>
      </div>

      <div ref={containerRef} className="flex pb-4 min-h-0">
        {COLUMNS.map((col, i) => (
          <div key={col} className="contents">
            <div style={{ flexBasis: `${colWidths[i]}%`, minWidth: 0 }} className="shrink grow-0">
              <KanbanColumn
                column={col}
                tasks={columns[col]}
                childrenMap={childrenMap}
                onTaskClick={handleTaskClick}
                onMoveTask={handleMoveTask}
                highlight={bulkMode}
                bulkMode={bulkMode}
                bulkSelection={bulkSelection}
                onClearDone={col === "done" ? async () => {
                  // Archive all visible done tasks
                  for (const t of columns.done) {
                    await updateTask(t.id, { status: "archived" } as Record<string, unknown>);
                  }
                } : undefined}
              />
            </div>
            {i < NUM_COLS - 1 && (
              <ColumnResizeHandle onDrag={handleResize(i)} />
            )}
          </div>
        ))}
      </div>

      {/* Bulk action bar */}
      {bulkMode && bulkSelection.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-card border border-border rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 z-50">
          <span className="text-sm font-medium text-foreground">
            {bulkSelection.size} selected
          </span>
          <div className="w-px h-6 bg-border" />
          <span className="text-xs text-muted-foreground">Move to:</span>
          {COLUMNS.map((col) => (
            <button
              key={col}
              onClick={() => handleBulkMove(col)}
              className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {col === "in_progress" ? "In Progress" : col.charAt(0).toUpperCase() + col.slice(1)}
            </button>
          ))}
          <div className="w-px h-6 bg-border" />
          <button
            onClick={() => {
              for (const id of bulkSelection) {
                updateTask(id, { status: "done", force_done: true } as Record<string, unknown>);
              }
              setBulkSelection(new Set());
              setBulkAction(null);
            }}
            className="px-2.5 py-1 text-xs rounded-md bg-green-500/15 text-green-400 border border-green-500/20 hover:bg-green-500/25 transition-colors"
          >
            Mark Done
          </button>
          <button
            onClick={() => {
              setBulkSelection(new Set());
            }}
            className="text-muted-foreground hover:text-foreground ml-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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

      {/* Done-gate confirmation dialog */}
      {doneConfirmTaskId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-2">Mark as Done?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Only you can mark tasks as done. Agents and nodes land in Review for your approval.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={cancelDone}
                className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDone}
                className="px-3 py-1.5 text-xs rounded-md bg-green-500/15 text-green-400 border border-green-500/20 hover:bg-green-500/25 transition-colors"
              >
                Confirm Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
