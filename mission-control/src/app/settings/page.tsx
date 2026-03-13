"use client";

import { useEffect, useState } from "react";
import { Settings, RefreshCw, Check, AlertCircle } from "lucide-react";

interface GatewaySettings {
  heartbeat: { target: string; every?: string };
  model: { primary?: string; fallbacks?: string[] };
  compaction: { mode?: string };
  maxConcurrent: number;
  gateway: { port: number; mode: string; bind: string };
}

const HEARTBEAT_TARGETS = [
  { value: "none", label: "Disabled", description: "No heartbeat polling. Zero token burn." },
  { value: "first", label: "Primary only", description: "Only pings the primary model provider." },
  { value: "last", label: "All providers", description: "Pings through the full fallback chain. Highest token usage." },
];

const HEARTBEAT_INTERVALS = [
  { value: "", label: "Default (30m)" },
  { value: "1h", label: "Every 1h" },
  { value: "2h", label: "Every 2h" },
  { value: "6h", label: "Every 6h" },
  { value: "12h", label: "Every 12h" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft state for edits
  const [heartbeatTarget, setHeartbeatTarget] = useState("none");
  const [heartbeatEvery, setHeartbeatEvery] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState(4);

  useEffect(() => {
    fetch("/api/settings/gateway")
      .then((r) => r.json())
      .then((data: GatewaySettings) => {
        setSettings(data);
        setHeartbeatTarget(data.heartbeat?.target || "none");
        setHeartbeatEvery(data.heartbeat?.every || "");
        setMaxConcurrent(data.maxConcurrent ?? 4);
      })
      .catch(() => setError("Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  const isDirty =
    settings &&
    (heartbeatTarget !== (settings.heartbeat?.target || "none") ||
      heartbeatEvery !== (settings.heartbeat?.every || "") ||
      maxConcurrent !== (settings.maxConcurrent ?? 4));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const body: Record<string, any> = {
        heartbeat: { target: heartbeatTarget },
        maxConcurrent,
      };
      if (heartbeatEvery && heartbeatTarget !== "none") {
        body.heartbeat.every = heartbeatEvery;
      }

      const res = await fetch("/api/settings/gateway", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Save failed");

      // Refresh
      const fresh = await fetch("/api/settings/gateway").then((r) => r.json());
      setSettings(fresh);
      setHeartbeatTarget(fresh.heartbeat?.target || "none");
      setHeartbeatEvery(fresh.heartbeat?.every || "");
      setMaxConcurrent(fresh.maxConcurrent ?? 4);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="h-3 w-3" /> {error}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving && <RefreshCw className="h-3 w-3 animate-spin" />}
            Save Changes
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-2xl">
        {/* Heartbeat Section */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Heartbeat
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            The gateway periodically pings model providers to check availability.
            Each ping sends the full system prompt and burns tokens.
          </p>

          <div className="space-y-3">
            {HEARTBEAT_TARGETS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  heartbeatTarget === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border/80 hover:bg-accent/30"
                }`}
              >
                <input
                  type="radio"
                  name="heartbeat-target"
                  value={opt.value}
                  checked={heartbeatTarget === opt.value}
                  onChange={(e) => setHeartbeatTarget(e.target.value)}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>

          {heartbeatTarget !== "none" && (
            <div className="mt-4">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Interval
              </label>
              <select
                value={heartbeatEvery}
                onChange={(e) => setHeartbeatEvery(e.target.value)}
                className="w-48 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {HEARTBEAT_INTERVALS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {/* Agent Concurrency */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Agent Concurrency
          </h2>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Max concurrent agents
            </label>
            <input
              type="number"
              min={1}
              max={16}
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(parseInt(e.target.value) || 1)}
              className="w-24 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Maximum number of concurrent agent sessions the gateway will run.
            </p>
          </div>
        </section>

        {/* Current Config (read-only info) */}
        {settings && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              Gateway Info
            </h2>
            <div className="rounded-lg border border-border bg-card p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Port</span>
                <span className="font-mono">{settings.gateway.port}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode</span>
                <span className="font-mono">{settings.gateway.mode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bind</span>
                <span className="font-mono">{settings.gateway.bind}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Primary model</span>
                <span className="font-mono text-xs">{settings.model.primary || "—"}</span>
              </div>
              {settings.model.fallbacks && settings.model.fallbacks.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Fallbacks</span>
                  <div className="mt-1 space-y-0.5">
                    {settings.model.fallbacks.map((f, i) => (
                      <div key={i} className="text-xs font-mono text-muted-foreground pl-4">
                        {i + 1}. {f}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Compaction</span>
                <span className="font-mono">{settings.compaction.mode || "default"}</span>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Restart the gateway after saving for changes to take effect.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
