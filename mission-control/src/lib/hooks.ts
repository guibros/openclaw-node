import useSWR, { mutate } from "swr";
import { useEffect, useRef } from "react";

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
  // Mesh execution fields
  execution: string | null;
  meshTaskId: string | null;
  meshNode: string | null;
  metric: string | null;
  budgetMinutes: number | null;
  scope: string | null;
  // Collab routing fields
  collaboration: string | null;
  preferredNodes: string | null;
  excludeNodes: string | null;
  clusterId: string | null;
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

// --- Cowork: Clusters & Collab Sessions ---

export interface ClusterMemberView {
  id: number;
  nodeId: string;
  role: string;
  nodeStatus: string;
  createdAt: string;
}

export interface ClusterView {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  defaultMode: string;
  defaultConvergence: string;
  convergenceThreshold: number;
  maxRounds: number;
  status: string;
  members: ClusterMemberView[];
  updatedAt: string;
  createdAt: string;
}

export interface CollabNode {
  node_id: string;
  role: string;
  scope: string[];
  joined_at: string;
  status: string;
}

export interface CollabReflection {
  node_id: string;
  summary: string;
  learnings: string;
  artifacts: string[];
  confidence: number;
  vote: string;
  parse_failed?: boolean;
  synthetic?: boolean;
  submitted_at: string;
}

export interface CollabRound {
  round_number: number;
  started_at: string;
  completed_at: string | null;
  shared_intel: string;
  reflections: CollabReflection[];
}

export interface CollabSession {
  session_id: string;
  task_id: string;
  mode: string;
  status: string;
  min_nodes: number;
  max_nodes: number | null;
  nodes: CollabNode[];
  current_round: number;
  max_rounds: number;
  rounds: CollabRound[];
  convergence: {
    type: string;
    threshold: number;
    metric: string | null;
    min_quorum: number;
  };
  scope_strategy: string;
  result: Record<string, unknown> | null;
  audit_log: Array<{ ts: string; event: string; [k: string]: unknown }>;
  created_at: string;
  completed_at: string | null;
}

export function useClusters() {
  const { data, error, isLoading } = useSWR<{ clusters: ClusterView[] }>(
    "/api/cowork/clusters",
    fetcher,
    { refreshInterval: 10000 }
  );
  return { clusters: data?.clusters ?? [], error, isLoading };
}

export function useCollabSessions(status?: string, refreshInterval = 5000) {
  const params = status ? `?status=${status}` : "";
  const { data, error, isLoading } = useSWR<{
    sessions: CollabSession[];
    natsAvailable: boolean;
  }>(`/api/cowork/sessions${params}`, fetcher, { refreshInterval });
  return {
    sessions: data?.sessions ?? [],
    natsAvailable: data?.natsAvailable ?? true,
    error,
    isLoading,
  };
}

export async function createCluster(params: {
  name: string;
  description?: string;
  color?: string;
  defaultMode?: string;
  defaultConvergence?: string;
  convergenceThreshold?: number;
  maxRounds?: number;
  members?: Array<{ nodeId: string; role: string }>;
}) {
  const res = await fetch("/api/cowork/clusters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  await mutate("/api/cowork/clusters");
  return data;
}

export async function updateCluster(id: string, updates: Record<string, unknown>) {
  const res = await fetch(`/api/cowork/clusters/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  await mutate("/api/cowork/clusters");
  return data;
}

export async function deleteCluster(id: string) {
  await fetch(`/api/cowork/clusters/${id}`, { method: "DELETE" });
  await mutate("/api/cowork/clusters");
}

export async function addClusterMember(clusterId: string, nodeId: string, role: string) {
  const res = await fetch(`/api/cowork/clusters/${clusterId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, role }),
  });
  const data = await res.json();
  await mutate("/api/cowork/clusters");
  return data;
}

export async function updateClusterMember(clusterId: string, nodeId: string, role: string) {
  const res = await fetch(`/api/cowork/clusters/${clusterId}/members`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, role }),
  });
  const data = await res.json();
  await mutate("/api/cowork/clusters");
  return data;
}

export async function removeClusterMember(clusterId: string, nodeId: string) {
  await fetch(
    `/api/cowork/clusters/${clusterId}/members?nodeId=${encodeURIComponent(nodeId)}`,
    { method: "DELETE" }
  );
  await mutate("/api/cowork/clusters");
}

