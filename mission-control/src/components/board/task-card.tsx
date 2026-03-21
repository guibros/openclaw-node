"use client";

import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  User,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Zap,
  Plus,
  Check,
  Circle,
  Paperclip,
  Trash2,
  CheckSquare,
  Square,
  Clock,
  FolderKanban,
  GitBranch,
  Layers,
} from "lucide-react";
import { createTask, updateTask, deleteTask, type Task } from "@/lib/hooks";

function isMetaTask(task: Task): boolean {
  return task.type === "project" || task.type === "pipeline" || task.type === "phase";
}

const TYPE_ICONS: Record<string, typeof FolderKanban> = {
  project: FolderKanban,
  pipeline: GitBranch,
  phase: Layers,
};

/** Extract estimated hours from description (e.g. "DEV · 5.0h · M1/D3" → "5.0h") */
function extractEstimate(description: string | null): string | null {
  if (!description) return null;
  const parts = description.split(" · ");
  for (const p of parts) {
    if (/^\d+(\.\d+)?h$/.test(p.trim())) return p.trim();
  }
  return null;
}

const STATUS_COLORS: Record<string, string> = {
  ready: "bg-orange-500/20 text-orange-400",
  submitted: "bg-cyan-500/20 text-cyan-400",
  running: "bg-green-500/20 text-green-400",
  blocked: "bg-red-500/20 text-red-400",
  "waiting-user": "bg-yellow-500/20 text-yellow-400",
  done: "bg-zinc-500/20 text-zinc-400",
  cancelled: "bg-zinc-500/20 text-zinc-400",
  queued: "bg-blue-500/20 text-blue-400",
  "not started": "bg-blue-500/20 text-blue-400",
};

const COLUMNS_ORDER = ["backlog", "in_progress", "review", "done"];

interface TaskCardProps {
  task: Task;
  children: Task[];
  currentColumn: string;
  onClick: () => void;
  onTaskClick: (task: Task) => void;
  onMove: (targetColumn: string) => void;
  selected?: boolean;
  bulkMode?: boolean;
}

