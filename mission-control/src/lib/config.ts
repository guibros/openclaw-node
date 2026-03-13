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