export async function dispatchCollabTask(params: {
  title: string;
  description?: string;
  clusterId?: string;
  nodes?: Array<{ nodeId: string; role: string }>;
  mode?: string;
  convergence?: { type: string; threshold?: number; metric?: string };
  scopeStrategy?: string;
  budgetMinutes?: number;
  maxRounds?: number;
  metric?: string;
  scope?: string[];
}) {
  const res = await fetch("/api/cowork/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  await mutate("/api/cowork/sessions");
  await mutate("/api/cowork/clusters");
  await mutate("/api/tasks");
  return data;
}

export async function interveneSession(params: {
  action: "abort" | "force_converge" | "remove_node";
  sessionId: string;
  nodeId?: string;
}) {
  const res = await fetch("/api/cowork/intervene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  await mutate("/api/cowork/sessions");
  await mutate("/api/tasks");
  return data;
}

// --- Mesh SSE integration ---

/**
 * Subscribe to mesh SSE events and invalidate SWR caches on state changes.
 * Call once at the app level (e.g., in layout or task board).
 */
export function useMeshSSE() {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/mesh/events");
    esRef.current = es;

    const invalidate = () => {
      mutate("/api/tasks");
      mutate("/api/mesh/nodes");
      mutate("/api/activity");
    };

    const invalidateCollab = () => {
      mutate("/api/cowork/sessions");
      mutate("/api/cowork/clusters");
      mutate("/api/tasks");
      mutate("/api/activity");
    };

    // Task events
    es.addEventListener("completed", invalidate);
    es.addEventListener("claimed", invalidate);
    es.addEventListener("started", invalidate);
    es.addEventListener("failed", invalidate);
    es.addEventListener("submitted", invalidate);
    es.addEventListener("released", invalidate);
    es.addEventListener("cancelled", invalidate);

    // Collab events (mesh.events.collab.* → event type is "collab.{action}")
    es.addEventListener("collab.created", invalidateCollab);
    es.addEventListener("collab.joined", invalidateCollab);
    es.addEventListener("collab.round_started", invalidateCollab);
    es.addEventListener("collab.reflection_received", invalidateCollab);
    es.addEventListener("collab.converged", invalidateCollab);
    es.addEventListener("collab.completed", invalidateCollab);
    es.addEventListener("collab.aborted", invalidateCollab);
    es.addEventListener("collab.node_removed", invalidateCollab);

    // KV task state changes (from dual-iterator watcher)
    es.addEventListener("kv.task.updated", () => {
      mutate("/api/mesh/tasks");
      mutate("/api/tasks");
    });

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);
}

// --- Token usage ---

export interface TokenUsageEntry {
  id: number;
  task_id: string | null;
  node_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  timestamp: string;
}

export interface TokenSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  taskCount: number;
  byModel: Array<{ model: string; cost: number; count: number }>;
  byNode: Array<{ node_id: string; cost: number; count: number }>;
  recent: TokenUsageEntry[];
}

export function useTokenUsage(period: "today" | "week" | "month" = "today") {
  const { data, error, isLoading } = useSWR<TokenSummary>(
    `/api/mesh/tokens?period=${period}`,
    fetcher,
    { refreshInterval: 30000 }
  );
  return { tokenData: data ?? null, error, isLoading };
}

// --- Mesh Tasks (Distributed MC) ---

export interface MeshTask {
  task_id: string;
  title: string;
  description: string;
  status: string;
  origin: string;
  owner: string | null;
  priority: number;
  budget_minutes: number;
  metric: string | null;
  created_at: string;
  [key: string]: unknown;
}

export function useMeshTasks() {
  const { data, error, isLoading } = useSWR<{
    tasks: MeshTask[];
    natsAvailable: boolean;
  }>("/api/mesh/tasks", fetcher, {
    refreshInterval: 5000,
  });
  return {
    meshTasks: data?.tasks ?? [],
    natsAvailable: data?.natsAvailable ?? false,
    error,
    isLoading,
  };
}

export function useNodeIdentity() {
  const { data, error, isLoading } = useSWR<{
    nodeId: string;
    role: "lead" | "worker";
    platform: string;
  }>("/api/mesh/identity", fetcher);
  return { identity: data ?? null, error, isLoading };
}

export async function createMeshTask(task: {
  title: string;
  description?: string;
  priority?: number;
  budget_minutes?: number;
  metric?: string;
  [key: string]: unknown;
}) {
  const res = await fetch("/api/mesh/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  const data = await res.json();
  await mutate("/api/mesh/tasks");
  return data;
}

export async function updateMeshTask(
  id: string,
  updates: Record<string, unknown>,
  revision: number
) {
  const res = await fetch(`/api/mesh/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...updates, revision }),
  });
  const data = await res.json();
  await mutate("/api/mesh/tasks");
  return data;
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