export function TaskCard({
  task,
  children: subItems,
  currentColumn,
  onClick,
  onTaskClick,
  onMove,
  selected,
  bulkMode,
}: TaskCardProps) {
  const [showMoveButtons, setShowMoveButtons] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const collabData = useMemo(() => {
    try {
      return task.collaboration
        ? typeof task.collaboration === "string"
          ? JSON.parse(task.collaboration)
          : task.collaboration
        : null;
    } catch {
      return null;
    }
  }, [task.collaboration]);
  const statusColor = STATUS_COLORS[task.status] ?? STATUS_COLORS.queued;
  const colIdx = COLUMNS_ORDER.indexOf(currentColumn);
  const isLive = task.id === "__LIVE_SESSION__";
  const isActive = !isLive && task.status === "running";
  const isDaedalusWorking = isActive && task.owner?.toLowerCase() === "daedalus" && !!task.acknowledgedAt;
  const isMeta = isMetaTask(task);
  const metaColor = task.color || '#7c3aed';
  const MetaIcon = isMeta ? TYPE_ICONS[task.type || ''] || null : null;

  const doneCount = subItems.filter(
    (s) => s.status === "done" || s.status === "cancelled"
  ).length;
  const hasSubItems = subItems.length > 0;
  const estimate = extractEstimate(task.description);

  let timeAgo = "";
  try {
    timeAgo = formatDistanceToNow(new Date(task.updatedAt), {
      addSuffix: true,
    });
  } catch {
    timeAgo = task.updatedAt;
  }

  const toggleSubItem = async (sub: Task) => {
    const newStatus = sub.status === "done" ? "queued" : "done";
    await updateTask(sub.id, { status: newStatus } as Record<string, unknown>);
  };

  const handleAddSubItem = async () => {
    if (!newItemTitle.trim() || saving) return;
    setSaving(true);
    try {
      await createTask({
        title: newItemTitle.trim(),
        status: "queued",
        parent_id: task.id,
        project: task.project || undefined,
      });
      setNewItemTitle("");
      setAddingItem(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      draggable={!isLive}
      onDragStart={(e) => {
        if (isLive) return;
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        (e.currentTarget as HTMLElement).style.opacity = "0.4";
      }}
      onDragEnd={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = "1";
      }}
      className={`group rounded-lg border p-3 transition-all hover:shadow-md hover:shadow-black/20 ${
        selected
          ? "border-primary ring-2 ring-primary/30 bg-primary/5"
          : isDaedalusWorking
          ? "border-red-500/50 bg-red-500/5"
          : isLive
          ? "border-green-500/30 bg-green-500/5"
          : isActive
          ? "border-green-500/25 bg-green-500/5"
          : isMeta
          ? "bg-card/80"
          : "border-border bg-card"
      } ${bulkMode ? "cursor-pointer" : isLive ? "" : "cursor-grab active:cursor-grabbing"}`}
      style={
        isDaedalusWorking && !selected
          ? {
              borderColor: 'rgba(239, 68, 68, 0.5)',
              boxShadow: '0 0 12px rgba(239, 68, 68, 0.3), 0 0 4px rgba(239, 68, 68, 0.2)',
              animation: 'daedalus-glow 2s ease-in-out infinite alternate',
            }
          : isActive && !selected
          ? { borderLeftWidth: '3px', borderLeftColor: '#22c55e' }
          : isMeta && !selected
          ? {
              borderColor: `${metaColor}40`,
              borderLeftWidth: '3px',
              borderLeftColor: metaColor,
              backgroundColor: `${metaColor}08`,
            }
          : undefined
      }
      onMouseEnter={() => setShowMoveButtons(true)}
      onMouseLeave={() => setShowMoveButtons(false)}
    >
      <div className="flex items-start gap-2">
        {bulkMode && !isLive ? (
          <div className="shrink-0 mt-0.5 p-0.5">
            {selected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4 text-muted-foreground/50" />
            )}
          </div>
        ) : !isLive ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${task.title}"?`)) {
                deleteTask(task.id);
              }
            }}
            className="shrink-0 mt-0.5 p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
            title="Delete task"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
          {isLive && (
            <span className="text-[9px] font-bold text-green-400 uppercase tracking-widest">
              Live Session
            </span>
          )}
          {isMeta && (
            <div className="flex items-center gap-1.5 mb-1">
              {MetaIcon && <MetaIcon className="h-3 w-3" style={{ color: metaColor }} />}
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ color: metaColor, backgroundColor: `${metaColor}15` }}
              >
                {task.type}
              </span>
              {task.startDate && task.endDate && (
                <span className="text-[9px] text-muted-foreground ml-auto">
                  {task.startDate} → {task.endDate}
                </span>
              )}
            </div>
          )}
          <p className="text-sm font-medium text-foreground truncate">
            {task.title}
          </p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor}`}
            >
              {task.status}
            </span>
            {task.execution === "mesh" && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                MESH{task.meshNode ? ` · ${task.meshNode}` : ""}
              </span>
            )}
            {collabData && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                {collabData.mode}{collabData.max_rounds ? ` · ${collabData.max_rounds}R` : ""}
              </span>
            )}
            {task.owner && (
              task.status === "running" ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-purple-500/20 text-purple-400">
                  <User className="h-3 w-3" />
                  {task.owner}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <User className="h-3 w-3" />
                  {task.owner}
                </span>
              )
            )}
            {!task.needsApproval && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] text-amber-400"
                title={
                  task.triggerKind === "cron"
                    ? `Cron: ${task.triggerCron} (${task.triggerTz})`
                    : task.triggerKind === "at"
                    ? `Scheduled: ${task.triggerAt}`
                    : "Auto-dispatch (no trigger)"
                }
              >
                <Zap className="h-3 w-3" />
                {task.triggerKind === "cron"
                  ? "cron"
                  : task.triggerKind === "at"
                  ? "sched"
                  : "auto"}
              </span>
            )}
            {task.status === "ready" && (
              <span className="text-[10px] text-orange-400">triggered</span>
            )}
            {!!task.isRecurring && (
              <span className="text-[10px] text-purple-400" title="Recurring task">
                ↻
              </span>
            )}
            {hasSubItems && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Check className="h-3 w-3" />
                {doneCount}/{subItems.length}
              </span>
            )}
            {task.artifacts.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={task.artifacts.join(", ")}>
                <Paperclip className="h-3 w-3" />
                {task.artifacts.length}
              </span>
            )}
          </div>
          {task.nextAction && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
              <ArrowRight className="h-3 w-3 shrink-0" />
              {task.nextAction}
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground/60">
            {timeAgo}
          </p>
        </div>
      </div>

      {/* Estimated time */}
      {estimate && (
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          <span className="text-[11px] text-cyan-400 font-medium">
            Est. {estimate}
          </span>
        </div>
      )}

      {/* Sub-items section */}
      {(hasSubItems || !isLive) && (
        <div className="mt-2 pt-2 border-t border-border/50">
          {hasSubItems && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              {expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {subItems.length} sub-item{subItems.length !== 1 ? "s" : ""}
            </button>
          )}

          {expanded && (
            <div className="space-y-1 ml-1">
              {subItems.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center gap-1.5 group/sub"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSubItem(sub);
                    }}
                    className="shrink-0"
                  >
                    {sub.status === "done" ? (
                      <Check className="h-3 w-3 text-green-400" />
                    ) : (
                      <Circle className="h-3 w-3 text-muted-foreground/50 hover:text-foreground transition-colors" />
                    )}
                  </button>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskClick(sub);
                    }}
                    className={`text-[11px] truncate cursor-pointer hover:text-foreground transition-colors ${
                      sub.status === "done"
                        ? "text-muted-foreground/50 line-through"
                        : "text-foreground/80"
                    }`}
                  >
                    {sub.title}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Inline add sub-item */}
          {!isLive && (
            <>
              {addingItem ? (
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="text"
                    value={newItemTitle}
                    onChange={(e) => setNewItemTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddSubItem();
                      if (e.key === "Escape") {
                        setAddingItem(false);
                        setNewItemTitle("");
                      }
                    }}
                    placeholder="Sub-item title..."
                    autoFocus
                    className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddSubItem();
                    }}
                    disabled={saving || !newItemTitle.trim()}
                    className="text-[10px] text-primary hover:text-primary/80 disabled:opacity-50 px-1"
                  >
                    {saving ? "..." : "Add"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingItem(true);
                    setExpanded(true);
                  }}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mt-1 px-1 py-0.5 rounded hover:bg-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add item
                </button>
              )}
            </>
          )}
        </div>
      )}

      {showMoveButtons && !isLive && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
          {colIdx > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMove(COLUMNS_ORDER[colIdx - 1]);
              }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
            >
              <ChevronLeft className="h-3 w-3" />
              Move left
            </button>
          ) : (
            <div />
          )}
          {colIdx < COLUMNS_ORDER.length - 1 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMove(COLUMNS_ORDER[colIdx + 1]);
              }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
            >
              Move right
              <ChevronRight className="h-3 w-3" />
            </button>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Signet Card ─── compact pill for done column */

interface SignetCardProps {
  task: Task;
  onClick: () => void;
  onExpand: () => void;
}

export function SignetCard({ task, onClick, onExpand }: SignetCardProps) {
  const statusColor = STATUS_COLORS[task.status] ?? STATUS_COLORS.queued;
  const ownerInitial = task.owner ? task.owner.charAt(0).toUpperCase() : "";

  return (
    <div
      className="group flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2 py-1 cursor-pointer hover:bg-accent/30 hover:border-border transition-colors"
      onClick={onExpand}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${task.title} — ${task.status}${task.owner ? ` (${task.owner})` : ""}\nClick to expand, double-click to edit`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${statusColor.split(" ")[0].replace("/20", "/60").replace("/10", "/50")}`} />
      <span className="text-[11px] text-foreground truncate flex-1 min-w-0">
        {task.title}
      </span>
      {ownerInitial && (
        <span className="text-[9px] text-muted-foreground shrink-0 font-medium">
          {ownerInitial}
        </span>
      )}
    </div>
  );
}
