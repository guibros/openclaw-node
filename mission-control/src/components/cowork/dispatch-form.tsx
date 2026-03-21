"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  dispatchCollabTask,
  useClusters,
  type ClusterView,
} from "@/lib/hooks";
import { RolePicker, RoleBadge } from "./role-picker";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const MODES = ["parallel", "sequential", "review"] as const;
const CONVERGENCES = ["unanimous", "majority", "coordinator"] as const;
const SCOPE_STRATEGIES = ["shared", "leader_only", "partitioned"] as const;

export function DispatchForm() {
  const { clusters } = useClusters();
  const { data: nodesData } = useSWR<{
    nodes: Array<{ nodeId: string; status: string }>;
  }>("/api/mesh/nodes", fetcher);
  const meshNodes = nodesData?.nodes ?? [];

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [nodeSource, setNodeSource] = useState<"cluster" | "manual">(
    "cluster"
  );
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    null
  );
  const [manualNodes, setManualNodes] = useState<
    Array<{ nodeId: string; role: string }>
  >([]);
  const [mode, setMode] = useState<string>("parallel");
  const [convergenceType, setConvergenceType] = useState<string>("unanimous");
  const [threshold, setThreshold] = useState(66);
  const [scopeStrategy, setScopeStrategy] = useState<string>("shared");
  const [maxRounds, setMaxRounds] = useState(5);
  const [budgetMinutes, setBudgetMinutes] = useState(30);
  const [metric, setMetric] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId);

  const toggleManualNode = (nodeId: string) => {
    setManualNodes((prev) => {
      const exists = prev.find((n) => n.nodeId === nodeId);
      if (exists) return prev.filter((n) => n.nodeId !== nodeId);
      return [...prev, { nodeId, role: "worker" }];
    });
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setResult(null);

    try {
      const scope = scopeText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const data = await dispatchCollabTask({
        title: title.trim(),
        description: description.trim() || undefined,
        clusterId:
          nodeSource === "cluster" ? selectedClusterId ?? undefined : undefined,
        nodes: nodeSource === "manual" ? manualNodes : undefined,
        mode,
        convergence: {
          type: convergenceType,
          threshold: convergenceType === "majority" ? threshold : undefined,
        },
        scopeStrategy,
        budgetMinutes,
        maxRounds,
        metric: metric.trim() || undefined,
        scope: scope.length > 0 ? scope : undefined,
      });

      if (data.error) {
        setResult({ ok: false, message: data.error });
      } else {
        setResult({
          ok: true,
          message: `Task ${data.taskId} dispatched to ${data.nodesAssigned?.length ?? 0} nodes`,
        });
        // Reset form
        setTitle("");
        setDescription("");
        setMetric("");
        setScopeText("");
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      {/* Title */}
      <div>
        <label className="text-xs text-muted-foreground">Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Collab task title..."
          className="mt-1 w-full rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent-foreground"
        />
      </div>

      {/* Description */}
      <div>
        <label className="text-xs text-muted-foreground">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What should the cluster work on?"
          rows={3}
          className="mt-1 w-full rounded border border-border bg-transparent px-3 py-2 text-xs outline-none focus:border-accent-foreground resize-none"
        />
      </div>

      {/* Node source toggle */}
      <div>
        <label className="text-xs text-muted-foreground">Nodes</label>
        <div className="mt-1 flex gap-1">
          <button
            onClick={() => setNodeSource("cluster")}
            className={`rounded px-3 py-1.5 text-xs transition-colors ${
              nodeSource === "cluster"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            From Cluster
          </button>
          <button
            onClick={() => setNodeSource("manual")}
            className={`rounded px-3 py-1.5 text-xs transition-colors ${
              nodeSource === "manual"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            Manual
          </button>
        </div>

        {nodeSource === "cluster" && (
          <div className="mt-2 space-y-2">
            {clusters.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedClusterId(c.id)}
                className={`flex items-center gap-3 rounded px-3 py-2 text-xs cursor-pointer transition-colors ${
                  selectedClusterId === c.id
                    ? "bg-accent/40 border border-accent-foreground/20"
                    : "bg-accent/10 hover:bg-accent/20"
                }`}
              >
                {c.color && (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                )}
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">
                  {c.members.length} nodes
                </span>
              </div>
            ))}
            {selectedCluster && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selectedCluster.members.map((m) => (
                  <span
                    key={m.nodeId}
                    className="inline-flex items-center gap-1 rounded bg-accent/30 px-2 py-0.5 text-[10px]"
                  >
                    <span className="font-mono">{m.nodeId.split("-")[0]}</span>
                    <RoleBadge role={m.role} />
                  </span>
                ))}
              </div>
            )}
            {clusters.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No clusters created yet. Switch to Clusters tab to create one.
              </p>
            )}
          </div>
        )}

        {nodeSource === "manual" && (
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {meshNodes.map((node) => {
              const selected = manualNodes.find(
                (n) => n.nodeId === node.nodeId
              );
              return (
                <div
                  key={node.nodeId}
                  onClick={() => toggleManualNode(node.nodeId)}
                  className={`flex items-center justify-between rounded px-3 py-2 text-xs cursor-pointer transition-colors ${
                    selected
                      ? "bg-accent/40 border border-accent-foreground/20"
                      : "bg-accent/10 hover:bg-accent/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        node.status === "online"
                          ? "bg-green-400"
                          : "bg-zinc-600"
                      }`}
                    />
                    <span className="font-mono">{node.nodeId}</span>
                  </div>
                  {selected && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <RolePicker
                        value={selected.role}
                        onChange={(role) =>
                          setManualNodes((prev) =>
                            prev.map((n) =>
                              n.nodeId === node.nodeId ? { ...n, role } : n
                            )
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Settings grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Mode */}
        <div>
          <label className="text-xs text-muted-foreground">Mode</label>
          <div className="mt-1 flex gap-1">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  mode === m
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Convergence */}
        <div>
          <label className="text-xs text-muted-foreground">Convergence</label>
          <div className="mt-1 flex gap-1">
            {CONVERGENCES.map((c) => (
              <button
                key={c}
                onClick={() => setConvergenceType(c)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  convergenceType === c
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {convergenceType === "majority" && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="range"
                min={50}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-8">
                {threshold}%
              </span>
            </div>
          )}
        </div>

        {/* Scope strategy */}
        <div>
          <label className="text-xs text-muted-foreground">
            Scope Strategy
          </label>
          <div className="mt-1 flex gap-1">
            {SCOPE_STRATEGIES.map((s) => (
              <button
                key={s}
                onClick={() => setScopeStrategy(s)}
                className={`rounded px-2 py-1 text-[10px] transition-colors ${
                  scopeStrategy === s
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Max rounds */}
        <div>
          <label className="text-xs text-muted-foreground">Max Rounds</label>
          <input
            type="number"
            min={1}
            max={20}
            value={maxRounds}
            onChange={(e) => setMaxRounds(Number(e.target.value))}
            className="mt-1 w-20 rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
          />
        </div>

        {/* Budget */}
        <div>
          <label className="text-xs text-muted-foreground">
            Budget (minutes)
          </label>
          <input
            type="number"
            min={5}
            max={120}
            value={budgetMinutes}
            onChange={(e) => setBudgetMinutes(Number(e.target.value))}
            className="mt-1 w-20 rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
          />
        </div>
      </div>

      {/* Metric */}
      <div>
        <label className="text-xs text-muted-foreground">
          Metric (shell cmd, exits 0 = pass)
        </label>
        <input
          type="text"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          placeholder='e.g. npm test -- --grep "auth"'
          className="mt-1 w-full rounded border border-border bg-transparent px-3 py-2 text-xs font-mono outline-none focus:border-accent-foreground"
        />
      </div>

      {/* Scope */}
      <div>
        <label className="text-xs text-muted-foreground">
          Scope (file paths, one per line)
        </label>
        <textarea
          value={scopeText}
          onChange={(e) => setScopeText(e.target.value)}
          placeholder={"lib/auth/\nsrc/components/login/"}
          rows={3}
          className="mt-1 w-full rounded border border-border bg-transparent px-3 py-2 text-xs font-mono outline-none focus:border-accent-foreground resize-none"
        />
      </div>

      {/* Result feedback */}
      {result && (
        <div
          className={`rounded px-3 py-2 text-xs ${
            result.ok
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          }`}
        >
          {result.message}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!title.trim() || submitting}
        className="rounded bg-accent-foreground px-4 py-2 text-sm text-accent disabled:opacity-50 transition-colors hover:opacity-90"
      >
        {submitting ? "Dispatching..." : "Dispatch Collab Task"}
      </button>
    </div>
  );
}
