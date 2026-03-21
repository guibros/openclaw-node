"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Send,
} from "lucide-react";
import type { ClusterView } from "@/lib/hooks";
import { deleteCluster, removeClusterMember, updateClusterMember } from "@/lib/hooks";
import { RoleBadge, RolePicker } from "./role-picker";

interface ClusterCardProps {
  cluster: ClusterView;
  onDispatch: (clusterId: string) => void;
  onAddNode: (clusterId: string) => void;
}

export function ClusterCard({
  cluster,
  onDispatch,
  onAddNode,
}: ClusterCardProps) {
  const [expanded, setExpanded] = useState(false);

  const onlineCount = cluster.members.filter(
    (m) => m.nodeStatus === "online"
  ).length;

  const handleDelete = async () => {
    if (!confirm(`Archive cluster "${cluster.name}"?`)) return;
    await deleteCluster(cluster.id);
  };

  const handleRemoveMember = async (nodeId: string) => {
    if (!confirm(`Remove ${nodeId} from ${cluster.name}?`)) return;
    await removeClusterMember(cluster.id, nodeId);
  };

  const handleRoleChange = async (nodeId: string, role: string) => {
    await updateClusterMember(cluster.id, nodeId, role);
  };

  const statusDot: Record<string, string> = {
    online: "bg-green-400",
    degraded: "bg-yellow-400",
    offline: "bg-zinc-600",
    unknown: "bg-zinc-600",
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          {cluster.color && (
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: cluster.color }}
            />
          )}
          <span className="font-medium text-sm">{cluster.name}</span>
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
            {cluster.members.length} nodes
          </span>
          <span className="text-[10px] text-green-400">
            {onlineCount} online
          </span>
        </div>
      </div>

      {/* Members */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-2">
        {cluster.members.map((m) => (
          <span
            key={m.nodeId}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent/30 px-2 py-1 text-xs"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${statusDot[m.nodeStatus] ?? "bg-zinc-600"}`}
            />
            <span className="font-mono text-[11px]">
              {m.nodeId.split("-")[0]}
            </span>
            <RoleBadge role={m.role} />
          </span>
        ))}
      </div>

      {/* Defaults */}
      <div className="flex gap-3 px-4 pb-3 text-[10px] text-muted-foreground">
        <span>{cluster.defaultMode}</span>
        <span>{cluster.defaultConvergence}</span>
        <span>max {cluster.maxRounds} rounds</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-4 pb-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDispatch(cluster.id);
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
        >
          <Send className="h-3 w-3" />
          Assign Task
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddNode(cluster.id);
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add Node
        </button>
      </div>

      {/* Expanded: member management */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {cluster.description && (
            <p className="text-xs text-muted-foreground mb-3">
              {cluster.description}
            </p>
          )}
          {cluster.members.map((m) => (
            <div
              key={m.nodeId}
              className="flex items-center justify-between rounded bg-accent/20 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${statusDot[m.nodeStatus] ?? "bg-zinc-600"}`}
                />
                <span className="font-mono text-xs">{m.nodeId}</span>
              </div>
              <div className="flex items-center gap-2">
                <RolePicker
                  value={m.role}
                  onChange={(role) => handleRoleChange(m.nodeId, role)}
                />
                <button
                  onClick={() => handleRemoveMember(m.nodeId)}
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleDelete}
              className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
            >
              Archive cluster
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
