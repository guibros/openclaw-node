"use client";

import { useState, useMemo, useEffect } from "react";
import { useProjects, useBurndown, type BurndownData } from "@/lib/hooks";

const STATUS_COLORS: Record<string, string> = {
  queued: "#3b82f6",
  ready: "#60a5fa",
  running: "#22c55e",
  blocked: "#ef4444",
  "waiting-user": "#eab308",
  done: "#71717a",
  cancelled: "#52525b",
};

export default function BurndownPage() {
  const { projects } = useProjects();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // Auto-select first project
  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      setSelectedProject(projects[0].id);
    }
  }, [projects, selectedProject]);

  const { burndown } = useBurndown(selectedProject);

  const statusEntries = useMemo(() => {
    if (!burndown) return [];
    return Object.entries(burndown.counts).sort((a, b) => b[1] - a[1]);
  }, [burndown]);

  const maxTimelineValue = useMemo(() => {
    if (!burndown) return 0;
    return burndown.total;
  }, [burndown]);

  if (!burndown) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  const completedCount = (burndown.counts.done || 0) + (burndown.counts.cancelled || 0);
  const completionPct = burndown.total > 0 ? Math.round((completedCount / burndown.total) * 100) : 0;

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-foreground">Burndown</h1>
          <select
            value={selectedProject ?? ""}
            onChange={(e) => setSelectedProject(e.target.value || null)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All tasks</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Total Tasks" value={burndown.total} />
          <SummaryCard
            label="Completed"
            value={completedCount}
            sub={`${completionPct}%`}
            color="#22c55e"
          />
          <SummaryCard
            label="In Progress"
            value={burndown.counts.running || 0}
            color="#3b82f6"
          />
          <SummaryCard
            label="Blocked"
            value={burndown.counts.blocked || 0}
            color="#ef4444"
          />
        </div>

        {/* Overall progress bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              Overall Progress
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {completedCount} / {burndown.total} ({completionPct}%)
            </span>
          </div>
          <div className="h-4 bg-accent rounded-full overflow-hidden flex">
            {statusEntries.map(([status, count]) => {
              const pct = (count / burndown.total) * 100;
              if (pct < 0.5) return null;
              return (
                <div
                  key={status}
                  className="h-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: STATUS_COLORS[status] || "#6b7280",
                  }}
                  title={`${status}: ${count} (${Math.round(pct)}%)`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {statusEntries.map(([status, count]) => (
              <div key={status} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{
                    backgroundColor: STATUS_COLORS[status] || "#6b7280",
                  }}
                />
                <span className="text-[11px] text-muted-foreground">
                  {status}: {count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Burndown chart (SVG) */}
        {burndown.timeline.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">
              Burndown Over Time
            </h2>
            <BurndownChart data={burndown} />
          </div>
        )}

        {burndown.timeline.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No completion data yet. Tasks will appear here as they get done.
          </div>
        )}

        {/* Date range */}
        {burndown.startDate && burndown.endDate && (
          <div className="text-xs text-muted-foreground">
            Project range: {burndown.startDate} — {burndown.endDate}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: color || "var(--foreground)" }}
        >
          {value}
        </span>
        {sub && (
          <span className="text-sm text-muted-foreground">{sub}</span>
        )}
      </div>
    </div>
  );
}

function BurndownChart({ data }: { data: BurndownData }) {
  const W = 800;
  const H = 300;
  const PAD = { top: 20, right: 20, bottom: 40, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxVal = data.total;
  const points = data.timeline;
  if (points.length === 0 || maxVal === 0) return null;

  // X: evenly spaced by index, Y: remaining
  const xStep = plotW / Math.max(points.length - 1, 1);
  const yScale = (v: number) => PAD.top + plotH - (v / maxVal) * plotH;

  // Remaining line
  const remainingPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${PAD.left + i * xStep} ${yScale(p.remaining)}`)
    .join(" ");

  // Done line
  const donePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${PAD.left + i * xStep} ${yScale(p.done)}`)
    .join(" ");

  // Ideal line (straight from total to 0)
  const idealStart = `${PAD.left} ${yScale(maxVal)}`;
  const idealEnd = `${PAD.left + plotW} ${yScale(0)}`;

  // Y-axis ticks
  const yTicks = [0, Math.round(maxVal / 4), Math.round(maxVal / 2), Math.round((maxVal * 3) / 4), maxVal];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[800px] h-auto">
      {/* Grid lines */}
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            y1={yScale(v)}
            x2={PAD.left + plotW}
            y2={yScale(v)}
            stroke="currentColor"
            strokeOpacity={0.1}
          />
          <text
            x={PAD.left - 8}
            y={yScale(v) + 4}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {v}
          </text>
        </g>
      ))}

      {/* Ideal burndown line */}
      <line
        x1={PAD.left}
        y1={yScale(maxVal)}
        x2={PAD.left + plotW}
        y2={yScale(0)}
        stroke="#6b7280"
        strokeWidth={1}
        strokeDasharray="6 4"
        opacity={0.4}
      />

      {/* Remaining line (main burndown) */}
      <path d={remainingPath} fill="none" stroke="#ef4444" strokeWidth={2} />

      {/* Done line */}
      <path d={donePath} fill="none" stroke="#22c55e" strokeWidth={2} />

      {/* X-axis date labels (first, middle, last) */}
      {[...new Set([0, Math.floor(points.length / 2), points.length - 1])].map((i) => {
        if (i >= points.length) return null;
        return (
          <text
            key={i}
            x={PAD.left + i * xStep}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {points[i].date}
          </text>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${PAD.left + 10}, ${PAD.top + 10})`}>
        <line x1={0} y1={0} x2={16} y2={0} stroke="#ef4444" strokeWidth={2} />
        <text x={20} y={4} fontSize={10} className="fill-foreground">
          Remaining
        </text>
        <line x1={0} y1={16} x2={16} y2={16} stroke="#22c55e" strokeWidth={2} />
        <text x={20} y={20} fontSize={10} className="fill-foreground">
          Completed
        </text>
        <line
          x1={0}
          y1={32}
          x2={16}
          y2={32}
          stroke="#6b7280"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
        <text x={20} y={36} fontSize={10} className="fill-muted-foreground">
          Ideal
        </text>
      </g>
    </svg>
  );
}
