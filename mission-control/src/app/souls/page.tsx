"use client";

import { useEffect, useState } from "react";

interface Soul {
  id: string;
  type: string;
  specializations: string[];
  evolutionEnabled: boolean;
  parentSoul: string | null;
}

interface EvolutionEvent {
  id: number;
  soulId: string;
  eventId: string;
  eventType: string;
  description: string;
  reviewStatus: string;
  sourceSoulId?: string;
  sourceEventId?: string;
  timestamp: string;
  proposedChange?: {
    target: string;
    action: string;
    content?: any;
  };
}

function GuidePanel() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    structure: true,
  });

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Create a New Soul</h2>
        <p className="text-sm text-muted-foreground">
          Souls are specialist agents with their own identity, principles, and
          learned patterns. Follow these steps to create one.
        </p>
      </div>

      {/* Step 1: Directory Structure */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <button
          onClick={() => toggle("structure")}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              1
            </span>
            <span className="font-medium">Create directory structure</span>
          </div>
          <span className="text-muted-foreground text-sm">
            {expanded.structure ? "−" : "+"}
          </span>
        </button>
        {expanded.structure && (
          <div className="px-4 pb-4 border-t border-border pt-3">
            <pre className="text-xs bg-muted rounded p-3 overflow-auto">
{`mkdir -p ~/.openclaw/souls/my-soul/evolution

# Directory layout:
~/.openclaw/souls/my-soul/
├── SOUL.md              # Identity & voice
├── PRINCIPLES.md        # Decision heuristics
├── capabilities.json    # Tools, permissions, evolution config
└── evolution/
    ├── genes.json       # Learned patterns
    ├── events.jsonl     # Evolution event log
    └── capsules.json    # Knowledge snapshots`}
            </pre>
          </div>
        )}
      </div>

      {/* Step 2: SOUL.md */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <button
          onClick={() => toggle("soul")}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              2
            </span>
            <span className="font-medium">Write SOUL.md</span>
          </div>
          <span className="text-muted-foreground text-sm">
            {expanded.soul ? "−" : "+"}
          </span>
        </button>
        {expanded.soul && (
          <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
            <p className="text-sm text-muted-foreground">
              Define who the soul is — identity, expertise, workflow, boundaries.
            </p>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto">
{`# SOUL.md - My Soul Name

_One-line identity statement._

## Core Truths
**First principle.** Explanation.
**Second principle.** Explanation.

## Identity
I am a [role] specializing in [domain]. My expertise:
- Area 1
- Area 2

## Workflow
1. Step one
2. Step two

## Boundaries
- What I focus on
- What I don't do
- When I escalate to Daedalus`}
            </pre>
          </div>
        )}
      </div>

      {/* Step 3: PRINCIPLES.md */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <button
          onClick={() => toggle("principles")}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              3
            </span>
            <span className="font-medium">Write PRINCIPLES.md</span>
          </div>
          <span className="text-muted-foreground text-sm">
            {expanded.principles ? "−" : "+"}
          </span>
        </button>
        {expanded.principles && (
          <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
            <p className="text-sm text-muted-foreground">
              Decision heuristics — how the soul resolves ambiguity.
            </p>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto">
{`# PRINCIPLES.md — My Soul Decision Heuristics

## Priority Order (when principles conflict)
1. Most important value
2. Second priority
3. Third priority

## Core Principles
1. **Principle name** — explanation
2. **Principle name** — explanation`}
            </pre>
          </div>
        )}
      </div>

      {/* Step 4: capabilities.json */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <button
          onClick={() => toggle("caps")}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              4
            </span>
            <span className="font-medium">Write capabilities.json</span>
          </div>
          <span className="text-muted-foreground text-sm">
            {expanded.caps ? "−" : "+"}
          </span>
        </button>
        {expanded.caps && (
          <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
            <p className="text-sm text-muted-foreground">
              Tools, permissions, and evolution settings.
            </p>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto">
{`{
  "skills": ["skill-name"],
  "tools": ["Read", "Grep", "Glob", "WebSearch"],
  "mcpServers": [],
  "permissions": {
    "memory": {
      "shared": "read",
      "private": ["my-soul"],
      "handoffs": "read"
    },
    "restrictedActions": ["git push", "deployment commands"]
  },
  "evolutionConfig": {
    "captureTypes": ["pattern_type"],
    "reviewRequired": true,
    "autoApprove": false
  }
}`}
            </pre>
          </div>
        )}
      </div>

      {/* Step 5: Initialize evolution */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <button
          onClick={() => toggle("evolution")}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              5
            </span>
            <span className="font-medium">Initialize evolution files</span>
          </div>
          <span className="text-muted-foreground text-sm">
            {expanded.evolution ? "−" : "+"}
          </span>
        </button>
        {expanded.evolution && (
          <div className="px-4 pb-4 border-t border-border pt-3">
            <pre className="text-xs bg-muted rounded p-3 overflow-auto">
{`echo '{"version":"1.0.0","genes":[]}' > ~/.openclaw/souls/my-soul/evolution/genes.json
echo '{"version":"1.0.0","capsules":[]}' > ~/.openclaw/souls/my-soul/evolution/capsules.json
touch ~/.openclaw/souls/my-soul/evolution/events.jsonl`}
            </pre>
          </div>
        )}
      </div>

      {/* Step 6: Register */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <button
          onClick={() => toggle("register")}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              6
            </span>
            <span className="font-medium">Register via API</span>
          </div>
          <span className="text-muted-foreground text-sm">
            {expanded.register ? "−" : "+"}
          </span>
        </button>
        {expanded.register && (
          <div className="px-4 pb-4 border-t border-border pt-3">
            <pre className="text-xs bg-muted rounded p-3 overflow-auto">
{`curl -X POST http://localhost:3000/api/souls \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "my-soul",
    "type": "specialist",
    "basePath": "~/.openclaw/souls/my-soul",
    "capabilities": {
      "skills": ["skill-name"],
      "tools": ["Read", "Grep", "Glob"],
      "mcpServers": []
    },
    "specializations": ["domain1", "domain2"],
    "evolutionEnabled": true,
    "parentSoul": "main-agent"
  }'`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              The soul will appear in this sidebar after registration. Refresh
              the page to see it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SoulsPage() {
  const [souls, setSouls] = useState<Soul[]>([]);
  const [selectedSoul, setSelectedSoul] = useState<string | null>(null);
  const [events, setEvents] = useState<EvolutionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [propagating, setPropagating] = useState<string | null>(null);
  const [propagationTargets, setPropagationTargets] = useState<Soul[]>([]);

  useEffect(() => {
    fetch("/api/souls")
      .then((res) => res.json())
      .then((data) => {
        setSouls(data);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (selectedSoul) {
      setShowGuide(false);
      fetch(`/api/souls/${selectedSoul}/evolution?status=all`)
        .then((res) => res.json())
        .then((data) => setEvents(data));
    }
  }, [selectedSoul]);

  const handleReview = async (
    eventId: string,
    action: "approve" | "reject"
  ) => {
    const response = await fetch(
      `/api/souls/${selectedSoul}/evolution?eventId=${eventId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewedBy: "main-agent" }),
      }
    );

    if (response.ok) {
      const updated = await fetch(
        `/api/souls/${selectedSoul}/evolution?status=all`
      ).then((res) => res.json());
      setEvents(updated);

      // If approved, show propagation targets
      if (action === "approve") {
        const eligible = souls.filter((s) => s.id !== selectedSoul);
        if (eligible.length > 0) {
          setPropagating(eventId);
          setPropagationTargets(eligible);
        }
      }
    }
  };

  const handlePropagate = async (
    sourceEventId: string,
    targetSoulId: string
  ) => {
    const event = events.find((e) => e.eventId === sourceEventId);
    if (!event) return;

    const response = await fetch(
      `/api/souls/${selectedSoul}/propagate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEventId,
          targetSoulId,
        }),
      }
    );

    if (response.ok) {
      // Remove target from available list
      setPropagationTargets((prev) =>
        prev.filter((s) => s.id !== targetSoulId)
      );
    }
  };

  const dismissPropagation = () => {
    setPropagating(null);
    setPropagationTargets([]);
  };

  if (loading) {
    return <div className="p-8">Loading souls...</div>;
  }

  return (
    <div className="flex h-screen">
      {/* Soul list sidebar */}
      <div className="w-64 border-r border-border bg-card p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Souls</h2>
          <button
            onClick={() => {
              setShowGuide(!showGuide);
              setSelectedSoul(null);
            }}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              showGuide
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-muted-foreground hover:text-foreground"
            }`}
          >
            {showGuide ? "Close Guide" : "+ New"}
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {souls.map((soul) => (
            <button
              key={soul.id}
              onClick={() => setSelectedSoul(soul.id)}
              className={`w-full text-left p-3 rounded mb-2 transition-colors ${
                selectedSoul === soul.id
                  ? "bg-accent text-foreground"
                  : "hover:bg-accent/50"
              }`}
            >
              <div className="font-medium">{soul.id}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span>{soul.type}</span>
                {soul.specializations?.length > 0 && (
                  <>
                    <span className="opacity-40">|</span>
                    <span className="truncate">
                      {soul.specializations.slice(0, 2).join(", ")}
                    </span>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-8 overflow-auto">
        {showGuide ? (
          <GuidePanel />
        ) : !selectedSoul ? (
          <div className="text-muted-foreground">
            Select a soul to view evolution events, or click{" "}
            <button
              onClick={() => setShowGuide(true)}
              className="text-primary underline underline-offset-2"
            >
              + New
            </button>{" "}
            to create one.
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-semibold mb-6">
              Evolution Events: {selectedSoul}
            </h2>

            {events.length === 0 ? (
              <div className="text-muted-foreground">
                No evolution events yet
              </div>
            ) : (
              <div className="space-y-4">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="border border-border rounded-lg p-4 bg-card"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="font-semibold">
                          {event.description}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                          <span>
                            {event.eventType} &bull; {event.eventId}
                          </span>
                          {event.sourceSoulId && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-400">
                              Inherited from: {event.sourceSoulId}
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          event.reviewStatus === "pending"
                            ? "bg-yellow-500/20 text-yellow-500"
                            : event.reviewStatus === "approved"
                            ? "bg-green-500/20 text-green-500"
                            : "bg-red-500/20 text-red-500"
                        }`}
                      >
                        {event.reviewStatus}
                      </span>
                    </div>

                    {event.proposedChange && (
                      <div className="mt-3 p-3 bg-muted rounded text-sm">
                        <div className="font-medium mb-1">
                          Proposed Change:
                        </div>
                        <div>
                          {event.proposedChange.action} &rarr;{" "}
                          {event.proposedChange.target}
                        </div>
                        {event.proposedChange.content && (
                          <pre className="mt-2 text-xs overflow-auto">
                            {JSON.stringify(
                              event.proposedChange.content,
                              null,
                              2
                            )}
                          </pre>
                        )}
                      </div>
                    )}

                    {event.reviewStatus === "pending" && (
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={() =>
                            handleReview(event.eventId, "approve")
                          }
                          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() =>
                            handleReview(event.eventId, "reject")
                          }
                          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}

                    {/* Propagation controls — shown after approval */}
                    {propagating === event.eventId &&
                      propagationTargets.length > 0 && (
                        <div className="mt-4 p-3 rounded border border-blue-500/30 bg-blue-500/5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-blue-400">
                              Propagate to other souls?
                            </span>
                            <button
                              onClick={dismissPropagation}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Dismiss
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {propagationTargets.map((target) => (
                              <button
                                key={target.id}
                                onClick={() =>
                                  handlePropagate(event.eventId, target.id)
                                }
                                className="px-3 py-1.5 text-xs font-medium rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                              >
                                {target.id}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                    <div className="text-xs text-muted-foreground mt-3">
                      {new Date(event.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
