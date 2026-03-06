import useSWR, { mutate } from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface Task {
  id: string;
  title: string;
  status: string;
  kanbanColumn: string;
  owner: string | null;
  successCriteria: string | null;
  artifacts: string[];
  nextAction: string | null;
  scheduledDate: string | null;
  project: string | null;
  type: string | null;
  parentId: string | null;
  startDate: string | null;
  endDate: string | null;
  color: string | null;
  description: string | null;
  needsApproval: number | null;
  triggerKind: string | null;
  triggerAt: string | null;
  triggerCron: string | null;
  triggerTz: string | null;
  isRecurring: number | null;
  capacityClass: string | null;
  autoPriority: number | null;
  showInCalendar: number | null;
  acknowledgedAt: string | null;
  updatedAt: string;
  createdAt: string;
  sortOrder: number;
}

export interface Dependency {
  id: number;
  sourceId: string;
  targetId: string;
  type: string;
  createdAt: string;
}

export interface MemoryResult {
  id: number;
  source: string;
  category: string | null;
  filePath: string;
  title: string | null;
  date: string | null;
  modifiedAt: string | null;
  excerpt: string;
  rank: number;
}

export interface MemoryDoc {
  id: number;
  source: string;
  category: string | null;
  filePath: string;
  title: string | null;
  date: string | null;
  content: string;
  frontmatter: string | null;
}

export function useTasks() {
  const { data, error, isLoading } = useSWR<Task[]>("/api/tasks", fetcher, {
    refreshInterval: 3000,
  });
  return { tasks: data ?? [], error, isLoading };
}

export async function createTask(task: {
  title: string;
  status?: string;
  owner?: string;
  nextAction?: string;
  scheduled_date?: string;
  project?: string;
  [key: string]: unknown;
}) {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  const data = await res.json();
  await mutate("/api/tasks");
  return data;
}

export async function updateTask(
  id: string,
  updates: Partial<Omit<Task, "id" | "createdAt">>
) {
  const res = await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  await mutate("/api/tasks");
  return data;
}

export async function deleteTask(id: string) {
  await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  await mutate("/api/tasks");
}

export function useMemorySearch(query: string, limit = 20, source?: string) {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  if (source) params.set("source", source);

  const { data, error, isLoading } = useSWR<{
    results: MemoryResult[];
    total: number;
  }>(
    query.length >= 2 ? `/api/memory/search?${params.toString()}` : null,
    fetcher
  );
  return {
    results: data?.results ?? [],
    total: data?.total ?? 0,
    error,
    isLoading,
  };
}

export interface ActivityEntry {
  id: number;
  eventType: string;
  taskId: string | null;
  description: string;
  timestamp: string;
}

export interface MemoryDocListItem {
  id: number;
  source: string;
  category: string | null;
  filePath: string;
  title: string | null;
  date: string | null;
  modifiedAt: string | null;
}

export function useActivity(limit = 50) {
  const { data, error, isLoading } = useSWR<ActivityEntry[]>(
    `/api/activity?limit=${limit}`,
    fetcher,
    { refreshInterval: 3000 }
  );
  return { entries: data ?? [], error, isLoading };
}

export interface LiveEvent {
  timestamp: string;
  type: "file_write" | "file_edit" | "file_read" | "bash_command" | "message";
  tool: string;
  detail: string;
  filePath?: string;
  command?: string;
  success?: boolean;
}

export function useLiveActivity(limit = 30) {
  const { data, error, isLoading } = useSWR<{
    events: LiveEvent[];
    count: number;
  }>(`/api/activity/live?limit=${limit}`, fetcher, {
    refreshInterval: 5000,
  });
  return { events: data?.events ?? [], count: data?.count ?? 0, error, isLoading };
}

export function useMemoryDocs(source?: string) {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  const { data, error, isLoading } = useSWR<{
    docs: MemoryDocListItem[];
    total: number;
  }>(`/api/memory/list?${params.toString()}`, fetcher);
  return { docs: data?.docs ?? [], total: data?.total ?? 0, error, isLoading };
}

export function useMemoryDoc(filePath: string | null) {
  const { data, error, isLoading } = useSWR<MemoryDoc>(
    filePath ? `/api/memory/doc?path=${encodeURIComponent(filePath)}` : null,
    fetcher
  );
  return { doc: data ?? null, error, isLoading };
}

// --- Project hierarchy hooks ---

export interface ProjectWithCount extends Task {
  childCount: number;
}

export function useProjects() {
  const { data, error, isLoading } = useSWR<ProjectWithCount[]>(
    "/api/projects",
    fetcher,
    { refreshInterval: 5000 }
  );
  return { projects: data ?? [], error, isLoading };
}

export function useProjectTree(projectId: string | null) {
  const { data, error, isLoading } = useSWR<Task[]>(
    projectId ? `/api/tasks/${projectId}/tree` : null,
    fetcher,
    { refreshInterval: 5000 }
  );
  return { tree: data ?? [], error, isLoading };
}

