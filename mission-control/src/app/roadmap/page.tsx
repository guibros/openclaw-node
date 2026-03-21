"use client";

import { useState, useMemo, useRef, useCallback, useEffect, Fragment } from "react";
import {
  format,
  addMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  eachMonthOfInterval,
  differenceInDays,
  isToday,
  isWeekend,
  addDays,
  parseISO,
  startOfWeek,
  getQuarter,
  startOfQuarter,
  isSameMonth,
  isBefore,
  startOfDay,
} from "date-fns";
import {
  Plus,
  ChevronRight,
  ChevronDown,
  FolderKanban,
  GitBranch,
  Layers,
  CheckSquare,
  ZoomIn,
  ZoomOut,
  Filter,
  X,
  Diamond,
  AlertTriangle,
  Search,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Clock,
  Send,
} from "lucide-react";
import {
  useProjects,
  useProjectTree,
  useProjectDependencies,
  useCriticalPath,
  updateTask,
  createDependency,
  type Task,
  type Dependency,
} from "@/lib/hooks";
import { UnifiedTaskDialog } from "@/components/board/unified-task-dialog";

// --- Constants ---

const ROW_HEIGHT = 36;
const DEFAULT_LABEL_WIDTH = 300;
const MIN_LABEL_WIDTH = 160;
const MAX_LABEL_WIDTH = 600;
const TYPE_ICONS: Record<string, typeof FolderKanban> = {
  project: FolderKanban,
  pipeline: GitBranch,
  phase: Layers,
  task: CheckSquare,
};

const STATUS_COLORS: Record<string, string> = {
  running: "#22c55e",
  blocked: "#ef4444",
  "waiting-user": "#eab308",
  queued: "#3b82f6",
  done: "#71717a",
  cancelled: "#52525b",
};

type ZoomLevel = "day" | "week" | "month" | "quarter";

// Department color map (matches import-pipeline-v2.js)
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

/** Extract estimated hours from description (e.g. "DEV · 5.0h · M1/D3" → "5.0h") */
function extractEstimate(description: string | null): string | null {
  if (!description) return null;
  const parts = description.split(" · ");
  for (const p of parts) {
    if (/^\d+(\.\d+)?h$/.test(p.trim())) return p.trim();
  }
  return null;
}

/** Extract department from a task's description field (e.g. "DEV" or "⚠️ CRITICAL PATH — DEV") */
function extractDept(description: string | null): string | null {
  if (!description) return null;
  // Check for "CRITICAL PATH — DEPT" or "IMPORTANT — DEPT" pattern
  const tagMatch = description.match(/(?:CRITICAL PATH|IMPORTANT)\s*[—–-]\s*(\w+)/);
  if (tagMatch) return tagMatch[1];
  // Otherwise treat the whole description as dept if it matches a known dept
  const trimmed = description.trim();
  if (DEPT_COLORS[trimmed]) return trimmed;
  return null;
}

// --- Helper: build tree structure from flat list ---

interface TreeNode extends Task {
  children: TreeNode[];
  depth: number;
}

function buildTree(items: Task[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const item of items) {
    map.set(item.id, { ...item, children: [], depth: 0 });
  }

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      const parent = map.get(node.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children chronologically by date (not alphabetically by ID/dept)
  const dateSortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      const aDate = a.scheduledDate || a.startDate || "";
      const bDate = b.scheduledDate || b.startDate || "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return a.id.localeCompare(b.id);
    });
    for (const n of nodes) {
      if (n.children.length > 0) dateSortChildren(n.children);
    }
  };
  dateSortChildren(roots);

  return roots;
}

