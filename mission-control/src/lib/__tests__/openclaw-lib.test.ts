import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { libCandidates, loadOpenclawLib } from "../openclaw-lib";

/**
 * openclaw-lib.test.ts — integrations plan step 6.3.
 *
 * mesh-sign.ts carried this resolution rule alone until the agent route needed
 * it too. Extracting it is only safe if the candidate order is pinned: the
 * installed layout (workspace/projects/mission-control) and the repo checkout
 * sit at different depths, and getting the order wrong loads the wrong tree.
 */

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oclib-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.OPENCLAW_LIB_DIR; });

describe("candidate order", () => {
  it("explicit env dir wins, then installed depth, then repo checkout", () => {
    // Installed layout: the lib the node runs from is workspace/lib, two up
    // from workspace/projects/mission-control — not projects/lib, one up.
    expect(libCandidates("x.mjs", { OPENCLAW_LIB_DIR: "/explicit" }, "/w/projects/mission-control")).toEqual([
      "/explicit/x.mjs",
      "/w/lib/x.mjs",
      "/w/projects/lib/x.mjs",
    ]);
  });

  it("without the env var there are exactly the two relative candidates", () => {
    expect(libCandidates("x.mjs", {}, "/repo/mission-control")).toEqual(["/lib/x.mjs", "/repo/lib/x.mjs"]);
  });
});

describe("loading", () => {
  const writeMod = (dir: string, name: string, body: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  };

  it("loads the module the env dir points at and memoizes it", async () => {
    writeMod(tmp, "memo-probe.mjs", "export let calls = 0; calls++; export const hello = () => 'hi';");
    process.env.OPENCLAW_LIB_DIR = tmp;
    const a = await loadOpenclawLib<{ hello: () => string }>("memo-probe.mjs");
    expect(a.hello()).toBe("hi");
    // Same module object back, not a re-import: the memo is per filename.
    expect(await loadOpenclawLib("memo-probe.mjs")).toBe(a);
  });

  it("names every path it tried, so a wrong layout is diagnosable", async () => {
    process.env.OPENCLAW_LIB_DIR = path.join(tmp, "nowhere");
    await expect(loadOpenclawLib("absent-module.mjs")).rejects.toThrow(
      /absent-module\.mjs not found \(tried: .*nowhere\/absent-module\.mjs, .*\)\. Set OPENCLAW_LIB_DIR/,
    );
  });

  it("a failure is retryable — the rejected promise is not cached", async () => {
    process.env.OPENCLAW_LIB_DIR = tmp;
    await expect(loadOpenclawLib("late-module.mjs")).rejects.toThrow(/not found/);
    writeMod(tmp, "late-module.mjs", "export const ok = true;");
    await expect(loadOpenclawLib<{ ok: boolean }>("late-module.mjs")).resolves.toMatchObject({ ok: true });
  });
});
