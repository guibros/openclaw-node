"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Brain } from "lucide-react";

interface ReflectionRow {
  id: number; node_id: string; soul_id: string; telemetry_count: number;
  pending: boolean; created_at: string;
}
interface ProposalRow {
  id: number; title: string; proposal_type: string; status: string;
  domain: string | null; reviewed_by: string | null; created_at: string;
  eval_telemetry_count: number | null;
}
interface Overview {
  available: boolean;
  telemetry: number;
  byClass: Record<string, number>;
  activeStrategies: number;
  reflections: { total: number; pendingSynthesis: number };
  proposalsByStatus: Record<string, number>;
  reflections_list: ReflectionRow[];
  proposals_list: ProposalRow[];
}
interface RunReport {
  available: boolean;
  run_id: string;
  totals: { rows: number; sessions: number; logicalTasks: number };
  byClass: Record<string, number>;
  cohort: {
    rows: number; logicalTasks: number;
    outcomes: Record<string, number>;
    byDomain: Record<string, number>;
    byMode: Record<string, number>;
    strategyCoverageRows: number;
  };
}

const STATUS_TEXT: Record<string, string> = {
  pending: "text-yellow-400", observation: "text-blue-400",
  approved: "text-green-400", rejected: "text-red-400", expired: "text-zinc-500",
};

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

function pairs(rec: Record<string, number>): string {
  const entries = Object.entries(rec);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join("  ") : "none";
}

export default function HyperagentPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runInput, setRunInput] = useState("");
  const [report, setReport] = useState<RunReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hyperagent");
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message || "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadReport = useCallback(async () => {
    if (!runInput.trim()) return;
    const res = await fetch(`/api/hyperagent/report?run=${encodeURIComponent(runInput.trim())}`);
    setReport(await res.json());
  }, [runInput]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-100">
          <Brain className="h-5 w-5" /> HyperAgent Evidence
        </h1>
        <button onClick={load} className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        Read-only evidence view. Approve/reject happens via CLI only:{" "}
        <code className="rounded bg-zinc-800 px-1">hyperagent approve &lt;id&gt;</code> — this page
        deliberately has no action buttons.
      </p>

      {error ? <div className="text-sm text-red-400">{error}</div> : null}
      {data && !data.available ? (
        <div className="text-sm text-zinc-400">No HyperAgent data yet (state.db absent or tables not created).</div>
      ) : null}

      {data?.available ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Telemetry rows" value={data.telemetry} hint={pairs(data.byClass)} />
            <Card label="Active strategies" value={data.activeStrategies} />
            <Card label="Reflections" value={data.reflections.total}
              hint={data.reflections.pendingSynthesis > 0 ? `${data.reflections.pendingSynthesis} await synthesis (24h window)` : "none pending"} />
            <Card label="Proposals" value={Object.values(data.proposalsByStatus).reduce((a, b) => a + b, 0)}
              hint={pairs(data.proposalsByStatus)} />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">Telemetry by execution class</h2>
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(data.byClass).map(([cls, n]) => (
                  <tr key={cls} className="border-t border-zinc-800">
                    <td className="py-1.5 text-zinc-300">{cls === "unknown" ? "unknown (cohort-ineligible)" : cls}</td>
                    <td className="py-1.5 text-right text-zinc-400">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">Reflections</h2>
            {data.reflections_list.length === 0 ? <div className="text-sm text-zinc-500">none yet</div> : (
              <table className="w-full text-sm">
                <tbody>
                  {data.reflections_list.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-800">
                      <td className="py-1.5 text-zinc-400">#{r.id}</td>
                      <td className="py-1.5 text-zinc-300">{r.node_id}/{r.soul_id}</td>
                      <td className="py-1.5 text-zinc-400">{r.telemetry_count} tasks</td>
                      <td className={`py-1.5 ${r.pending ? "text-yellow-400" : "text-zinc-500"}`}>
                        {r.pending ? "awaits synthesis — 24h window" : "synthesized"}
                      </td>
                      <td className="py-1.5 text-right text-zinc-500">{r.created_at?.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">Proposals</h2>
            {data.proposals_list.length === 0 ? <div className="text-sm text-zinc-500">none yet</div> : (
              <table className="w-full text-sm">
                <tbody>
                  {data.proposals_list.map((p) => (
                    <tr key={p.id} className="border-t border-zinc-800">
                      <td className="py-1.5 text-zinc-400">#{p.id}</td>
                      <td className="py-1.5 text-zinc-200">{p.title}</td>
                      <td className="py-1.5 text-zinc-400">{p.proposal_type}</td>
                      <td className={`py-1.5 ${STATUS_TEXT[p.status] || "text-zinc-400"}`}>{p.status}</td>
                      <td className="py-1.5 text-zinc-500">{p.domain || "-"}</td>
                      <td className="py-1.5 text-zinc-500">{p.reviewed_by ? `by ${p.reviewed_by}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-300">Run report</h2>
            <div className="flex gap-2">
              <input
                value={runInput}
                onChange={(e) => setRunInput(e.target.value)}
                placeholder="run_id"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200"
              />
              <button onClick={loadReport} className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800">
                Load
              </button>
            </div>
            {report ? (
              <div className="mt-3 space-y-1 text-sm text-zinc-300">
                <div>Rows {report.totals.rows} · sessions {report.totals.sessions} · logical tasks {report.totals.logicalTasks}</div>
                <div>By class: {pairs(report.byClass)}</div>
                <div>Cohort (real): {report.cohort.rows} rows / {report.cohort.logicalTasks} logical tasks</div>
                <div>Outcomes: {pairs(report.cohort.outcomes)}</div>
                <div>Domains: {pairs(report.cohort.byDomain)} · Modes: {pairs(report.cohort.byMode)}</div>
                <div>
                  Strategy coverage: {report.cohort.strategyCoverageRows}/{report.cohort.rows} rows{" "}
                  <span className="text-zinc-500">(coverage, not effectiveness)</span>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
