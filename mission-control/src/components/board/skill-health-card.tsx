"use client";

import { useEffect, useState } from "react";
import { Shield, AlertTriangle, CheckCircle2 } from "lucide-react";

interface SkillAuditData {
  total_skills: number;
  average_score: number;
  grade_distribution: Record<string, number>;
  skills: Array<{
    name: string;
    score: number;
    grade: string;
  }>;
}

const GRADE_COLORS: Record<string, string> = {
  A: "bg-emerald-500/20 text-emerald-400",
  B: "bg-cyan-500/20 text-cyan-400",
  C: "bg-yellow-500/20 text-yellow-400",
  D: "bg-red-500/20 text-red-400",
  F: "bg-red-700/20 text-red-500",
};

export function SkillHealthCard() {
  const [data, setData] = useState<SkillAuditData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/skills/list")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">Skill audit unavailable</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 animate-pulse">
        <div className="h-4 bg-muted rounded w-32 mb-2" />
        <div className="h-8 bg-muted rounded w-20" />
      </div>
    );
  }

  const { total_skills, average_score, grade_distribution } = data;
  const regressions = data.skills.filter(
    (s) => s.grade === "D" || s.grade === "F"
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Skill Health
          </span>
        </div>
        <span className="text-2xl font-bold text-foreground">
          {Math.round(average_score)}
          <span className="text-sm font-normal text-muted-foreground">
            /100
          </span>
        </span>
      </div>

      {/* Grade distribution pills */}
      <div className="flex items-center gap-1.5">
        {(["A", "B", "C", "D", "F"] as const).map((g) => {
          const count = grade_distribution[g] || 0;
          if (!count) return null;
          return (
            <span
              key={g}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${GRADE_COLORS[g]}`}
            >
              {g}: {count}
            </span>
          );
        })}
        <span className="text-xs text-muted-foreground ml-auto">
          {total_skills} skills
        </span>
      </div>

      {/* Regression highlights */}
      {regressions.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="text-xs text-red-400 font-medium mb-1">
            Needs attention:
          </p>
          {regressions.slice(0, 3).map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <AlertTriangle className="h-3 w-3 text-red-400" />
              <span>
                {s.name} ({s.grade}, {s.score}/100)
              </span>
            </div>
          ))}
        </div>
      )}

      {regressions.length === 0 && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>All skills healthy</span>
        </div>
      )}
    </div>
  );
}
