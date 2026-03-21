"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { useClusters } from "@/lib/hooks";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type ExecutionMode = "local" | "mesh" | "collab";

export interface ExecutionFields {
  execution: string | null;
  collaboration: Record<string, unknown> | null;
  preferred_nodes: string[];
  exclude_nodes: string[];
  cluster_id: string | null;
  metric: string | null;
  budget_minutes: number;
  scope: string[];
  needs_approval: boolean;
}

interface ExecutionConfigProps {
  value: ExecutionFields;
  onChange: (fields: ExecutionFields) => void;
  disabled?: boolean; // true when task has meshTaskId (already submitted)
}

const MODES: { value: ExecutionMode; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "mesh", label: "Mesh" },
  { value: "collab", label: "Collab" },
];

const COLLAB_MODES = ["parallel", "sequential", "review"] as const;
const CONVERGENCE_TYPES = ["unanimous", "majority", "coordinator"] as const;
const SCOPE_STRATEGIES = ["shared", "leader_only", "partitioned"] as const;

export function ExecutionConfig({ value, onChange, disabled }: ExecutionConfigProps) {
  const mode: ExecutionMode =
    value.execution === "mesh"
      ? value.collaboration
        ? "collab"
        : "mesh"
      : "local";

  // Collab settings (parsed from collaboration JSON)
  const collab = (value.collaboration ?? {}) as Record<string, unknown>;
  const conv = (collab.convergence ?? {}) as Record<string, unknown>;

  const [collabMode, setCollabMode] = useState<string>((collab.mode as string) || "parallel");
  const [convergenceType, setConvergenceType] = useState<string>((conv.type as string) || "unanimous");
  const [convergenceThreshold, setConvergenceThreshold] = useState<number>(
    typeof conv.threshold === "number" ? conv.threshold * 100 : 66
  );
  const [maxRounds, setMaxRounds] = useState<number>((collab.max_rounds as number) || 5);
  const [scopeStrategy, setScopeStrategy] = useState<string>((collab.scope_strategy as string) || "shared");

  // Mesh settings
  const [metric, setMetric] = useState(value.metric || "");
  const [budgetMinutes, setBudgetMinutes] = useState(value.budget_minutes || 30);
  const [scopeText, setScopeText] = useState((value.scope || []).join("\n"));
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(
    new Set(value.preferred_nodes || [])
  );
  const [clusterId, setClusterId] = useState(value.cluster_id || "");

  // Available nodes
  const { data: nodesData } = useSWR<{ nodes: Array<{ node_id: string; status: string }> }>(
    mode !== "local" ? "/api/mesh/nodes" : null,
    fetcher,
    { refreshInterval: 10000 }
  );
  const nodes = nodesData?.nodes ?? [];

  // Clusters (for collab mode)
  const { clusters } = useClusters();

  // Sync internal state back to parent
  useEffect(() => {
    // Don't fire onChange during disabled state
    if (disabled) return;

    const scopeArr = scopeText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (mode === "local") {
      onChange({
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
    } else if (mode === "mesh") {
      onChange({
        execution: "mesh",
        collaboration: null,
        preferred_nodes: Array.from(selectedNodes),
        exclude_nodes: [],
        cluster_id: null,
        metric: metric || null,
        budget_minutes: budgetMinutes,
        scope: scopeArr,
        needs_approval: false,
      });
    } else {
      // collab
      const nodeIds = Array.from(selectedNodes);
      onChange({
        execution: "mesh",
        collaboration: {
          mode: collabMode,
          min_nodes: Math.min(nodeIds.length || 2, 2),
          max_nodes: nodeIds.length || 4,
          join_window_s: 30,
          max_rounds: maxRounds,
          convergence: {
            type: convergenceType,
            threshold: convergenceThreshold / 100,
            metric: null,
            min_quorum: Math.min(nodeIds.length || 2, 2),
          },
          scope_strategy: scopeStrategy,
        },
        preferred_nodes: nodeIds,
        exclude_nodes: [],
        cluster_id: clusterId || null,
        metric: metric || null,
        budget_minutes: budgetMinutes,
        scope: scopeArr,
        needs_approval: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    collabMode,
    convergenceType,
    convergenceThreshold,
    maxRounds,
    scopeStrategy,
    metric,
    budgetMinutes,
    scopeText,
    selectedNodes,
    clusterId,
    disabled,
  ]);

  const setMode = (m: ExecutionMode) => {
    if (disabled) return;
    if (m === "local") {
      onChange({
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
    } else if (m === "mesh") {
      onChange({
        execution: "mesh",
        collaboration: null,
        preferred_nodes: Array.from(selectedNodes),
        exclude_nodes: [],
        cluster_id: null,
        metric: metric || null,
        budget_minutes: budgetMinutes,
        scope: scopeText.split("\n").map((s) => s.trim()).filter(Boolean),
        needs_approval: false,
      });
    } else {
      // Set collab — trigger the useEffect to build collaboration spec
      onChange({
        execution: "mesh",
        collaboration: { mode: collabMode }, // placeholder, useEffect rebuilds
        preferred_nodes: Array.from(selectedNodes),
        exclude_nodes: [],
        cluster_id: clusterId || null,
        metric: metric || null,
        budget_minutes: budgetMinutes,
        scope: scopeText.split("\n").map((s) => s.trim()).filter(Boolean),
        needs_approval: false,
      });
    }
  };

  const toggleNode = (nodeId: string) => {
    setSelectedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const inputCls =
    "w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
  const btnCls = (active: boolean) =>
    `px-2.5 py-1 text-[10px] rounded-md border transition-colors ${
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="flex gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            disabled={disabled}
            className={btnCls(mode === m.value)}
          >
            {m.label}
          </button>
        ))}
        {disabled && (
          <span className="text-[10px] text-amber-400 self-center ml-auto">
            Locked (submitted)
          </span>
        )}
      </div>

      {mode !== "local" && (
        <>
          {/* Collab-specific settings */}
          {mode === "collab" && (
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                  Collab Mode
                </label>
                <div className="flex gap-1.5">
                  {COLLAB_MODES.map((cm) => (
                    <button
                      key={cm}
                      type="button"
                      onClick={() => setCollabMode(cm)}
                      className={btnCls(collabMode === cm)}
                    >
                      {cm}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                  Convergence
                </label>
                <div className="flex gap-1.5">
                  {CONVERGENCE_TYPES.map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => setConvergenceType(ct)}
                      className={btnCls(convergenceType === ct)}
                    >
                      {ct}
                    </button>
                  ))}
                </div>
              </div>

              {convergenceType === "majority" && (
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                    Threshold: {convergenceThreshold}%
                  </label>
                  <input
                    type="range"
                    min={51}
                    max={100}
                    value={convergenceThreshold}
                    onChange={(e) => setConvergenceThreshold(parseInt(e.target.value, 10))}
                    className="w-full"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                    Max Rounds
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={maxRounds}
                    onChange={(e) => setMaxRounds(parseInt(e.target.value, 10) || 5)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                    Scope Strategy
                  </label>
                  <select
                    value={scopeStrategy}
                    onChange={(e) => setScopeStrategy(e.target.value)}
                    className={inputCls}
                  >
                    {SCOPE_STRATEGIES.map((ss) => (
                      <option key={ss} value={ss}>
                        {ss}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cluster selector */}
              {clusters.length > 0 && (
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                    Cluster
                  </label>
                  <select
                    value={clusterId}
                    onChange={(e) => {
                      setClusterId(e.target.value);
                      if (e.target.value) {
                        const cluster = clusters.find((c) => c.id === e.target.value);
                        if (cluster) {
                          const memberIds = cluster.members.map((m) => m.nodeId);
                          setSelectedNodes(new Set(memberIds));
                        }
                      }
                    }}
                    className={inputCls}
                  >
                    <option value="">No cluster (manual nodes)</option>
                    {clusters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.members.length} nodes)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Shared mesh settings */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                Metric
              </label>
              <input
                type="text"
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                placeholder="e.g., test pass rate"
                className={`${inputCls} font-mono`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                Budget (min)
              </label>
              <input
                type="number"
                min={5}
                max={480}
                value={budgetMinutes}
                onChange={(e) => setBudgetMinutes(parseInt(e.target.value, 10) || 30)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-1">
              Scope (file paths, one per line)
            </label>
            <textarea
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              rows={2}
              className={`${inputCls} font-mono resize-none`}
              placeholder="src/lib/&#10;tests/"
            />
          </div>

          {/* Node selection */}
          {nodes.length > 0 && (
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                Nodes ({selectedNodes.size} selected)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {nodes.map((n) => (
                  <button
                    key={n.node_id}
                    type="button"
                    onClick={() => toggleNode(n.node_id)}
                    className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                      selectedNodes.has(n.node_id)
                        ? "border-cyan-500 bg-cyan-500/15 text-cyan-400"
                        : "border-border text-muted-foreground hover:text-foreground"
                    } ${n.status !== "idle" ? "opacity-50" : ""}`}
                  >
                    {n.node_id.slice(0, 12)}
                    {n.status !== "idle" && ` (${n.status})`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
