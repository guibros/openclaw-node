"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Search, RefreshCw, Users, Users2, Calendar, GitBranch, BarChart3, MessageCircle, Network, Waypoints, Settings, Server, Activity } from "lucide-react";
import { useState } from "react";
import { LiveStream } from "@/components/board/live-stream";

const NAV = [
  { href: "/", label: "Task Board", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/roadmap", label: "Roadmap", icon: GitBranch },
  { href: "/burndown", label: "Burndown", icon: BarChart3 },
  { href: "/memory", label: "Memory Search", icon: Search },
  { href: "/souls", label: "Soul Evolution", icon: Users },
  { href: "/live", label: "Live Chat", icon: MessageCircle },
  { href: "/graph", label: "Knowledge Graph", icon: Network },
  { href: "/obsidian", label: "Obsidian View", icon: Waypoints },
  { href: "/mesh", label: "Mesh Nodes", icon: Server },
  { href: "/cowork", label: "Cowork", icon: Users2 },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/diagnostics", label: "Diagnostics", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/memory/sync", { method: "POST" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <aside className="flex h-full flex-col bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
        <span className="text-sm font-semibold tracking-tight">
          Mission Control
        </span>
      </div>

      <nav className="px-2 py-3 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Live Stream */}
      <div className="flex-1 flex flex-col min-h-0 border-t border-border">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Live Stream
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <LiveStream />
        </div>
      </div>

      <div className="border-t border-border p-3">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync Memory"}
        </button>
      </div>
    </aside>
  );
}
