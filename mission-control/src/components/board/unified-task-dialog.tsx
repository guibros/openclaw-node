"use client";

const AGENT_NAME = process.env.NEXT_PUBLIC_AGENT_NAME || "Daedalus";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Zap, Paperclip, Trash2, ArrowLeftFromLine, ArrowRightFromLine, Clock, User, Cpu } from "lucide-react";
import { createTask, updateTask, createProject, type Task } from "@/lib/hooks";
import { ExecutionConfig, type ExecutionFields } from "./execution-config";

const TYPES = ["project", "pipeline", "phase"] as const;
type HierarchyType = (typeof TYPES)[number];

const STATUSES = [
  "queued",
  "ready",
  "running",
  "blocked",
  "waiting-user",
  "done",
  "cancelled",
];

const COLORS = [
  "#6d28d9", // purple
  "#2563eb", // blue
  "#059669", // green
  "#d97706", // amber
  "#dc2626", // red
  "#0891b2", // cyan
  "#7c3aed", // violet
  "#ea580c", // orange
];

interface DepLink {
  id: string;
  title: string;
  status: string;
}

interface UnifiedTaskDialogProps {
  item: Task | null; // null = create mode
  open: boolean;
  onClose: () => void;
  defaultScheduledDate?: string | null;
  defaultType?: HierarchyType;
  defaultParentId?: string | null;
  parentOptions?: { id: string; title: string; type: string }[];
  phaseOptions?: { id: string; title: string; pipeline: string }[];
  predecessors?: DepLink[];
  successors?: DepLink[];
}

