"use client";

import { useState, useRef, useEffect } from "react";
import { Crown, Wrench, Eye, Shield, User } from "lucide-react";

export const ROLES = [
  { value: "lead", label: "Lead", icon: Crown, color: "text-purple-400", bg: "bg-purple-400/10" },
  { value: "implementer", label: "Implementer", icon: Wrench, color: "text-cyan-400", bg: "bg-cyan-400/10" },
  { value: "reviewer", label: "Reviewer", icon: Eye, color: "text-amber-400", bg: "bg-amber-400/10" },
  { value: "auditor", label: "Auditor", icon: Shield, color: "text-red-400", bg: "bg-red-400/10" },
  { value: "worker", label: "Worker", icon: User, color: "text-zinc-400", bg: "bg-zinc-400/10" },
] as const;

const ROLE_MAP = new Map(ROLES.map((r) => [r.value as string, r]));

export function RoleBadge({ role }: { role: string }) {
  const def = ROLE_MAP.get(role);
  if (!def) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-300">
        {role}
      </span>
    );
  }
  const Icon = def.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${def.bg} ${def.color}`}
    >
      <Icon className="h-3 w-3" />
      {def.label}
    </span>
  );
}

interface RolePickerProps {
  value: string;
  onChange: (role: string) => void;
}

export function RolePicker({ value, onChange }: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors"
      >
        <RoleBadge role={value} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-40 rounded-md border border-border bg-card shadow-lg">
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => {
                  onChange(r.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-accent/50 ${
                  value === r.value ? "bg-accent/30" : ""
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${r.color}`} />
                <span>{r.label}</span>
              </button>
            );
          })}
          <div className="border-t border-border px-3 py-2">
            <input
              type="text"
              placeholder="Custom role..."
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value.trim()) {
                  onChange(e.currentTarget.value.trim());
                  setOpen(false);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
