import path from "path";

export const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT || "/Users/moltymac/.openclaw/workspace";

export const DB_PATH =
  process.env.DB_PATH ||
  path.join(WORKSPACE_ROOT, "projects", "mission-control", "data", "mission-control.db");

export const MEMORY_DIR = path.join(WORKSPACE_ROOT, "memory");
export const MEMORY_MD = path.join(WORKSPACE_ROOT, "MEMORY.md");
export const ACTIVE_TASKS_MD = path.join(MEMORY_DIR, "active-tasks.md");
export const CLAWVAULT_DIR = path.join(WORKSPACE_ROOT, "memory-vault");
export const CLAWVAULT_INDEX = path.join(CLAWVAULT_DIR, ".clawvault-index.json");

// Lore knowledge base directories
export const LORE_DIRS = [
  path.join(WORKSPACE_ROOT, "projects", "arcane", "lore", "research"),
  path.join(WORKSPACE_ROOT, "projects", "arcane", "lore", "canon"),
  path.join(WORKSPACE_ROOT, "projects", "arcane", "lore", "drafts"),
];

// ── LLM-Agnostic Identity & Model Configuration ──
// Override via env vars to use any agent name, human name, or LLM provider.

/** Name of the autonomous agent (shown in kanban, scheduler, notifications) */
export const AGENT_NAME = process.env.OPENCLAW_AGENT_NAME || "Daedalus";

/** Name of the human operator (shown in done-gate, manual task ownership) */
export const HUMAN_NAME = process.env.OPENCLAW_HUMAN_NAME || "Gui";

/** Dispatch signal filename (agent picks up auto-dispatched tasks via this file) */
export const DISPATCH_SIGNAL_FILE = `${AGENT_NAME.toLowerCase()}-dispatch.json`;

// ── Model Capability Tiers ──
// Maps provider-agnostic capability levels to concrete model names.
// Override LLM_PROVIDER env var to switch between providers.

export type CapabilityTier = "fast" | "standard" | "reasoning";

export const LLM_PROVIDER = process.env.LLM_PROVIDER || "anthropic";

const MODEL_MAP: Record<string, Record<CapabilityTier, string>> = {
  anthropic: { fast: "haiku", standard: "sonnet", reasoning: "opus" },
  openai: { fast: "gpt-4o-mini", standard: "gpt-4o", reasoning: "o1" },
  google: { fast: "gemini-2.0-flash", standard: "gemini-2.5-pro", reasoning: "gemini-2.5-pro" },
  local: { fast: "llama-3.2-3b", standard: "llama-3.3-70b", reasoning: "deepseek-r1" },
};

/**
 * Resolve a capability tier to a concrete model name for the active provider.
 * Falls back to the tier name itself if provider is unknown.
 */
export function getModel(tier: CapabilityTier): string {
  return MODEL_MAP[LLM_PROVIDER]?.[tier] ?? tier;
}

/**
 * Get the full model map for a provider (for UI display).
 */
export function getProviderModels(provider?: string): Record<CapabilityTier, string> | null {
  return MODEL_MAP[provider || LLM_PROVIDER] ?? null;
}

/** All registered provider names */
export const AVAILABLE_PROVIDERS = Object.keys(MODEL_MAP);
