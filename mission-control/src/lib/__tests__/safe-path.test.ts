import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { isSafeId, isSensitiveRelPath, resolveWithinRoot } from "../safe-path";

let root: string;
let outside: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-path-root-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "safe-path-outside-"));
  fs.mkdirSync(path.join(root, "memory"), { recursive: true });
  fs.writeFileSync(path.join(root, "memory", "note.md"), "# hi");
  fs.writeFileSync(path.join(outside, "secret.txt"), "leak");
  // A symlink INSIDE the root that points OUTSIDE it — the escape the review found.
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "memory", "escape.md"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("isSafeId", () => {
  it("accepts ordinary ids", () => {
    for (const id of ["T-123", "soul_a", "abc.def", "x"]) expect(isSafeId(id)).toBe(true);
  });
  it("refuses traversal, separators, dot-prefix, and non-strings", () => {
    for (const id of ["../x", "a/b", "a\\b", ".hidden", "..", ".", "", "a b", 42, null, undefined]) {
      expect(isSafeId(id)).toBe(false);
    }
  });
});

describe("resolveWithinRoot", () => {
  it("returns the real path for a file inside the root", () => {
    const hit = resolveWithinRoot(root, "memory/note.md");
    expect(hit?.rel).toBe(path.join("memory", "note.md"));
  });
  it("refuses dot-dot traversal", () => {
    expect(resolveWithinRoot(root, "../" + path.basename(outside) + "/secret.txt")).toBeNull();
  });
  it("refuses an absolute path outside the root", () => {
    expect(resolveWithinRoot(root, path.join(outside, "secret.txt"))).toBeNull();
  });
  it("refuses a symlink that escapes the root", () => {
    expect(resolveWithinRoot(root, "memory/escape.md")).toBeNull();
  });
  it("refuses NUL bytes and empty input", () => {
    expect(resolveWithinRoot(root, "memory/note.md\0")).toBeNull();
    expect(resolveWithinRoot(root, "")).toBeNull();
  });
});

describe("isSensitiveRelPath", () => {
  it("refuses the files the review actually read", () => {
    for (const p of [
      "openclaw.json",
      "openclaw.env",
      "openclaw.env.bak",
      "auth-profiles.json",
      ".env",
      "workspace/projects/mission-control/.env.local",
      "workspace/projects/arcane-vault/.obsidian-api-key",
      "identity.key",
      "config/mc-session-token",
      "workspace/.knowledge.db",
      "projects/mission-control/data/mission-control.db",
    ]) {
      expect(isSensitiveRelPath(p, { blockedDirs: ["config", "agents"] })).toBe(true);
    }
  });
  it("refuses blocked directories in any segment", () => {
    expect(isSensitiveRelPath("agents/main/sessions/x.jsonl", { blockedDirs: ["agents"] })).toBe(true);
    expect(isSensitiveRelPath("projects/app/node_modules/pkg/index.js")).toBe(true);
  });
  it("allows the documents the UI opens", () => {
    for (const p of ["memory/2026-09-06.md", "MEMORY.md", "logs/injections.jsonl", "projects/app/README.md"]) {
      expect(isSensitiveRelPath(p, { blockedDirs: ["config", "agents"] })).toBe(false);
    }
  });
  it("applies name heuristics only when asked", () => {
    expect(isSensitiveRelPath("notes/token-rotation.md")).toBe(false);
    expect(isSensitiveRelPath("notes/token-rotation.md", { nameHeuristics: true })).toBe(true);
  });
});
