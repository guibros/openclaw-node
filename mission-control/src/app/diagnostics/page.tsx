"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, CheckCircle, XCircle, Play, AlertTriangle, Clock } from "lucide-react";

// ── Types ──

interface DiagnosticData {
  tasks: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    byType: Array<{ type: string; count: number }>;
    byKanban: Array<{ kanban_column: string; count: number }>;
  };
  memory: { docs: number; items: number; entities: number; relations: number };
  cowork: { clusters: number; members: number };
  sync: { exists: boolean; taskCount: number; roundTripOk: boolean; diffLines: number };
  nats: string;
  workspace: boolean;
}

interface TestResult {
  suite: string;
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
  durationMs: number;
}

interface TestReport {
  summary: { total: number; passed: number; failed: number; skipped: number; durationMs: number };
  results: TestResult[];
  timestamp: string;
}

// ── Helpers ──

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-red-400" />;
}

function StatRow({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/30">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono ${warn ? "text-yellow-400" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

// ── Tabs ──

type Tab = "health" | "tests" | "logs";

// ── Page ──

export default function DiagnosticsPage() {
  const [tab, setTab] = useState<Tab>("tests");
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [testReport, setTestReport] = useState<TestReport | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const [logs, setLogs] = useState<string[]>([]);

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("en-CA", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 500));
  }, []);

  // ── Health fetch ──

  const fetchHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    log("Fetching system health...");
    try {
      const res = await fetch("/api/diagnostics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      log(`Health OK — ${d.tasks.total} tasks, ${d.memory.docs} docs, NATS: ${d.nats}`);
    } catch (e) {
      const msg = (e as Error).message;
      setHealthError(msg);
      log(`Health FAIL: ${msg}`);
    } finally {
      setHealthLoading(false);
    }
  };

  // ── Test runner ──

  const runTests = async () => {
    setTestRunning(true);
    setTestError(null);
    setTestReport(null);
    log("Starting test suite...");
    try {
      const res = await fetch("/api/diagnostics/test-runner", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const report: TestReport = await res.json();
      setTestReport(report);
      const { passed, failed, total, durationMs } = report.summary;
      log(`Tests complete: ${passed}/${total} passed, ${failed} failed (${durationMs}ms)`);
      if (failed > 0) {
        for (const r of report.results.filter((r) => r.status === "fail")) {
          log(`  FAIL: [${r.suite}] ${r.name} — ${r.detail || "no detail"}`);
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      setTestError(msg);
      log(`Test runner error: ${msg}`);
    } finally {
      setTestRunning(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  // ── Group test results by suite ──
  const suites = testReport
    ? Array.from(
        testReport.results.reduce((map, r) => {
          if (!map.has(r.suite)) map.set(r.suite, []);
          map.get(r.suite)!.push(r);
          return map;
        }, new Map<string, TestResult[]>())
      )
    : [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">Diagnostics</h1>
          <p className="text-xs text-muted-foreground mt-0.5">System health, integration tests, and logs</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex rounded-lg bg-accent/50 p-0.5 mr-3">
            {(["tests", "health", "logs"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "tests" ? "Tests" : t === "health" ? "Health" : "Logs"}
              </button>
            ))}
          </div>
          <button
            onClick={runTests}
            disabled={testRunning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {testRunning ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {testRunning ? "Running..." : "Run All Tests"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {/* ═══ TESTS TAB ═══ */}
        {tab === "tests" && (
          <div className="space-y-4">
            {/* Summary bar */}
            {testReport && (
              <div className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${
                testReport.summary.failed === 0 ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
              }`}>
                {testReport.summary.failed === 0 ? (
                  <CheckCircle className="h-5 w-5 text-green-400" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-400" />
                )}
                <div className="flex-1">
                  <span className="text-sm font-semibold text-foreground">
                    {testReport.summary.failed === 0 ? "All Tests Passed" : `${testReport.summary.failed} Test${testReport.summary.failed > 1 ? "s" : ""} Failed`}
                  </span>
                  <span className="text-xs text-muted-foreground ml-3">
                    {testReport.summary.passed} passed, {testReport.summary.failed} failed, {testReport.summary.total} total
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {testReport.summary.durationMs}ms
                </div>
              </div>
            )}

            {testError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">
                Test runner error: {testError}
              </div>
            )}

            {!testReport && !testRunning && !testError && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Play className="h-8 w-8 opacity-30" />
                <p className="text-sm">Click "Run All Tests" to start the integration test suite</p>
                <p className="text-xs text-muted-foreground/60 max-w-md text-center">
                  Tests exercise: status mapping, task CRUD, done-gate enforcement, markdown parser round-trip,
                  DB sync, cowork clusters, memory/graph tables, schema integrity, NATS connectivity, and workspace health.
                </p>
              </div>
            )}

            {/* Results by suite */}
            {suites.map(([suite, tests]) => {
              const allPass = tests.every((t) => t.status === "pass");
              const failCount = tests.filter((t) => t.status === "fail").length;
              return (
                <div key={suite} className="rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
                    {allPass ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-400" />
                    )}
                    <span className="text-xs font-semibold text-foreground">{suite}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {tests.length - failCount}/{tests.length}
                    </span>
                  </div>
                  <div className="divide-y divide-border/30">
                    {tests.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 px-4 py-1.5">
                        {t.status === "pass" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
                        ) : t.status === "fail" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 shrink-0" />
                        )}
                        <span className={`text-xs flex-1 ${t.status === "fail" ? "text-red-400" : "text-foreground"}`}>
                          {t.name}
                        </span>
                        {t.detail && (
                          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                            {t.detail}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground/50 tabular-nums w-10 text-right shrink-0">
                          {t.durationMs}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ HEALTH TAB ═══ */}
        {tab === "health" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={fetchHealth}
                disabled={healthLoading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${healthLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            {healthError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">
                {healthError}
              </div>
            )}

            {data && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {/* System Status */}
                <div className="rounded-lg border border-border bg-card p-4">
                  <h2 className="text-sm font-semibold text-foreground mb-3">System Status</h2>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2"><StatusIcon ok={data.workspace} /><span className="text-xs">Workspace</span></div>
                    <div className="flex items-center gap-2"><StatusIcon ok={data.nats === "connected"} /><span className="text-xs">NATS: {data.nats}</span></div>
                    <div className="flex items-center gap-2"><StatusIcon ok={data.sync.exists} /><span className="text-xs">active-tasks.md: {data.sync.exists ? "found" : "missing"}</span></div>
                    <div className="flex items-center gap-2">
                      <StatusIcon ok={data.sync.roundTripOk} />
                      <span className="text-xs">
                        Parser round-trip: {data.sync.roundTripOk ? "OK" : "DRIFT"}
                        {data.sync.diffLines > 0 && ` (${data.sync.diffLines} line diff)`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tasks */}
                <div className="rounded-lg border border-border bg-card p-4">
                  <h2 className="text-sm font-semibold text-foreground mb-3">Tasks ({data.tasks.total})</h2>
                  <div className="mb-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">By Status</p>
                    {data.tasks.byStatus.map((s) => <StatRow key={s.status} label={s.status || "(empty)"} value={s.count} />)}
                  </div>
                  <div className="mb-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">By Kanban</p>
                    {data.tasks.byKanban.map((k) => <StatRow key={k.kanban_column} label={k.kanban_column || "(empty)"} value={k.count} />)}
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">By Type</p>
                    {data.tasks.byType.map((t) => <StatRow key={t.type} label={t.type || "task"} value={t.count} />)}
                  </div>
                </div>

                {/* Memory */}
                <div className="rounded-lg border border-border bg-card p-4">
                  <h2 className="text-sm font-semibold text-foreground mb-3">Memory</h2>
                  <StatRow label="Indexed docs" value={data.memory.docs} warn={data.memory.docs === 0} />
                  <StatRow label="Active items" value={data.memory.items} />
                  <StatRow label="Entities (graph)" value={data.memory.entities} warn={data.memory.entities === 0} />
                  <StatRow label="Active relations" value={data.memory.relations} />
                </div>

                {/* Cowork */}
                <div className="rounded-lg border border-border bg-card p-4">
                  <h2 className="text-sm font-semibold text-foreground mb-3">Cowork</h2>
                  <StatRow label="Active clusters" value={data.cowork.clusters} />
                  <StatRow label="Cluster members" value={data.cowork.members} />
                </div>

                {/* Sync */}
                <div className="rounded-lg border border-border bg-card p-4">
                  <h2 className="text-sm font-semibold text-foreground mb-3">Markdown Sync</h2>
                  <StatRow label="Tasks in markdown" value={data.sync.taskCount} />
                  <StatRow label="Round-trip" value={data.sync.roundTripOk ? "PASS" : "FAIL"} warn={!data.sync.roundTripOk} />
                  <StatRow label="Line diff" value={`${data.sync.diffLines}`} warn={data.sync.diffLines > 5} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ LOGS TAB ═══ */}
        {tab === "logs" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{logs.length} entries</span>
              <button
                onClick={() => setLogs([])}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="rounded-lg border border-border bg-[#0a0a0f] p-4 font-mono text-[11px] leading-5 max-h-[600px] overflow-y-auto">
              {logs.length === 0 ? (
                <span className="text-muted-foreground/50">No logs yet. Run tests or refresh health to see output.</span>
              ) : (
                logs.map((line, i) => (
                  <div key={i} className={`${
                    line.includes("FAIL") ? "text-red-400" :
                    line.includes("OK") || line.includes("passed") ? "text-green-400" :
                    "text-muted-foreground"
                  }`}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