function flattenTree(
  nodes: TreeNode[],
  collapsed: Set<string>
): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(items: TreeNode[]) {
    for (const node of items) {
      result.push(node);
      if (!collapsed.has(node.id) && node.children.length > 0) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

// --- Component ---

export default function RoadmapPage() {
  const { projects, isLoading: projectsLoading } = useProjects();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const { tree: treeData } = useProjectTree(selectedProject);
  const { dependencies } = useProjectDependencies(selectedProject);
  const { criticalPath } = useCriticalPath(selectedProject);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [viewStart, setViewStart] = useState(startOfMonth(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Task | null>(null);
  const [dialogType, setDialogType] = useState<"project" | "pipeline" | "phase">("project");
  const [dialogParentId, setDialogParentId] = useState<string | null>(null);
  const [depMode, setDepMode] = useState<string | null>(null); // source id for dependency creation
  const [labelWidth, setLabelWidth] = useState(DEFAULT_LABEL_WIDTH);
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set()); // empty = show all
  const [filterOpen, setFilterOpen] = useState(false);
  const [ganttSearch, setGanttSearch] = useState("");
  const [ganttSearchResults, setGanttSearchResults] = useState<TreeNode[]>([]);
  const [ganttSearchOpen, setGanttSearchOpen] = useState(false);
  const [ganttSearchIdx, setGanttSearchIdx] = useState(0);
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const ganttSearchRef = useRef<HTMLInputElement>(null);
  const labelPanelRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stripDragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const stripWasDragged = useRef(false);
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Auto-select first project
  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      setSelectedProject(projects[0].id);
    }
  }, [projects, selectedProject]);

  // Build tree from flat data
  const treeRoots = useMemo(() => buildTree(treeData), [treeData]);
  const flatRows = useMemo(
    () => flattenTree(treeRoots, collapsed),
    [treeRoots, collapsed]
  );

  // Extract all unique departments from tree data
  const allDepts = useMemo(() => {
    const depts = new Set<string>();
    for (const t of treeData) {
      const dept = extractDept(t.description);
      if (dept) depts.add(dept);
    }
    return Array.from(depts).sort();
  }, [treeData]);

  // Critical path set for O(1) lookups
  const criticalPathSet = useMemo(() => new Set(criticalPath), [criticalPath]);

  // Progress rollup for parent nodes
  const progressMap = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    function compute(node: TreeNode): { done: number; total: number } {
      if (node.children.length === 0) {
        const isDone = node.status === "done" || node.status === "cancelled";
        return { done: isDone ? 1 : 0, total: 1 };
      }
      let done = 0, total = 0;
      for (const child of node.children) {
        const cp = compute(child);
        done += cp.done;
        total += cp.total;
      }
      map.set(node.id, { done, total });
      return { done, total };
    }
    for (const root of treeRoots) compute(root);
    return map;
  }, [treeRoots]);

  // Blocked-by map: targetId → list of unfinished predecessors
  const blockedByMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; title: string }>>();
    const taskMap = new Map(treeData.map((t) => [t.id, t]));
    for (const dep of dependencies) {
      const source = taskMap.get(dep.sourceId);
      if (source && source.status !== "done" && source.status !== "cancelled") {
        const existing = map.get(dep.targetId) || [];
        existing.push({ id: source.id, title: source.title });
        map.set(dep.targetId, existing);
      }
    }
    return map;
  }, [dependencies, treeData]);

  // Predecessors map: taskId → list of source tasks (what must finish before this)
  const predecessorMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; title: string; status: string }>>();
    const taskMap = new Map(treeData.map((t) => [t.id, t]));
    for (const dep of dependencies) {
      const source = taskMap.get(dep.sourceId);
      if (source) {
        const existing = map.get(dep.targetId) || [];
        existing.push({ id: source.id, title: source.title, status: source.status });
        map.set(dep.targetId, existing);
      }
    }
    return map;
  }, [dependencies, treeData]);

  // Successors map: taskId → list of target tasks (what depends on this)
  const successorMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; title: string; status: string }>>();
    const taskMap = new Map(treeData.map((t) => [t.id, t]));
    for (const dep of dependencies) {
      const target = taskMap.get(dep.targetId);
      if (target) {
        const existing = map.get(dep.sourceId) || [];
        existing.push({ id: target.id, title: target.title, status: target.status });
        map.set(dep.sourceId, existing);
      }
    }
    return map;
  }, [dependencies, treeData]);

  // Today reference for overdue detection
  const todayDate = useMemo(() => startOfDay(new Date()), []);

  // All nodes for search (including collapsed ones)
  const allNodes = useMemo(() => flattenTree(treeRoots, new Set()), [treeRoots]);

  // Gantt search: find matches across ALL nodes (not just visible)
  useEffect(() => {
    if (!ganttSearch.trim()) {
      // Use functional update to avoid new [] reference on every render
      // (prevents infinite loop when allNodes changes due to SWR revalidation)
      setGanttSearchResults((prev) => (prev.length === 0 ? prev : []));
      setGanttSearchOpen(false);
      return;
    }
    const q = ganttSearch.toLowerCase();
    const matches = allNodes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        (n.description || "").toLowerCase().includes(q) ||
        (n.owner || "").toLowerCase().includes(q)
    );
    setGanttSearchResults(matches);
    setGanttSearchOpen(matches.length > 0);
    setGanttSearchIdx(0);
  }, [ganttSearch, allNodes]);

  // Navigate to a specific task: uncollapse ancestors, scroll both panels
  const navigateToTask = useCallback(
    (targetId: string) => {
      // Find the node in treeData to get its parent chain
      const nodeMap = new Map(treeData.map((t) => [t.id, t]));
      // Uncollapse all ancestors
      const newCollapsed = new Set(collapsed);
      let current = nodeMap.get(targetId);
      while (current?.parentId) {
        newCollapsed.delete(current.parentId);
        current = nodeMap.get(current.parentId);
      }
      setCollapsed(newCollapsed);

      // Move timeline to task's start date FIRST so the bar renders in view
      const task = nodeMap.get(targetId);
      if (task?.startDate) {
        const taskStart = parseISO(task.startDate);
        // Center the view on the task start (back up ~2 weeks so bar is visible)
        setViewStart(addDays(startOfMonth(taskStart), -7));
      }

      // Scroll after state update (need a tick for re-render + timeline shift)
      setTimeout(() => {
        const rowEl = document.querySelector(`[data-task-id="${targetId}"]`);
        const ganttRowEl = document.querySelector(`[data-gantt-id="${targetId}"]`);

        if (rowEl && labelPanelRef.current) {
          // Scroll label panel to the row
          const panelRect = labelPanelRef.current.getBoundingClientRect();
          const rowRect = rowEl.getBoundingClientRect();
          const scrollTarget = labelPanelRef.current.scrollTop + (rowRect.top - panelRect.top) - panelRect.height / 2;
          labelPanelRef.current.scrollTo({ top: scrollTarget, behavior: "smooth" });

          // Sync gantt vertical scroll
          if (ganttRef.current) {
            ganttRef.current.scrollTo({ top: scrollTarget, behavior: "smooth" });
          }

          // Flash highlight on label row
          const highlightClasses = ["ring-2", "ring-primary", "bg-primary/20", "z-10"];
          rowEl.classList.add(...highlightClasses);
          setTimeout(() => rowEl.classList.remove(...highlightClasses), 20000);
        }

        // Flash highlight on gantt bar row
        if (ganttRowEl) {
          const barEl = ganttRowEl.querySelector("div[class*='group']") as HTMLElement;
          if (barEl) {
            barEl.classList.add("ring-2", "ring-primary", "shadow-[0_0_12px_rgba(var(--primary),0.5)]");
            setTimeout(() => {
              barEl.classList.remove("ring-2", "ring-primary", "shadow-[0_0_12px_rgba(var(--primary),0.5)]");
            }, 20000);
          }
          // Also highlight the row background
          ganttRowEl.classList.add("bg-primary/10");
          setTimeout(() => ganttRowEl.classList.remove("bg-primary/10"), 20000);
        }

        // Scroll gantt horizontally to the bar
        if (ganttRef.current && ganttRowEl) {
          const barInner = ganttRowEl.querySelector("[class*='cursor-grab'], [class*='rotate-45']") as HTMLElement;
          if (barInner) {
            const ganttRect = ganttRef.current.getBoundingClientRect();
            const barRect = barInner.getBoundingClientRect();
            const scrollLeft = ganttRef.current.scrollLeft + (barRect.left - ganttRect.left) - ganttRect.width / 3;
            ganttRef.current.scrollTo({ left: Math.max(0, scrollLeft), behavior: "smooth" });
          }
        }
      }, 150);

      setGanttSearch("");
      setGanttSearchOpen(false);
    },
    [collapsed, treeData]
  );

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;
      if (e.key === "/" && !dialogOpen) {
        e.preventDefault();
        ganttSearchRef.current?.focus();
      }
      if (e.key === "Escape" && ganttSearch) {
        setGanttSearch("");
        setGanttSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dialogOpen, ganttSearch]);

  // Filter rows by selected departments and/or critical path
  const filteredRows = useMemo(() => {
    const hasDeptFilter = selectedDepts.size > 0;
    if (!hasDeptFilter && !showCriticalOnly) return flatRows;

    // Collect IDs of tasks matching the filters
    const matchingIds = new Set<string>();
    for (const node of flatRows) {
      const deptMatch = !hasDeptFilter || (extractDept(node.description) && selectedDepts.has(extractDept(node.description)!));
      const critMatch = !showCriticalOnly || criticalPathSet.has(node.id);
      if (deptMatch && critMatch) {
        matchingIds.add(node.id);
      }
    }

    // Walk up parentId chain to keep ancestor nodes visible
    const visibleIds = new Set(matchingIds);
    const idToNode = new Map(flatRows.map((n) => [n.id, n]));
    for (const id of matchingIds) {
      let current = idToNode.get(id);
      while (current?.parentId) {
        visibleIds.add(current.parentId);
        current = idToNode.get(current.parentId);
      }
    }

    return flatRows.filter((n) => visibleIds.has(n.id));
  }, [flatRows, selectedDepts, showCriticalOnly, criticalPathSet]);

  // Timeline range
  const viewEnd = useMemo(() => {
    if (zoom === "day") return addDays(viewStart, 14);
    if (zoom === "week") return addDays(viewStart, 28);
    if (zoom === "quarter") return addMonths(viewStart, 6);
    return addMonths(viewStart, 3); // month view = 3 months
  }, [viewStart, zoom]);

  const totalDays = useMemo(
    () => differenceInDays(viewEnd, viewStart),
    [viewStart, viewEnd]
  );

  // Day width based on zoom
  const dayWidth = useMemo(() => {
    if (zoom === "day") return 90;
    if (zoom === "week") return 40;
    if (zoom === "quarter") return 6;
    return 14; // month
  }, [zoom]);

  const baseTimelineWidth = totalDays * dayWidth;

  // Extend container to fit bars that extend beyond the view window
  const timelineWidth = useMemo(() => {
    let maxRight = baseTimelineWidth;
    for (const node of filteredRows) {
      if (!node.startDate && !(node.type === "task" && node.scheduledDate)) continue;
      let barRight = 0;
      if (node.type === "task" && node.scheduledDate) {
        const date = parseISO(node.scheduledDate);
        barRight = differenceInDays(date, viewStart) * dayWidth + Math.max(dayWidth, 60);
      } else if (node.startDate) {
        const start = parseISO(node.startDate);
        const end = node.endDate ? parseISO(node.endDate) : addDays(start, 7);
        barRight = differenceInDays(start, viewStart) * dayWidth + Math.max(differenceInDays(end, start) * dayWidth, dayWidth * 2);
      }
      maxRight = Math.max(maxRight, barRight + 220);
    }
    return maxRight;
  }, [filteredRows, viewStart, dayWidth, baseTimelineWidth]);

  // Month markers for the header
  const months = useMemo(
    () => eachMonthOfInterval({ start: viewStart, end: viewEnd }),
    [viewStart, viewEnd]
  );

  // Day markers for day/week zoom
  const days = useMemo(() => {
    if (zoom !== "day" && zoom !== "week") return [];
    return eachDayOfInterval({ start: viewStart, end: addDays(viewEnd, -1) });
  }, [viewStart, viewEnd, zoom]);

  // Today line position
  const todayOffset = useMemo(() => {
    const days = differenceInDays(new Date(), viewStart);
    if (days < 0 || days > totalDays) return null;
    return days * dayWidth;
  }, [viewStart, totalDays, dayWidth]);

  // Project date range for the date strip
  const projectRange = useMemo(() => {
    let earliest = new Date();
    let latest = addMonths(new Date(), 3);
    for (const task of treeData) {
      for (const dateStr of [task.startDate, task.scheduledDate, task.endDate]) {
        if (dateStr) {
          const d = parseISO(dateStr);
          if (d < earliest) earliest = d;
          if (d > latest) latest = d;
        }
      }
    }
    return {
      start: startOfMonth(addMonths(earliest, -1)),
      end: endOfMonth(addMonths(latest, 1)),
    };
  }, [treeData]);

  // Selection range end (the highlighted unit in the strip)
  const selectionEnd = useMemo(() => {
    switch (zoom) {
      case "day": return addDays(viewStart, 1);
      case "week": return addDays(viewStart, 7);
      case "month": return addMonths(viewStart, 1);
      case "quarter": return addMonths(viewStart, 3);
    }
  }, [viewStart, zoom]);

  // Strip always shows individual days across the full project range
  const stripDays = useMemo(() => {
    return eachDayOfInterval({ start: projectRange.start, end: projectRange.end });
  }, [projectRange]);

  // Strip → Gantt coordinate alignment: pixel offset from strip origin to viewStart
  const stripOriginOffset = useMemo(
    () => differenceInDays(viewStart, projectRange.start) * dayWidth,
    [viewStart, projectRange.start, dayWidth]
  );

  const stripTotalWidth = useMemo(() => {
    const projectWidth = differenceInDays(projectRange.end, projectRange.start) * dayWidth;
    return Math.max(projectWidth, timelineWidth + stripOriginOffset) + 200;
  }, [projectRange, dayWidth, timelineWidth, stripOriginOffset]);

  const stripMonths = useMemo(
    () => eachMonthOfInterval({ start: projectRange.start, end: projectRange.end }),
    [projectRange]
  );

  // Navigation label shows the selected unit (not the full visible range)
  const viewRangeLabel = useMemo(() => {
    switch (zoom) {
      case "day":
        return format(viewStart, "EEE, MMM d yyyy");
      case "week": {
        const weekEnd = addDays(viewStart, 6);
        if (isSameMonth(viewStart, weekEnd)) {
          return `${format(viewStart, "MMM d")} — ${format(weekEnd, "d, yyyy")}`;
        }
        return `${format(viewStart, "MMM d")} — ${format(weekEnd, "MMM d, yyyy")}`;
      }
      case "month":
        return format(viewStart, "MMMM yyyy");
      case "quarter":
        return `Q${getQuarter(viewStart)} ${format(viewStart, "yyyy")}`;
    }
  }, [viewStart, zoom]);

  // Sync strip scroll position to match Gantt view origin
  useEffect(() => {
    if (stripRef.current) {
      stripRef.current.scrollLeft = stripOriginOffset;
    }
  }, [stripOriginOffset]);

  // Initialize --gantt-scroll-left CSS variable for sticky bar labels
  useEffect(() => {
    if (ganttRef.current) {
      ganttRef.current.style.setProperty(
        "--gantt-scroll-left",
        ganttRef.current.scrollLeft + "px"
      );
    }
  }, []);

  // --- Helpers for bar positioning ---

  const getBarPosition = useCallback(
    (item: Task) => {
      // Leaf tasks: use scheduledDate for single-day positioning
      if (item.type === "task" && item.scheduledDate) {
        const date = parseISO(item.scheduledDate);
        const startOffset = differenceInDays(date, viewStart) * dayWidth;
        // Single-day bar with minimum width for readability
        const width = Math.max(dayWidth, 60);
        return { left: startOffset, width };
      }
      if (!item.startDate) return null;
      const start = parseISO(item.startDate);
      const end = item.endDate ? parseISO(item.endDate) : addDays(start, 7);
      const startOffset = differenceInDays(start, viewStart) * dayWidth;
      const width = Math.max(differenceInDays(end, start) * dayWidth, dayWidth * 2);
      return { left: startOffset, width };
    },
    [viewStart, dayWidth]
  );

  // Parent options for dialog
  const parentOptions = useMemo(() => {
    return treeData
      .filter((t) => t.type === "project" || t.type === "pipeline")
      .map((t) => ({ id: t.id, title: t.title, type: t.type || "task" }));
  }, [treeData]);

  // --- Handlers ---

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBarDrag = useCallback(
    async (taskId: string, newLeft: number, newWidth: number) => {
      const startDays = Math.round(newLeft / dayWidth);
      const durationDays = Math.max(Math.round(newWidth / dayWidth), 1);
      const newStart = addDays(viewStart, startDays);
      const newEnd = addDays(newStart, durationDays);
      await updateTask(taskId, {
        start_date: format(newStart, "yyyy-MM-dd"),
        end_date: format(newEnd, "yyyy-MM-dd"),
      } as Record<string, unknown>);
    },
    [viewStart, dayWidth]
  );

  const handleAddDep = async (targetId: string) => {
    if (!depMode || depMode === targetId) {
      setDepMode(null);
      return;
    }
    try {
      await createDependency({ sourceId: depMode, targetId });
    } catch {
      // cycle or other error — silently ignore
    }
    setDepMode(null);
  };

  const toggleDept = (dept: string) => {
    setSelectedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const navigateTimeline = (direction: number) => {
    if (zoom === "day") setViewStart(addDays(viewStart, direction));
    else if (zoom === "week") setViewStart(addDays(viewStart, 7 * direction));
    else if (zoom === "quarter") setViewStart(addMonths(viewStart, 3 * direction));
    else setViewStart(addMonths(viewStart, direction));
  };

  // Strip: grab-to-pan drag handler
  const handleStripMouseDown = useCallback((e: React.MouseEvent) => {
    const container = stripRef.current;
    if (!container) return;
    stripDragRef.current = { startX: e.clientX, startScrollLeft: container.scrollLeft };
    stripWasDragged.current = false;

    const handleMove = (ev: MouseEvent) => {
      if (!stripDragRef.current) return;
      const dx = ev.clientX - stripDragRef.current.startX;
      if (Math.abs(dx) > 3) stripWasDragged.current = true;
      container.scrollLeft = stripDragRef.current.startScrollLeft - dx;
    };

    const handleUp = () => {
      stripDragRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    document.body.style.cursor = "grabbing";
  }, []);

  // Strip: click a day to jump to it (snaps to containing unit)
  const handleStripDayClick = useCallback((date: Date) => {
    if (stripWasDragged.current) return;
    switch (zoom) {
      case "day": setViewStart(date); break;
      case "week": setViewStart(startOfWeek(date, { weekStartsOn: 1 })); break;
      case "month": setViewStart(startOfMonth(date)); break;
      case "quarter": setViewStart(startOfQuarter(date)); break;
    }
  }, [zoom]);

  // Timeline header height depends on zoom level — match left panel header to it
  const headerHeight = (zoom === "day" || zoom === "week") ? 44 : 24;

  // --- Vertical scroll sync between label panel and gantt ---
  const syncingScroll = useRef(false);
  const handleLabelScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (labelPanelRef.current && ganttRef.current) {
      ganttRef.current.scrollTop = labelPanelRef.current.scrollTop;
    }
    syncingScroll.current = false;
  }, []);
  const handleGanttScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (ganttRef.current) {
      if (labelPanelRef.current) {
        labelPanelRef.current.scrollTop = ganttRef.current.scrollTop;
      }
      if (stripRef.current) {
        stripRef.current.scrollLeft = ganttRef.current.scrollLeft + stripOriginOffset;
      }
      // Update CSS variable for sticky bar labels
      ganttRef.current.style.setProperty(
        "--gantt-scroll-left",
        ganttRef.current.scrollLeft + "px"
      );
    }
    syncingScroll.current = false;
  }, [stripOriginOffset]);

  const handleStripScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (stripRef.current && ganttRef.current) {
      ganttRef.current.scrollLeft = stripRef.current.scrollLeft - stripOriginOffset;
    }
    syncingScroll.current = false;
  }, [stripOriginOffset]);

  // --- Resize handle for left panel ---
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { startX: e.clientX, startWidth: labelWidth };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const dx = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.min(
        MAX_LABEL_WIDTH,
        Math.max(MIN_LABEL_WIDTH, resizingRef.current.startWidth + dx)
      );
      setLabelWidth(newWidth);
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [labelWidth]);

  // --- Render ---

  if (projectsLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <FolderKanban className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-muted-foreground">No projects yet</p>
        <button
          onClick={() => {
            setDialogType("project");
            setEditItem(null);
            setDialogParentId(null);
            setDialogOpen(true);
          }}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create First Project
        </button>
        <UnifiedTaskDialog
          item={null}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          defaultType="project"
          parentOptions={[]}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-foreground">Roadmap</h1>

          {/* Project selector */}
          <select
            value={selectedProject ?? ""}
            onChange={(e) => setSelectedProject(e.target.value || null)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          {/* Timeline navigation */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => navigateTimeline(-1)}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
            <span className="text-xs text-muted-foreground min-w-[140px] text-center">
              {viewRangeLabel}
            </span>
            <button
              onClick={() => navigateTimeline(1)}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewStart(startOfMonth(new Date()))}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors ml-1"
            >
              Today
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
            {(["day", "week", "month", "quarter"] as ZoomLevel[]).map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  zoom === z
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {z.charAt(0).toUpperCase() + z.slice(1)}
              </button>
            ))}
          </div>

          {/* Critical path toggle */}
          {criticalPath.length > 0 && (
            <button
              onClick={() => setShowCriticalOnly((p) => !p)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors ${
                showCriticalOnly
                  ? "border-red-500 bg-red-500/15 text-red-400"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <AlertTriangle className="h-3 w-3" />
              {showCriticalOnly ? `Critical (${criticalPath.length})` : "Critical Path"}
            </button>
          )}

          {/* Department filter */}
          {allDepts.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setFilterOpen(!filterOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  selectedDepts.size > 0
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <Filter className="h-3 w-3" />
                {selectedDepts.size > 0 ? `${selectedDepts.size} dept${selectedDepts.size > 1 ? "s" : ""}` : "Filter"}
              </button>

              {filterOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 border border-border rounded-lg shadow-lg p-2 min-w-[180px]" style={{ backgroundColor: "var(--card)" }}>
                    <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b border-border">
                      <span className="text-xs font-medium text-foreground">Departments</span>
                      {selectedDepts.size > 0 && (
                        <button
                          onClick={() => setSelectedDepts(new Set())}
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {allDepts.map((dept) => (
                      <button
                        key={dept}
                        onClick={() => toggleDept(dept)}
                        className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md transition-colors ${
                          selectedDepts.has(dept)
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        }`}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: DEPT_COLORS[dept] || "#71717a" }}
                        />
                        <span className="flex-1 text-left">{dept}</span>
                        {selectedDepts.has(dept) && <X className="h-3 w-3" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Add buttons */}
          <button
            onClick={() => {
              setDialogType("project");
              setEditItem(null);
              setDialogParentId(null);
              setDialogOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>
      </header>

      {/* Date strip — aligned with Gantt timeline, synced scroll */}
      <div className="border-b border-border shrink-0 flex">
        {/* Left spacer matching label panel width */}
        <div className="shrink-0 border-r border-border" style={{ width: labelWidth }} />
        {/* Scrollable strip synced with Gantt */}
        <div
          ref={stripRef}
          className="flex-1 overflow-x-auto py-0.5 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={handleStripMouseDown}
          onScroll={handleStripScroll}
        >
          <div className="relative" style={{ width: stripTotalWidth, height: 22 }}>
            {/* Month boundary labels */}
            {stripMonths.map((month) => {
              const offset = differenceInDays(month, projectRange.start) * dayWidth;
              return (
                <span
                  key={`sm-${month.toISOString()}`}
                  className="absolute top-0 text-[9px] text-muted-foreground/50 font-medium whitespace-nowrap border-l border-border/40 pl-1"
                  style={{ left: offset }}
                >
                  {format(month, "MMM")}
                </span>
              );
            })}
            {/* Day buttons — positioned at same scale as Gantt */}
            {stripDays.map((date) => {
              const offset = differenceInDays(date, projectRange.start) * dayWidth;
              const inSelection = date >= viewStart && date < selectionEnd;
              const today = isToday(date);
              const weekend = isWeekend(date);
              const isFirst = date.getDate() === 1;
              // At small dayWidth, only show some labels to avoid overlap
              const showLabel = dayWidth >= 16 || isFirst || (dayWidth >= 8 && date.getDate() % 5 === 0);

              return (
                <button
                  key={date.toISOString()}
                  data-active={inSelection || undefined}
                  onClick={() => handleStripDayClick(date)}
                  className={`absolute text-[10px] text-center transition-colors ${
                    inSelection
                      ? "text-primary font-semibold border-b-2 border-primary"
                      : today
                      ? "text-primary"
                      : weekend
                      ? "text-muted-foreground/40"
                      : "text-muted-foreground/70 hover:text-foreground"
                  }${today ? " bg-primary/10 rounded-t-sm" : ""}`}
                  style={{ left: offset, width: dayWidth, top: 8, height: 14 }}
                >
                  {showLabel ? format(date, "d") : ""}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main content: tree labels + gantt chart */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: tree labels */}
        <div
          ref={labelPanelRef}
          className="shrink-0 overflow-y-auto bg-card"
          style={{ width: labelWidth }}
          onScroll={handleLabelScroll}
        >
          {/* Column header with search — height matches timeline header */}
          <div className="border-b border-border flex items-center px-2 gap-1.5 relative sticky top-0 z-10 bg-card" style={{ height: headerHeight }}>
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input
              ref={ganttSearchRef}
              type="text"
              value={ganttSearch}
              onChange={(e) => setGanttSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setGanttSearch("");
                  setGanttSearchOpen(false);
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "ArrowDown" && ganttSearchOpen) {
                  e.preventDefault();
                  setGanttSearchIdx((i) => Math.min(i + 1, ganttSearchResults.length - 1));
                } else if (e.key === "ArrowUp" && ganttSearchOpen) {
                  e.preventDefault();
                  setGanttSearchIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && ganttSearchOpen && ganttSearchResults.length > 0) {
                  e.preventDefault();
                  navigateToTask(ganttSearchResults[ganttSearchIdx].id);
                }
              }}
              placeholder="Search tasks... (/)"
              className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            {ganttSearch && (
              <button
                onClick={() => { setGanttSearch(""); setGanttSearchOpen(false); }}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            )}

            {/* Search results dropdown */}
            {ganttSearchOpen && ganttSearchResults.length > 0 && (
              <div className="absolute left-0 top-full z-50 w-full max-h-[280px] overflow-y-auto border border-border rounded-b-lg shadow-xl" style={{ backgroundColor: "var(--card)" }}>
                <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border">
                  {ganttSearchResults.length} result{ganttSearchResults.length !== 1 ? "s" : ""}
                </div>
                {ganttSearchResults.slice(0, 50).map((node, i) => {
                  const dept = extractDept(node.description);
                  return (
                    <button
                      key={node.id}
                      onClick={() => navigateToTask(node.id)}
                      className={`w-full text-left px-2 py-1.5 flex items-center gap-2 text-xs transition-colors ${
                        i === ganttSearchIdx
                          ? "bg-primary/15 text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {dept && (
                        <div
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{ backgroundColor: DEPT_COLORS[dept] || "#71717a" }}
                        />
                      )}
                      <span className="truncate flex-1">{node.title}</span>
                      <span className="text-[9px] text-muted-foreground/50 shrink-0">{node.id}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {filteredRows.map((node) => {
            const Icon = TYPE_ICONS[node.type || "task"] || CheckSquare;
            const hasChildren = node.children.length > 0;
            const isCollapsed = collapsed.has(node.id);
            const progress = progressMap.get(node.id);
            const blockers = blockedByMap.get(node.id);
            const preds = predecessorMap.get(node.id);
            const succs = successorMap.get(node.id);
            const isCritical = criticalPathSet.has(node.id);
            const isOverdue = !!(
              node.endDate &&
              isBefore(parseISO(node.endDate), todayDate) &&
              node.status !== "done" &&
              node.status !== "cancelled"
            );
            const estimate = extractEstimate(node.description);

            return (
              <div
                key={node.id}
                data-task-id={node.id}
                className={`flex items-center gap-1.5 border-b border-border/50 hover:bg-accent/30 transition-colors cursor-pointer group ${
                  depMode ? "cursor-crosshair" : ""
                }${isCritical ? " bg-red-500/15 border-l-2 border-l-red-500" : ""}${isOverdue ? " bg-orange-500/10" : ""}`}
                style={{
                  height: ROW_HEIGHT,
                  paddingLeft: 8 + node.depth * 20,
                }}
                onClick={() => {
                  if (depMode) {
                    handleAddDep(node.id);
                  } else {
                    setEditItem(node);
                    setDialogType(
                      (node.type as "project" | "pipeline" | "phase") || "project"
                    );
                    setDialogParentId(node.parentId);
                    setDialogOpen(true);
                  }
                }}
              >
                {/* Collapse toggle */}
                {hasChildren ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(node.id);
                    }}
                    className="text-muted-foreground hover:text-foreground p-0.5"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                ) : (
                  <span className="w-4" />
                )}

                {node.type === "milestone" ? (
                  <Diamond className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                ) : (
                  <Icon
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: node.color || "#71717a" }}
                  />
                )}
                <span className={`text-xs truncate flex-1 ${
                  isCritical ? "text-red-400 font-semibold" : "text-foreground"
                }`}>
                  {node.title}
                </span>

                {/* Dependency counts */}
                {preds && preds.length > 0 && (
                  <span className="relative group/pred shrink-0">
                    <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-400 tabular-nums">
                      <ArrowLeftFromLine className="h-2.5 w-2.5" />
                      {preds.length}
                    </span>
                    <span className="absolute hidden group-hover/pred:block right-0 top-full z-50 bg-popover border border-border rounded-md p-2 shadow-lg text-[10px] text-foreground whitespace-nowrap min-w-[180px]">
                      <span className="font-semibold block mb-1 text-blue-400">Depends on:</span>
                      {preds.map((p) => (
                        <span key={p.id} className="flex items-center gap-1.5 py-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === "done" ? "bg-green-400" : "bg-orange-400"}`} />
                          <span className="text-muted-foreground truncate">{p.title}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                )}
                {succs && succs.length > 0 && (
                  <span className="relative group/succ shrink-0">
                    <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-400 tabular-nums">
                      <ArrowRightFromLine className="h-2.5 w-2.5" />
                      {succs.length}
                    </span>
                    <span className="absolute hidden group-hover/succ:block right-0 top-full z-50 bg-popover border border-border rounded-md p-2 shadow-lg text-[10px] text-foreground whitespace-nowrap min-w-[180px]">
                      <span className="font-semibold block mb-1 text-purple-400">Blocks:</span>
                      {succs.map((s) => (
                        <span key={s.id} className="flex items-center gap-1.5 py-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.status === "done" ? "bg-green-400" : "bg-zinc-400"}`} />
                          <span className="text-muted-foreground truncate">{s.title}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                )}

                {/* Critical path badge */}
                {isCritical && (
                  <span className="text-[9px] text-red-400 font-bold shrink-0 px-1 py-0.5 rounded bg-red-500/20">
                    CRITICAL
                  </span>
                )}

                {/* Overdue badge */}
                {isOverdue && (
                  <span className="text-[9px] text-orange-400 font-semibold shrink-0">
                    OVERDUE
                  </span>
                )}

                {/* Progress rollup */}
                {progress && (
                  <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                    {progress.done}/{progress.total}
                  </span>
                )}

                {/* Estimated hours */}
                {estimate && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-cyan-400 font-medium shrink-0 tabular-nums bg-cyan-500/10 rounded-full px-1.5 py-0.5" title="Estimated time">
                    <Clock className="h-2.5 w-2.5" />
                    {estimate}
                  </span>
                )}

                {/* Blocked-by tooltip */}
                {blockers && blockers.length > 0 && (
                  <span className="relative group/tip shrink-0">
                    <AlertTriangle className="h-3 w-3 text-red-400" />
                    <span className="absolute hidden group-hover/tip:block left-0 top-full z-50 bg-popover border border-border rounded-md p-2 shadow-lg text-[10px] text-foreground whitespace-nowrap min-w-[160px]">
                      <span className="font-semibold block mb-1">Blocked by:</span>
                      {blockers.map((b) => (
                        <span key={b.id} className="block text-muted-foreground">{b.id}: {b.title}</span>
                      ))}
                    </span>
                  </span>
                )}

                {/* Add child button */}
                {(node.type === "project" || node.type === "pipeline") && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const childType =
                        node.type === "project" ? "pipeline" : "phase";
                      setDialogType(childType);
                      setEditItem(null);
                      setDialogParentId(node.id);
                      setDialogOpen(true);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5 mr-1"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}

                {/* Dependency mode button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDepMode(depMode === node.id ? null : node.id);
                  }}
                  className={`opacity-0 group-hover:opacity-100 p-0.5 mr-1 transition-colors ${
                    depMode === node.id
                      ? "text-primary opacity-100"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Link dependency"
                >
                  <GitBranch className="h-3 w-3" />
                </button>

                {/* Send to Kanban — only for leaf task nodes */}
                {node.type === "task" && (
                  node.status === "queued" || node.status === "not started" ? (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await updateTask(node.id, {
                          kanbanColumn: "backlog",
                          status: "queued",
                        } as Record<string, unknown>);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary p-0.5 mr-1 transition-colors"
                      title="Send to Kanban backlog"
                    >
                      <Send className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="text-[9px] text-green-400 shrink-0 px-1">
                      In Kanban
                    </span>
                  )
                )}
              </div>
            );
          })}

        </div>

        {/* Resize handle — flex sibling so it spans full panel height regardless of scroll */}
        <div
          className="shrink-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10 border-r border-border"
          onMouseDown={handleResizeStart}
        >
          <div className="w-px h-full bg-border ml-auto" />
        </div>

        {/* Right panel: Gantt timeline */}
        <div className="flex-1 overflow-auto" ref={ganttRef} onScroll={handleGanttScroll}>
          <div style={{ width: timelineWidth, minWidth: "100%" }}>
            {/* Timeline header */}
            <div className="border-b border-border flex flex-col relative bg-card/50 sticky top-0 z-10">
              {/* Month row (always visible) */}
              <div className="h-6 flex items-end relative">
                {months.map((month) => {
                  const offset =
                    differenceInDays(month, viewStart) * dayWidth;
                  const monthEnd = endOfMonth(month);
                  const daysInMonth = differenceInDays(monthEnd, month) + 1;
                  const width = daysInMonth * dayWidth;

                  return (
                    <div
                      key={month.toISOString()}
                      className="absolute border-l border-border/30 flex items-end pb-0.5 pl-2"
                      style={{ left: offset, width }}
                    >
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {format(month, "MMM yyyy")}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Day row (day/week zoom only) */}
              {(zoom === "day" || zoom === "week") && (
                <div className="h-5 flex items-end relative">
                  {days.map((day) => {
                    const offset = differenceInDays(day, viewStart) * dayWidth;
                    const today = isToday(day);
                    const weekend = isWeekend(day);
                    return (
                      <div
                        key={day.toISOString()}
                        className={`absolute border-l flex items-end pb-0.5 ${
                          today
                            ? "border-red-500/40 bg-red-500/10"
                            : weekend
                            ? "border-border/20 bg-accent/10"
                            : "border-border/20"
                        }`}
                        style={{ left: offset, width: dayWidth }}
                      >
                        <span className={`text-[9px] px-1 truncate ${
                          today ? "text-red-400 font-semibold" : weekend ? "text-muted-foreground/50" : "text-muted-foreground"
                        }`}>
                          {zoom === "day" ? format(day, "EEE d") : format(day, "d")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rows + Bars */}
            <div className="relative">
              {/* Grid background lines */}
              {(zoom === "day" || zoom === "week") ? (
                days.map((day) => {
                  const offset = differenceInDays(day, viewStart) * dayWidth;
                  const weekend = isWeekend(day);
                  const today = isToday(day);
                  return (
                    <div
                      key={`grid-${day.toISOString()}`}
                      className={`absolute top-0 border-l ${
                        today
                          ? "border-red-500/20 bg-red-500/5"
                          : weekend
                          ? "border-border/10 bg-accent/5"
                          : "border-border/10"
                      }`}
                      style={{ left: offset, width: dayWidth, height: filteredRows.length * ROW_HEIGHT }}
                    />
                  );
                })
              ) : (
                months.map((month) => {
                  const offset =
                    differenceInDays(month, viewStart) * dayWidth;
                  return (
                    <div
                      key={`grid-${month.toISOString()}`}
                      className="absolute top-0 bottom-0 border-l border-border/20"
                      style={{ left: offset, height: filteredRows.length * ROW_HEIGHT }}
                    />
                  );
                })
              )}

              {/* Today marker */}
              {todayOffset !== null && (
                <div
                  className="absolute top-0 w-px bg-red-500/70 z-20"
                  style={{
                    left: todayOffset,
                    height: filteredRows.length * ROW_HEIGHT,
                  }}
                />
              )}

              {/* Bars */}
              {filteredRows.map((node, rowIdx) => {
                const pos = getBarPosition(node);
                const nodeIsCritical = criticalPathSet.has(node.id);
                const nodeIsOverdue = !!(
                  node.endDate &&
                  isBefore(parseISO(node.endDate), todayDate) &&
                  node.status !== "done" &&
                  node.status !== "cancelled"
                );
                const barColor = nodeIsCritical
                  ? "#ef4444"
                  : node.color || STATUS_COLORS[node.status] || "#71717a";

                return (
                  <div
                    key={node.id}
                    data-gantt-id={node.id}
                    className={`relative ${nodeIsCritical ? "z-[1]" : ""}`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    {/* Row background */}
                    <div
                      className={`absolute inset-0 ${
                        nodeIsCritical
                          ? "bg-red-500/15"
                          : nodeIsOverdue
                          ? "bg-orange-500/10"
                          : rowIdx % 2 === 0
                          ? "bg-transparent"
                          : "bg-accent/5"
                      }`}
                    />

                    {/* Bar */}
                    {pos && (
                      <GanttBar
                        id={node.id}
                        left={pos.left}
                        width={pos.width}
                        color={barColor}
                        label={node.title}
                        type={node.type || "task"}
                        status={node.status}
                        onDragEnd={handleBarDrag}
                        isCritical={nodeIsCritical}
                        isOverdue={nodeIsOverdue}
                        isMilestone={node.type === "milestone"}
                        progress={progressMap.get(node.id) ?? null}
                        onDoubleClick={() => {
                          setEditItem(node);
                          setDialogType(
                            (node.type as "project" | "pipeline" | "phase") || "project"
                          );
                          setDialogParentId(node.parentId);
                          setDialogOpen(true);
                        }}
                      />
                    )}
                  </div>
                );
              })}

              {/* Dependency arrows (SVG overlay) */}
              <svg
                className="absolute top-0 left-0 pointer-events-none z-10"
                style={{
                  width: timelineWidth,
                  height: filteredRows.length * ROW_HEIGHT,
                }}
              >
                {dependencies.map((dep) => {
                  const sourceIdx = filteredRows.findIndex(
                    (r) => r.id === dep.sourceId
                  );
                  const targetIdx = filteredRows.findIndex(
                    (r) => r.id === dep.targetId
                  );
                  if (sourceIdx === -1 || targetIdx === -1) return null;

                  const sourcePos = getBarPosition(filteredRows[sourceIdx]);
                  const targetPos = getBarPosition(filteredRows[targetIdx]);
                  if (!sourcePos || !targetPos) return null;

                  const x1 = sourcePos.left + sourcePos.width;
                  const y1 = sourceIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const x2 = targetPos.left;
                  const y2 = targetIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

                  const midX = x1 + (x2 - x1) / 2;

                  return (
                    <g key={dep.id}>
                      <path
                        d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke="#6d28d9"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        opacity={0.6}
                      />
                      {/* Arrow head */}
                      <polygon
                        points={`${x2},${y2} ${x2 - 6},${y2 - 3} ${x2 - 6},${y2 + 3}`}
                        fill="#6d28d9"
                        opacity={0.6}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Dependency mode indicator */}
      {depMode && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-medium shadow-lg z-50 flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5" />
          Click a target to create dependency
          <button
            onClick={() => setDepMode(null)}
            className="ml-2 text-primary-foreground/70 hover:text-primary-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Dialog */}
      <UnifiedTaskDialog
        item={editItem}
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditItem(null);
        }}
        defaultType={dialogType}
        defaultParentId={dialogParentId}
        parentOptions={parentOptions}
        predecessors={editItem ? predecessorMap.get(editItem.id) ?? [] : []}
        successors={editItem ? successorMap.get(editItem.id) ?? [] : []}
      />
    </div>
  );
}

// --- Gantt Bar sub-component with drag ---

interface GanttBarProps {
  id: string;
  left: number;
  width: number;
  color: string;
  label: string;
  type: string;
  status: string;
  onDragEnd: (id: string, newLeft: number, newWidth: number) => void;
  onDoubleClick?: () => void;
  isCritical?: boolean;
  isOverdue?: boolean;
  isMilestone?: boolean;
  progress?: { done: number; total: number } | null;
}

function GanttBar({ id, left, width, color, label, type, status, onDragEnd, onDoubleClick, isCritical, isOverdue, isMilestone, progress }: GanttBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{
    mode: "move" | "resize-right";
    startX: number;
    origLeft: number;
    origWidth: number;
  } | null>(null);
  const [currentLeft, setCurrentLeft] = useState(left);
  const [currentWidth, setCurrentWidth] = useState(width);

  useEffect(() => {
    if (!dragging) {
      setCurrentLeft(left);
      setCurrentWidth(width);
    }
  }, [left, width, dragging]);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startX;
      if (dragging.mode === "move") {
        setCurrentLeft(dragging.origLeft + dx);
      } else {
        setCurrentWidth(Math.max(dragging.origWidth + dx, 14));
      }
    };

    const handleUp = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startX;
      if (dragging.mode === "move") {
        onDragEnd(id, dragging.origLeft + dx, currentWidth);
      } else {
        onDragEnd(id, currentLeft, Math.max(dragging.origWidth + dx, 14));
      }
      setDragging(null);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, id, currentLeft, currentWidth, onDragEnd]);

  const barHeight = isMilestone ? 16 : type === "project" ? 10 : type === "pipeline" ? 18 : type === "phase" ? 24 : 28;
  const topOffset = (ROW_HEIGHT - barHeight) / 2;
  const opacity = status === "done" || status === "cancelled" ? 0.5 : 1;
  const showLabelInside = !isMilestone && currentWidth > 80;
  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  // Milestone: render diamond marker
  if (isMilestone) {
    return (
      <div
        ref={barRef}
        className="absolute group cursor-pointer"
        style={{ left: currentLeft - 8, top: topOffset }}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
      >
        <div
          className={`w-4 h-4 rotate-45 border-2 ${isCritical ? "ring-2 ring-red-500/50" : ""}`}
          style={{ backgroundColor: color, borderColor: isCritical ? "#ef4444" : color, opacity }}
        />
        <span
          className="absolute text-[10px] text-foreground/70 whitespace-nowrap font-medium pointer-events-none"
          style={{ left: 20, top: 0, maxWidth: 200 }}
        >
          {label}
        </span>
      </div>
    );
  }

  // Border classes for critical path / overdue
  const ringClass = isCritical
    ? "ring-2 ring-red-400 shadow-[0_0_10px_rgba(239,68,68,0.6)]"
    : isOverdue
    ? "ring-2 ring-orange-500/80"
    : "";
  const barColor = isCritical ? "#ef4444" : color;
  const criticalOpacity = isCritical ? 1 : opacity;

  return (
    <div
      ref={barRef}
      className={`absolute group cursor-grab active:cursor-grabbing ${isCritical ? "z-10" : ""}`}
      style={{
        left: currentLeft,
        width: showLabelInside ? currentWidth : undefined,
        top: topOffset,
        height: barHeight,
      }}
    >
      {/* Bar body */}
      <div
        className={`h-full rounded-sm relative overflow-hidden ${ringClass}`}
        style={{ backgroundColor: barColor, opacity: criticalOpacity, width: currentWidth, minWidth: 8 }}
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging({
            mode: "move",
            startX: e.clientX,
            origLeft: currentLeft,
            origWidth: currentWidth,
          });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.();
        }}
      >
        {/* Progress fill for parent bars */}
        {progress && progress.total > 0 && (
          <div
            className="absolute inset-y-0 left-0 bg-white/20 rounded-sm"
            style={{ width: `${pct}%` }}
          />
        )}

        {/* Label inside bar — sticky: tracks horizontal scroll so text stays visible */}
        {showLabelInside && (
          <span
            className="absolute inset-0 flex items-center text-[10px] text-white/90 truncate font-medium z-[1]"
            style={{
              paddingLeft: `clamp(8px, calc(var(--gantt-scroll-left, 0px) - ${currentLeft}px + 8px), ${Math.max(currentWidth - 40, 8)}px)`,
              paddingRight: 8,
            }}
          >
            {label}
            {progress && (
              <span className="ml-auto text-white/60 text-[9px] tabular-nums shrink-0 pl-1">
                {pct}%
              </span>
            )}
          </span>
        )}
      </div>

      {/* Label outside bar (when bar is too narrow) */}
      {!showLabelInside && (
        <span
          className="absolute text-[10px] text-foreground/70 truncate whitespace-nowrap font-medium pointer-events-none"
          style={{ left: currentWidth + 4, top: "50%", transform: "translateY(-50%)", maxWidth: 200 }}
        >
          {label}
        </span>
      )}

      {/* Resize handle (right edge) */}
      <div
        className="absolute top-0 right-0 w-2 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging({
            mode: "resize-right",
            startX: e.clientX,
            origLeft: currentLeft,
            origWidth: currentWidth,
          });
        }}
      >
        <div className="h-full w-0.5 bg-white/50 ml-auto" />
      </div>
    </div>
  );
}
