"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Zap,
  XCircle,
  UserMinus,
} from "lucide-react";
import type { CollabSession, Task } from "@/lib/hooks";
import { interveneSession } from "@/lib/hooks";
import { RoleBadge } from "./role-picker";

const STATUS_COLORS: Record<string, string> = {
  recruiting: "bg-blue-400",
  active: "bg-green-400 animate-pulse",
  converged: "bg-indigo-400",
  completed: "bg-zinc-500",
  aborted: "bg-red-500",
};

const MODE_BADGE: Record<string, string> = {
  parallel: "bg-cyan-400/10 text-cyan-400",
  sequential: "bg-amber-400/10 text-amber-400",
  review: "bg-purple-400/10 text-purple-400",
};

function NodeChip({
  node,
  sessionId,
  isActive,
}: {
  node: CollabSession["nodes"][0];
  sessionId: string;
  isActive: boolean;
}) {
  const statusDot: Record<string, string> = {
    recruited: "bg-blue-400",
    active: "bg-green-400 animate-pulse",
    idle: "bg-zinc-500",
    dead: "bg-red-500",
  };

  const handleRemove = async () => {
    if (!confirm(`Remove ${node.node_id} from session?`)) return;
    await interveneSession({
      action: "remove_node",
      sessionId,
      nodeId: node.node_id,
    });
  };

  return (
    <span className="group inline-flex items-center gap-1.5 rounded-md bg-card border border-border px-2 py-1 text-xs">
      <span
        className={`h-1.5 w-1.5 rounded-full ${statusDot[node.status] ?? "bg-zinc-600"}`}
      />
      <span className="font-mono text-[11px]">
        {node.node_id.split("-")[0]}
      </span>
      <RoleBadge role={node.role} />
      {isActive && node.status !== "dead" && (
        <button
          onClick={handleRemove}
          className="hidden group-hover:inline-flex text-muted-foreground hover:text-red-400"
          title="Remove node"
        >
          <UserMinus className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

const KANBAN_STATUS_CHIP: Record<string, string> = {
  backlog: "bg-blue-500/15 text-blue-400",
  in_progress: "bg-green-500/15 text-green-400",
  review: "bg-yellow-500/15 text-yellow-400",
  done: "bg-zinc-500/15 text-zinc-400",
};

export function SessionCard({ session, linkedTask }: { session: CollabSession; linkedTask?: Task | null }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = ["recruiting", "active"].includes(session.status);

  const currentRound = session.rounds?.[session.rounds.length - 1];
  const reflectionCount = currentRound?.reflections?.length ?? 0;
  const activeNodes = (session.nodes || []).filter(
    (n) => n.status !== "dead"
  ).length;

  const handleAbort = async () => {
    if (!confirm("Abort this session? The parent task will be cancelled."))
      return;
    await interveneSession({ action: "abort", sessionId: session.session_id });
  };

  const handleForceConverge = async () => {
    if (
      !confirm(
        "Force convergence? Missing reflections will be filled synthetically."
      )
    )
      return;
    await interveneSession({
      action: "force_converge",
      sessionId: session.session_id,
    });
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
          <span
            className={`h-2 w-2 rounded-full ${STATUS_COLORS[session.status] ?? "bg-zinc-600"}`}
          />
          <a
            href={`/?task=${session.task_id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-sm hover:text-cyan-400 underline underline-offset-2 decoration-dotted"
          >
            {session.task_id}
          </a>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${MODE_BADGE[session.mode] ?? "bg-zinc-700 text-zinc-300"}`}
          >
            {session.mode}
          </span>
          <span className="text-[10px] text-muted-foreground uppercase">
            {session.status}
          </span>
          {linkedTask && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${KANBAN_STATUS_CHIP[linkedTask.kanbanColumn] ?? "bg-zinc-700 text-zinc-300"}`}>
              {linkedTask.kanbanColumn === "in_progress" ? "In Progress" : linkedTask.kanbanColumn}
            </span>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex items-center gap-4 px-4 pb-3 text-xs text-muted-foreground">
        <span>
          Round {session.current_round}/{session.max_rounds}
        </span>
        <span>
          Nodes: {activeNodes}/{(session.nodes || []).length}
        </span>
        {currentRound && (
          <span>
            Reflections: {reflectionCount}/{activeNodes}
          </span>
        )}
        <span className="capitalize">{session.convergence?.type}</span>
      </div>

      {/* Round progress bar */}
      <div className="flex gap-1 px-4 pb-3">
        {Array.from({ length: session.max_rounds }, (_, i) => {
          const roundNum = i + 1;
          const round = session.rounds?.find(
            (r) => r.round_number === roundNum
          );
          let color = "bg-zinc-700";
          if (round?.completed_at) color = "bg-green-500";
          else if (round && !round.completed_at)
            color = "bg-blue-500 animate-pulse";
          return (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${color}`}
              title={`Round ${roundNum}`}
            />
          );
        })}
      </div>

      {/* Nodes */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {(session.nodes || []).map((node) => (
          <NodeChip
            key={node.node_id}
            node={node}
            sessionId={session.session_id}
            isActive={isActive}
          />
        ))}
      </div>

      {/* Intervention buttons */}
      {isActive && (
        <div className="flex gap-2 px-4 pb-3">
          <button
            onClick={handleForceConverge}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors"
          >
            <Zap className="h-3 w-3" />
            Force Converge
          </button>
          <button
            onClick={handleAbort}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <XCircle className="h-3 w-3" />
            Abort
          </button>
        </div>
      )}

      {/* Expanded: round history */}
      {expanded && session.rounds && session.rounds.length > 0 && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {session.rounds.map((round) => (
            <div key={round.round_number} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">R{round.round_number}</span>
                <span className="text-muted-foreground">
                  {round.completed_at ? "completed" : "in progress"}
                </span>
                <span className="text-muted-foreground">
                  {round.reflections?.length ?? 0} reflections
                </span>
              </div>
              {round.reflections?.map((ref) => (
                <div
                  key={`${ref.node_id}-${round.round_number}`}
                  className="ml-4 rounded bg-accent/30 px-3 py-2 text-xs space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px]">
                      {ref.node_id.split("-")[0]}
                    </span>
                    <span
                      className={`rounded px-1 py-0.5 text-[9px] ${
                        ref.vote === "converged"
                          ? "bg-green-500/10 text-green-400"
                          : ref.vote === "blocked"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-zinc-700 text-zinc-300"
                      }`}
                    >
                      {ref.vote}
                    </span>
                    <span className="text-muted-foreground">
                      {Math.round(ref.confidence * 100)}%
                    </span>
                    {ref.synthetic && (
                      <span className="text-[9px] text-yellow-500">
                        synthetic
                      </span>
                    )}
                  </div>
                  {ref.summary && (
                    <p className="text-muted-foreground line-clamp-2">
                      {ref.summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* Timestamps */}
          <div className="pt-2 border-t border-border/50 text-[10px] text-muted-foreground flex gap-4">
            <span>Started: {session.created_at?.slice(0, 19)}</span>
            {session.completed_at && (
              <span>Completed: {session.completed_at.slice(0, 19)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