export function useProjectDependencies(projectId: string | null) {
  const { data, error, isLoading } = useSWR<Dependency[]>(
    projectId ? `/api/dependencies?projectId=${projectId}` : null,
    fetcher,
    { refreshInterval: 5000 }
  );
  return { dependencies: data ?? [], error, isLoading };
}

export async function createProject(project: {
  id: string;
  title: string;
  description?: string;
  color?: string;
  start_date?: string;
  end_date?: string;
  owner?: string;
  status?: string;
}) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  const data = await res.json();
  await mutate("/api/projects");
  await mutate("/api/tasks");
  return data;
}

export async function createDependency(dep: {
  sourceId: string;
  targetId: string;
  type?: string;
}) {
  const res = await fetch("/api/dependencies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dep),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create dependency");
  return data;
}

export async function deleteDependency(id: number) {
  await fetch(`/api/dependencies?id=${id}`, { method: "DELETE" });
}

// --- Memory Items ---

export interface MemoryItemEntry {
  id: number;
  fact_text: string;
  confidence: number;
  source_doc_id: number | null;
  category: string | null;
  status: string;
  gate_decision: string | null;
  gate_reason: string | null;
  extraction_source: string | null;
  last_accessed: string | null;
  created_at: string;
  source_file?: string;
  source_title?: string;
  source_date?: string;
}

export interface CategoryOverview {
  category: string;
  itemCount: number;
  hasSummary: boolean;
  summaryAge: number | null;
}

export function useMemoryItems(category?: string, limit = 50) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  params.set("limit", String(limit));

  const { data, error, isLoading } = useSWR<{
    items: MemoryItemEntry[];
    limit: number;
    offset: number;
  }>(`/api/memory/items?${params.toString()}`, fetcher, {
    refreshInterval: 10000,
  });
  return { items: data?.items ?? [], error, isLoading };
}

export function useMemoryItemStats() {
  const { data, error, isLoading } = useSWR<{
    active: number;
    archived: number;
    byCategory: Array<{ category: string; count: number }>;
    recentAudit: Array<Record<string, unknown>>;
  }>("/api/memory/items?stats=true", fetcher, {
    refreshInterval: 30000,
  });
  return {
    stats: data ?? null,
    error,
    isLoading,
  };
}

export function useMemoryCategories() {
  const { data, error, isLoading } = useSWR<{
    categories: CategoryOverview[];
  }>("/api/memory/categories", fetcher, {
    refreshInterval: 30000,
  });
  return {
    categories: data?.categories ?? [],
    error,
    isLoading,
  };
}

// --- Wikilink Graph ---

export interface WikilinkNode {
  id: string; // filePath
  title: string;
  source: string;
  category: string | null;
  linkCount: number;
}

export interface WikilinkLink {
  source: string;
  target: string;
}

export interface WikilinkGraphData {
  nodes: WikilinkNode[];
  links: WikilinkLink[];
  stats: { nodeCount: number; linkCount: number };
}

export function useWikilinkGraph() {
  const { data, error, isLoading } = useSWR<WikilinkGraphData>(
    "/api/memory/wikilinks",
    fetcher
  );
  return { graph: data ?? null, error, isLoading };
}

// --- Workspace Files ---

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
  ext?: string;
  size?: number;
}

export function useWorkspaceFiles() {
  const { data, error, isLoading } = useSWR<{ root: string; tree: FileNode[] }>(
    "/api/workspace/files",
    fetcher
  );
  return { tree: data?.tree ?? [], root: data?.root ?? "", error, isLoading };
}

export interface WorkspaceFile {
  filePath: string;
  title: string;
  content: string;
  source: string;
  ext: string;
  size: number;
  modifiedAt: string;
}

export function useWorkspaceFile(filePath: string | null) {
  const { data, error, isLoading } = useSWR<WorkspaceFile>(
    filePath ? `/api/workspace/read?path=${encodeURIComponent(filePath)}` : null,
    fetcher
  );
  return { file: data ?? null, error, isLoading };
}

// --- Critical Path ---

export function useCriticalPath(projectId: string | null) {
  const { data, error, isLoading } = useSWR<{
    criticalPath: string[];
    totalDuration: number;
  }>(
    projectId ? `/api/critical-path?projectId=${projectId}` : null,
    fetcher,
    { refreshInterval: 10000 }
  );
  return {
    criticalPath: data?.criticalPath ?? [],
    totalDuration: data?.totalDuration ?? 0,
    error,
    isLoading,
  };
}

// --- Burndown ---

export interface BurndownData {
  total: number;
  counts: Record<string, number>;
  startDate: string | null;
  endDate: string | null;
  timeline: Array<{ date: string; done: number; remaining: number }>;
}

export function useBurndown(projectId: string | null) {
  const { data, error, isLoading } = useSWR<BurndownData>(
    projectId ? `/api/burndown?projectId=${projectId}` : `/api/burndown`,
    fetcher,
    { refreshInterval: 30000 }
  );
  return { burndown: data ?? null, error, isLoading };
}

// --- Scheduler ---

export function useSchedulerTick(intervalMs = 30_000) {
  useSWR(
    "/api/scheduler/tick",
    (url) => fetch(url, { method: "POST" }).then((r) => r.json()),
    {
      refreshInterval: intervalMs,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
}
