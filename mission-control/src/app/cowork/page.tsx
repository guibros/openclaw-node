"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, Plus, Users2 } from "lucide-react";
import {
  useCollabSessions,
  useClusters,
  useTasks,
  addClusterMember,
} from "@/lib/hooks";
import { SessionCard } from "@/components/cowork/session-card";
import { ClusterCard } from "@/components/cowork/cluster-card";
import { CreateClusterDialog } from "@/components/cowork/create-cluster-dialog";
import { DispatchForm } from "@/components/cowork/dispatch-form";
import useSWR from "swr";
import { RolePicker } from "@/components/cowork/role-picker";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Tab = "sessions" | "clusters" | "dispatch";

export default function CoworkPage() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [createOpen, setCreateOpen] = useState(false);
  const [addNodeTarget, setAddNodeTarget] = useState<string | null>(null);

  const { sessions: activeSessions, natsAvailable } = useCollabSessions(
    "recruiting,active",
    5000
  );
  const { sessions: recentSessions } = useCollabSessions(
    "converged,completed,aborted",
    30000
  );
  const { clusters } = useClusters();
  const { tasks } = useTasks();

  // Build a map from task_id to Task for cross-referencing sessions
  const taskMap = useMemo(() => {
    const map = new Map<string, typeof tasks[0]>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  const handleDispatchFromCluster = (clusterId: string) => {
    setTab("dispatch");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">Cowork</h1>
          {activeSessions.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              {activeSessions.length} active
            </span>
          )}
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs text-muted-foreground">
            {clusters.length} clusters
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex rounded-lg bg-accent/50 p-0.5">
          {(["sessions", "clusters", "dispatch"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Sessions tab */}
        {tab === "sessions" && (
          <>
            {!natsAvailable && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-400">
                <AlertTriangle className="h-4 w-4" />
                NATS unavailable — session data may be stale
              </div>
            )}

            {activeSessions.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">
                  Active Sessions
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {activeSessions.map((s) => (
                    <SessionCard key={s.session_id} session={s} linkedTask={taskMap.get(s.task_id)} />
                  ))}
                </div>
              </section>
            )}

            {recentSessions.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">
                  Recent Sessions
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {recentSessions.slice(0, 8).map((s) => (
                    <SessionCard key={s.session_id} session={s} linkedTask={taskMap.get(s.task_id)} />
                  ))}
                </div>
              </section>
            )}

            {activeSessions.length === 0 && recentSessions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Users2 className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">No collab sessions yet</p>
                <p className="text-xs mt-1">
                  Dispatch a task from the Dispatch tab to start one
                </p>
              </div>
            )}
          </>
        )}

        {/* Clusters tab */}
        {tab === "clusters" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                Clusters
              </h2>
              <button
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs bg-accent-foreground text-accent transition-colors hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                New Cluster
              </button>
            </div>

            {clusters.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {clusters.map((c) => (
                  <ClusterCard
                    key={c.id}
                    cluster={c}
                    onDispatch={handleDispatchFromCluster}
                    onAddNode={(id) => setAddNodeTarget(id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Users2 className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">No clusters yet</p>
                <p className="text-xs mt-1">
                  Create one to organize your mesh nodes into teams
                </p>
              </div>
            )}

            <CreateClusterDialog
              open={createOpen}
              onClose={() => setCreateOpen(false)}
            />

            {/* Add node mini-dialog */}
            {addNodeTarget && (
              <AddNodeDialog
                clusterId={addNodeTarget}
                existingNodeIds={
                  clusters
                    .find((c) => c.id === addNodeTarget)
                    ?.members.map((m) => m.nodeId) ?? []
                }
                onClose={() => setAddNodeTarget(null)}
              />
            )}
          </>
        )}

        {/* Dispatch tab */}
        {tab === "dispatch" && <DispatchForm />}
      </main>
    </div>
  );
}

function AddNodeDialog({
  clusterId,
  existingNodeIds,
  onClose,
}: {
  clusterId: string;
  existingNodeIds: string[];
  onClose: () => void;
}) {
  const { data } = useSWR<{
    nodes: Array<{ nodeId: string; status: string }>;
  }>("/api/mesh/nodes", fetcher);
  const meshNodes = (data?.nodes ?? []).filter(
    (n) => !existingNodeIds.includes(n.nodeId)
  );

  const [selectedRole, setSelectedRole] = useState("worker");

  const handleAdd = async (nodeId: string) => {
    await addClusterMember(clusterId, nodeId, selectedRole);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Add Node</span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            close
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-muted-foreground">Role:</span>
            <RolePicker value={selectedRole} onChange={setSelectedRole} />
          </div>
          {meshNodes.map((node) => (
            <button
              key={node.nodeId}
              onClick={() => handleAdd(node.nodeId)}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-xs hover:bg-accent/50 transition-colors"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  node.status === "online" ? "bg-green-400" : "bg-zinc-600"
                }`}
              />
              <span className="font-mono">{node.nodeId}</span>
            </button>
          ))}
          {meshNodes.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              All nodes already in this cluster
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