export function UnifiedTaskDialog({
  item,
  open,
  onClose,
  defaultScheduledDate,
  defaultType,
  defaultParentId = null,
  parentOptions = [],
  phaseOptions = [],
  predecessors = [],
  successors = [],
}: UnifiedTaskDialogProps) {
  // Hierarchy mode: roadmap passes parentOptions or defaultType
  const isHierarchyMode = parentOptions.length > 0 || !!defaultType;

  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<HierarchyType>(defaultType || "project");
  const [parentId, setParentId] = useState<string>("");
  const [status, setStatus] = useState("queued");
  const [owner, setOwner] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [project, setProject] = useState("");
  const [description, setDescription] = useState("");
  const [richDescription, setRichDescription] = useState("");
  const [estimatedTime, setEstimatedTime] = useState("");
  // Hierarchy-only fields
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  // Scheduling fields
  const [needsApproval, setNeedsApproval] = useState(true);
  const [triggerKind, setTriggerKind] = useState("none");
  const [triggerAt, setTriggerAt] = useState("");
  const [triggerCron, setTriggerCron] = useState("");
  const [triggerTz, setTriggerTz] = useState("America/Montreal");
  const [isRecurring, setIsRecurring] = useState(false);
  const [capacityClass, setCapacityClass] = useState("normal");
  const [autoPriority, setAutoPriority] = useState(0);
  const [showInCalendar, setShowInCalendar] = useState(false);
  const [acknowledgedAt, setAcknowledgedAt] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [execFields, setExecFields] = useState<ExecutionFields>({
    execution: "local",
    collaboration: null,
    preferred_nodes: [],
    exclude_nodes: [],
    cluster_id: null,
    metric: null,
    budget_minutes: 30,
    scope: [],
    needs_approval: true,
  });
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const initializedForOpen = useRef(false);

  useEffect(() => {
    // Only initialize form state when the dialog opens (open transitions to true).
    // This prevents SWR refreshes from resetting form fields while editing.
    if (!open) {
      initializedForOpen.current = false;
      return;
    }
    if (initializedForOpen.current) return;
    initializedForOpen.current = true;

    if (item) {
      setId(item.id);
      setTitle(item.title);
      setType((item.type as HierarchyType) || defaultType || "project");
      setParentId(item.parentId ?? "");
      setStatus(item.status);
      setOwner(item.owner ?? "");
      setNextAction(item.nextAction ?? "");
      setScheduledDate(item.scheduledDate ?? "");
      setProject(item.project ?? "");
      // Parse description into metadata + rich
      const rawDesc = item.description ?? "";
      const nlIdx = rawDesc.indexOf("\n\n");
      const metaLine = nlIdx >= 0 ? rawDesc.slice(0, nlIdx) : rawDesc;
      const richPart = nlIdx >= 0 ? rawDesc.slice(nlIdx + 2) : "";
      // If no double-newline and no structured metadata separator, treat entire
      // description as rich text (shows in the textarea, not the read-only field)
      if (nlIdx < 0 && !metaLine.includes(" · ")) {
        setDescription("");
        setRichDescription(metaLine);
      } else {
        setDescription(metaLine);
        setRichDescription(richPart);
      }
      const descParts = metaLine.split(" · ");
      const hoursPart = descParts.find((p) => /^\d+(\.\d+)?h$/.test(p.trim()));
      setEstimatedTime(hoursPart?.trim() ?? "");
      // Hierarchy fields
      setStartDate(item.startDate ?? "");
      setEndDate(item.endDate ?? "");
      setColor(item.color ?? COLORS[0]);
      // Scheduling
      setNeedsApproval(item.needsApproval !== 0);
      setTriggerKind(item.triggerKind ?? "none");
      setTriggerAt(item.triggerAt ?? "");
      setTriggerCron(item.triggerCron ?? "");
      setTriggerTz(item.triggerTz ?? "America/Montreal");
      setIsRecurring(!!item.isRecurring);
      setCapacityClass(item.capacityClass ?? "normal");
      setAutoPriority(item.autoPriority ?? 0);
      setShowInCalendar(!!item.showInCalendar);
      setAcknowledgedAt(item.acknowledgedAt ?? null);
      setArtifacts(item.artifacts ?? []);
      // Execution config
      const collabParsed = item.collaboration
        ? (typeof item.collaboration === "string" ? (() => { try { return JSON.parse(item.collaboration as string); } catch { return null; } })() : item.collaboration)
        : null;
      const prefNodes = item.preferredNodes
        ? (typeof item.preferredNodes === "string" ? (() => { try { return JSON.parse(item.preferredNodes as string); } catch { return []; } })() : item.preferredNodes)
        : [];
      setExecFields({
        execution: item.execution || "local",
        collaboration: collabParsed,
        preferred_nodes: prefNodes,
        exclude_nodes: [],
        cluster_id: item.clusterId || null,
        metric: item.metric || null,
        budget_minutes: item.budgetMinutes || 30,
        scope: item.scope ? (typeof item.scope === "string" ? (() => { try { return JSON.parse(item.scope as string); } catch { return []; } })() : item.scope) : [],
        needs_approval: item.needsApproval !== 0,
      });
    } else {
      setId("");
      setTitle("");
      setType(defaultType || "project");
      setParentId(defaultParentId ?? "");
      setStatus("queued");
      setOwner("");
      setNextAction("");
      setScheduledDate(defaultScheduledDate ?? "");
      setProject("");
      setDescription("");
      setRichDescription("");
      setEstimatedTime("");
      setStartDate("");
      setEndDate("");
      setColor(COLORS[0]);
      setNeedsApproval(true);
      setTriggerKind("none");
      setTriggerAt("");
      setTriggerCron("");
      setTriggerTz("America/Montreal");
      setIsRecurring(false);
      setCapacityClass("normal");
      setAutoPriority(0);
      setArtifacts([]);
      setExecFields({
        execution: "local",
        collaboration: null,
        preferred_nodes: [],
        exclude_nodes: [],
        cluster_id: null,
        metric: null,
        budget_minutes: 30,
        scope: [],
        needs_approval: true,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, defaultType, defaultParentId, defaultScheduledDate]);

  const resolveBasenames = useCallback(async (names: string[]) => {
    const resolved = await Promise.all(
      names.map(async (name) => {
        if (name.startsWith("/") || name.includes("://")) return name;
        try {
          const res = await fetch("/api/resolve-path", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await res.json();
          return data.path || name;
        } catch {
          return name;
        }
      })
    );
    return resolved;
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const collected: string[] = [];
      const uriData = e.dataTransfer.getData("text/uri-list");
      const textData = e.dataTransfer.getData("text/plain");
      const rawText = uriData || textData || "";

      for (const line of rawText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        if (trimmed.startsWith("file://")) {
          collected.push(decodeURIComponent(trimmed.replace("file://", "")));
        } else if (trimmed.length > 0) {
          collected.push(trimmed);
        }
      }

      if (collected.length === 0 && e.dataTransfer.files.length > 0) {
        for (const file of Array.from(e.dataTransfer.files)) {
          collected.push(file.name);
        }
      }

      if (collected.length > 0) {
        const resolved = await resolveBasenames(collected);
        setArtifacts((prev) => {
          const set = new Set(prev);
          for (const p of resolved) set.add(p);
          return Array.from(set);
        });
      }
    },
    [resolveBasenames]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const removeArtifact = (path: string) => {
    setArtifacts((prev) => prev.filter((a) => a !== path));
  };

  if (!open) return null;

  // Filter parent options based on type hierarchy
  const validParents = parentOptions.filter((p) => {
    if (type === "pipeline") return p.type === "project";
    if (type === "phase") return p.type === "pipeline";
    return false;
  });

  // Rebuild description: metadata line + optional rich description
  const buildDescription = () => {
    let metaLine = description;
    if (!metaLine && !estimatedTime && !richDescription) return null;
    if (!metaLine && estimatedTime) metaLine = estimatedTime;
    else if (metaLine) {
      const parts = metaLine.split(" · ");
      const hoursIdx = parts.findIndex((p) => /^\d+(\.\d+)?h$/.test(p.trim()));
      if (estimatedTime) {
        if (hoursIdx >= 0) {
          parts[hoursIdx] = estimatedTime;
        } else {
          parts.splice(1, 0, estimatedTime);
        }
      } else if (hoursIdx >= 0) {
        parts.splice(hoursIdx, 1);
      }
      metaLine = parts.join(" · ");
    }
    const rich = richDescription.trim();
    if (rich) {
      return metaLine ? `${metaLine}\n\n${rich}` : rich;
    }
    return metaLine || null;
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const finalDescription = buildDescription();
    try {
      if (item) {
        // Update path — send superset of all fields
        const result = await updateTask(item.id, {
          title,
          status,
          type: isHierarchyMode ? type : undefined,
          owner: owner || null,
          next_action: nextAction || null,
          scheduled_date: scheduledDate || null,
          project: !isHierarchyMode ? (project || null) : undefined,
          parent_id: parentId || null,
          description: finalDescription,
          start_date: isHierarchyMode ? (startDate || null) : undefined,
          end_date: isHierarchyMode ? (endDate || null) : undefined,
          color: isHierarchyMode ? (color || null) : undefined,
          needs_approval: !isHierarchyMode && execFields.execution === "mesh" ? false : needsApproval,
          trigger_kind: triggerKind,
          trigger_at: triggerAt || null,
          trigger_cron: triggerCron || null,
          trigger_tz: triggerTz,
          is_recurring: isRecurring,
          capacity_class: capacityClass,
          auto_priority: autoPriority,
          show_in_calendar: showInCalendar,
          artifacts: artifacts.length > 0 ? artifacts : null,
          // Execution fields (non-hierarchy only)
          ...(!isHierarchyMode ? {
            execution: execFields.execution,
            collaboration: execFields.collaboration,
            preferred_nodes: execFields.preferred_nodes,
            exclude_nodes: execFields.exclude_nodes,
            cluster_id: execFields.cluster_id,
            metric: execFields.metric,
            budget_minutes: execFields.budget_minutes,
            scope: execFields.scope,
          } : {}),
        } as Record<string, unknown>);
        if (result?.error) {
          alert(`Update failed: ${result.error}`);
          return;
        }
      } else if (isHierarchyMode) {
        // Create hierarchy item
        const slug =
          id.trim() ||
          title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");

        if (type === "project") {
          await createProject({
            id: slug,
            title,
            description: finalDescription || undefined,
            color: color || undefined,
            start_date: startDate || undefined,
            end_date: endDate || undefined,
            owner: owner || undefined,
            status,
          });
        } else {
          await createTask({
            id: slug,
            title,
            status,
            type,
            parent_id: parentId || undefined,
            description: finalDescription || undefined,
            start_date: startDate || undefined,
            end_date: endDate || undefined,
            scheduled_date: scheduledDate || undefined,
            color: color || undefined,
            owner: owner || undefined,
            nextAction: nextAction || undefined,
            needs_approval: needsApproval,
            trigger_kind: triggerKind,
            trigger_at: triggerAt || undefined,
            trigger_cron: triggerCron || undefined,
            trigger_tz: triggerTz,
            is_recurring: isRecurring || undefined,
            capacity_class: capacityClass,
            auto_priority: autoPriority || undefined,
            artifacts: artifacts.length > 0 ? artifacts : undefined,
          });
        }
      } else {
        // Create leaf task
        await createTask({
          title,
          status,
          owner: owner || undefined,
          description: finalDescription || undefined,
          nextAction: nextAction || undefined,
          scheduled_date: scheduledDate || undefined,
          project: project || undefined,
          parent_id: parentId || undefined,
          needs_approval: execFields.execution === "mesh" ? false : needsApproval,
          trigger_kind: triggerKind,
          trigger_at: triggerAt || undefined,
          trigger_cron: triggerCron || undefined,
          trigger_tz: triggerTz,
          is_recurring: isRecurring || undefined,
          capacity_class: capacityClass,
          auto_priority: autoPriority || undefined,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          // Execution fields
          execution: execFields.execution || undefined,
          collaboration: execFields.collaboration || undefined,
          preferred_nodes: execFields.preferred_nodes.length ? execFields.preferred_nodes : undefined,
          exclude_nodes: execFields.exclude_nodes.length ? execFields.exclude_nodes : undefined,
          cluster_id: execFields.cluster_id || undefined,
          metric: execFields.metric || undefined,
          budget_minutes: execFields.budget_minutes || undefined,
          scope: execFields.scope.length ? execFields.scope : undefined,
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const displayType = isHierarchyMode ? type : "task";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className={`relative w-full ${isHierarchyMode ? "max-w-lg" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {item ? `Edit ${displayType}` : `New ${displayType}`}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Done checkbox + Started by — leaf mode only */}
        {!isHierarchyMode && (
          <div className="flex items-center gap-3 mb-4">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={status === "done"}
                onChange={(e) => setStatus(e.target.checked ? "done" : "queued")}
                className="h-5 w-5 rounded border-border text-green-500 focus:ring-green-500/50 accent-green-500 cursor-pointer"
              />
              <span className={`text-sm font-medium transition-colors ${status === "done" ? "text-green-400 line-through" : "text-muted-foreground group-hover:text-foreground"}`}>
                Mark as done
              </span>
            </label>
            {/* Daedalus acknowledgment checkbox — shows when auto-dispatched */}
            {item && status === "running" && owner?.toLowerCase() === AGENT_NAME.toLowerCase() && (
              <label className="flex items-center gap-2 cursor-pointer group ml-2">
                <input
                  type="checkbox"
                  checked={!!acknowledgedAt}
                  onChange={async (e) => {
                    const val = e.target.checked ? new Date().toISOString() : null;
                    setAcknowledgedAt(val);
                    await updateTask(item.id, { acknowledged_at: val } as Record<string, unknown>);
                  }}
                  className="h-5 w-5 rounded border-red-500/50 text-red-500 focus:ring-red-500/50 accent-red-500 cursor-pointer"
                />
                <span className={`text-sm font-medium transition-colors ${acknowledgedAt ? "text-red-400" : "text-muted-foreground group-hover:text-foreground"}`}>
                  Daedalus
                </span>
              </label>
            )}
            {item && (status === "running" || status === "done") && owner && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-2 py-1 bg-purple-500/15 text-purple-400 border border-purple-500/20">
                <User className="h-3 w-3" />
                {owner}
              </span>
            )}
          </div>
        )}

        <div className="space-y-4">
          {/* Type selector — hierarchy create mode only */}
          {isHierarchyMode && !item && (
            <div className="flex gap-1 p-1 bg-background rounded-lg border border-border">
              {TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    type === t
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          )}

          {/* ID + Title — hierarchy mode has ID slug on create */}
          {isHierarchyMode ? (
            <div className="grid grid-cols-3 gap-3">
              {!item && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    ID (slug)
                  </label>
                  <input
                    type="text"
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    placeholder="auto"
                  />
                </div>
              )}
              <div className={item ? "col-span-3" : "col-span-2"}>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder={`${type} title...`}
                  autoFocus
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Task title..."
                autoFocus
              />
            </div>
          )}

          {/* Parent selector — hierarchy pipeline/phase only */}
          {isHierarchyMode && type !== "project" && validParents.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Parent {type === "pipeline" ? "Project" : "Pipeline"}
              </label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select parent...</option>
                {validParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Status + Scheduled Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Scheduled Date
              </label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Date range — hierarchy mode only */}
          {isHierarchyMode && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (scheduledDate === startDate || scheduledDate === "") {
                      setScheduledDate(e.target.value);
                    }
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!startDate && scheduledDate === startDate}
                    onChange={(e) => {
                      if (e.target.checked && startDate) {
                        setScheduledDate(startDate);
                      } else {
                        setScheduledDate("");
                      }
                    }}
                    className="rounded border-border"
                    disabled={!startDate}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Schedule to start date
                  </span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          )}

          {/* Show in calendar — meta-tasks only (works from any view) */}
          {item && (type === "project" || type === "pipeline" || type === "phase") && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showInCalendar}
                onChange={(e) => setShowInCalendar(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs text-muted-foreground">
                Show in calendar
              </span>
            </label>
          )}

          {/* Estimated Time + Owner */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                <Clock className="inline h-3.5 w-3.5 mr-1 text-cyan-400" />
                Estimated Time
              </label>
              <input
                type="text"
                value={estimatedTime}
                onChange={(e) => setEstimatedTime(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                placeholder="e.g. 5.0h"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Owner
              </label>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="gui, daedalus..."
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Description
            </label>
            <textarea
              value={richDescription}
              onChange={(e) => setRichDescription(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
              placeholder="Task description, context, references..."
            />
            {description && (
              <input
                type="text"
                value={description}
                readOnly
                className="mt-1 w-full rounded-md border border-border/50 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground font-mono focus:outline-none"
                title="Metadata (dept · hours · schedule · deps)"
              />
            )}
          </div>

          {/* Project — leaf mode only */}
          {!isHierarchyMode && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Project
              </label>
              <input
                type="text"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="arcane, mission-control..."
              />
            </div>
          )}

          {/* Phase selector — leaf mode only */}
          {!isHierarchyMode && phaseOptions.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Phase (optional)
              </label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">No phase</option>
                {phaseOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.pipeline} / {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Scheduling section */}
          <div className="border border-border/50 rounded-lg p-3 space-y-3">
            {isHierarchyMode ? (
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  Scheduling
                </p>
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1 text-right">
                    Color
                  </label>
                  <div className="flex gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`h-5 w-5 rounded-full border-2 transition-transform ${
                          color === c
                            ? "border-foreground scale-110"
                            : "border-transparent hover:scale-105"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                Scheduling
              </p>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!needsApproval}
                onChange={(e) => setNeedsApproval(!e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs text-foreground">
                Start without Gui approval
              </span>
            </label>

            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                Trigger
              </label>
              <div className="flex gap-2">
                {(["none", "at", "cron"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setTriggerKind(kind)}
                    className={`px-2.5 py-1 text-[10px] rounded-md border transition-colors ${
                      triggerKind === kind
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {kind === "none" ? "Manual" : kind === "at" ? "At time" : "Cron"}
                  </button>
                ))}
              </div>
            </div>

            {triggerKind === "at" && (
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                  Trigger at
                </label>
                <input
                  type="datetime-local"
                  value={triggerAt}
                  onChange={(e) => setTriggerAt(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}

            {triggerKind === "cron" && (
              <div className="space-y-2">
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                    Cron expression
                  </label>
                  <input
                    type="text"
                    value={triggerCron}
                    onChange={(e) => setTriggerCron(e.target.value)}
                    placeholder="0 10 * * 1 (Mon 10:00)"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                    Timezone
                  </label>
                  <input
                    type="text"
                    value={triggerTz}
                    onChange={(e) => setTriggerTz(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs text-foreground">Recurring</span>
              <span className="text-[10px] text-muted-foreground">
                Auto-recreates after completion
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                  Capacity
                </label>
                <select
                  value={capacityClass}
                  onChange={(e) => setCapacityClass(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="light">Light (0.5)</option>
                  <option value="normal">Normal (1.0)</option>
                  <option value="heavy">Heavy (2.0)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                  Priority
                </label>
                <input
                  type="number"
                  value={autoPriority}
                  onChange={(e) => setAutoPriority(parseInt(e.target.value, 10) || 0)}
                  min={0}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Execution section */}
          {!isHierarchyMode && (
            <div className="border border-border/50 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                Execution
              </p>
              <ExecutionConfig
                value={execFields}
                onChange={setExecFields}
                disabled={!!item?.meshTaskId}
              />
            </div>
          )}

          {/* Next Action */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Next Action
            </label>
            <textarea
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              placeholder="What's the next step?"
            />
          </div>

          {/* Dependencies — hierarchy edit mode only */}
          {isHierarchyMode && item && (predecessors.length > 0 || successors.length > 0) && (
            <div className="border border-border/50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ArrowRightFromLine className="h-3.5 w-3.5 text-purple-400" />
                Dependencies
              </p>

              {predecessors.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-blue-400 mb-1 flex items-center gap-1">
                    <ArrowLeftFromLine className="h-3 w-3" />
                    Depends on ({predecessors.length})
                  </p>
                  <div className="space-y-1 ml-4">
                    {predecessors.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          p.status === "done" ? "bg-green-400" : p.status === "running" ? "bg-yellow-400" : "bg-orange-400"
                        }`} />
                        <span className="text-foreground/80 truncate flex-1">{p.title}</span>
                        <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">{p.id}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                          p.status === "done" ? "bg-green-500/15 text-green-400" : "bg-orange-500/15 text-orange-400"
                        }`}>{p.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {successors.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-purple-400 mb-1 flex items-center gap-1">
                    <ArrowRightFromLine className="h-3 w-3" />
                    Blocks ({successors.length})
                  </p>
                  <div className="space-y-1 ml-4">
                    {successors.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          s.status === "done" ? "bg-green-400" : s.status === "running" ? "bg-yellow-400" : "bg-zinc-400"
                        }`} />
                        <span className="text-foreground/80 truncate flex-1">{s.title}</span>
                        <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">{s.id}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                          s.status === "done" ? "bg-green-500/15 text-green-400" : "bg-zinc-500/15 text-zinc-400"
                        }`}>{s.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Attachments / Items */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              <Paperclip className="inline h-3.5 w-3.5 mr-1" />
              Items / Attachments
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`rounded-lg border-2 border-dashed transition-colors p-3 min-h-[60px] ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border/50 hover:border-border"
              }`}
            >
              {artifacts.length > 0 ? (
                <ul className="space-y-1">
                  {artifacts.map((a) => (
                    <li
                      key={a}
                      className="flex items-center gap-2 group/artifact"
                    >
                      <span className="flex-1 min-w-0 text-xs text-foreground/80 truncate font-mono" title={a}>
                        {a}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeArtifact(a)}
                        className="shrink-0 text-muted-foreground/40 hover:text-red-400 transition-colors opacity-0 group-hover/artifact:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground/50 text-center py-1">
                  Drop files or links here
                </p>
              )}
            </div>
            <input
              type="text"
              placeholder="Or paste a path / URL and press Enter"
              className="mt-1.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) {
                    setArtifacts((prev) =>
                      prev.includes(val) ? prev : [...prev, val]
                    );
                    (e.target as HTMLInputElement).value = "";
                  }
                  e.preventDefault();
                }
              }}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : item
              ? "Update"
              : isHierarchyMode
              ? `Create ${type}`
              : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
