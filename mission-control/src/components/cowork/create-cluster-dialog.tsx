"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createCluster } from "@/lib/hooks";
import { RolePicker } from "./role-picker";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#64748b",
];

const MODES = ["parallel", "sequential", "review"] as const;
const CONVERGENCES = ["unanimous", "majority", "coordinator"] as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateClusterDialog({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [mode, setMode] = useState<string>("parallel");
  const [convergence, setConvergence] = useState<string>("unanimous");
  const [maxRounds, setMaxRounds] = useState(5);
  const [selectedNodes, setSelectedNodes] = useState<
    Array<{ nodeId: string; role: string }>
  >([]);
  const [saving, setSaving] = useState(false);

  const { data } = useSWR<{ nodes: Array<{ nodeId: string; status: string }> }>(
    "/api/mesh/nodes",
    fetcher
  );
  const meshNodes = data?.nodes ?? [];

  const toggleNode = (nodeId: string) => {
    setSelectedNodes((prev) => {
      const exists = prev.find((n) => n.nodeId === nodeId);
      if (exists) return prev.filter((n) => n.nodeId !== nodeId);
      return [...prev, { nodeId, role: "worker" }];
    });
  };

  const updateNodeRole = (nodeId: string, role: string) => {
    setSelectedNodes((prev) =>
      prev.map((n) => (n.nodeId === nodeId ? { ...n, role } : n))
    );
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCluster({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        defaultMode: mode,
        defaultConvergence: convergence,
        maxRounds,
        members: selectedNodes,
      });
      onClose();
      setName("");
      setDescription("");
      setSelectedNodes([]);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">New Cluster</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {/* Name */}
          <input
            type="text"
            placeholder="Cluster name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent-foreground"
          />

          {/* Description */}
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded border border-border bg-transparent px-3 py-2 text-xs outline-none focus:border-accent-foreground resize-none"
          />

          {/* Color */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12">Color</span>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full border-2 transition-colors ${
                    color === c ? "border-white" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Mode */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12">Mode</span>
            <div className="flex gap-1">
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12">Conv.</span>
            <div className="flex gap-1">
              {CONVERGENCES.map((c) => (
                <button
                  key={c}
                  onClick={() => setConvergence(c)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    convergence === c
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Max rounds */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12">Rounds</span>
            <input
              type="number"
              min={1}
              max={20}
              value={maxRounds}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
              className="w-16 rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
            />
          </div>

          {/* Node picker */}
          <div>
            <span className="text-xs text-muted-foreground">Nodes</span>
            <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
              {meshNodes.map((node) => {
                const selected = selectedNodes.find(
                  (n) => n.nodeId === node.nodeId
                );
                return (
                  <div
                    key={node.nodeId}
                    className={`flex items-center justify-between rounded px-3 py-2 text-xs cursor-pointer transition-colors ${
                      selected
                        ? "bg-accent/40 border border-accent-foreground/20"
                        : "bg-accent/10 hover:bg-accent/20"
                    }`}
                    onClick={() => toggleNode(node.nodeId)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          node.status === "online"
                            ? "bg-green-400"
                            : node.status === "degraded"
                              ? "bg-yellow-400"
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
                            updateNodeRole(node.nodeId, role)
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {meshNodes.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">
                  No mesh nodes available
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="rounded bg-accent-foreground px-3 py-1.5 text-xs text-accent disabled:opacity-50 transition-colors"
          >
            {saving ? "Creating..." : "Create Cluster"}
          </button>
        </div>
      </div>
    </div>
  );
}
