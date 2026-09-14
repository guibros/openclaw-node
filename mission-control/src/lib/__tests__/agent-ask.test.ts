import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * agent-ask.test.ts — integrations plan step 6.3.
 *
 * The root modules are loaded by path at runtime, so a temp lib dir with two
 * stand-in modules drives the real askNode(): the loader, the wiring and the
 * deadline are all exercised, only the model and the fleet are stood in.
 */

let tmp: string;

const writeLib = (agentBody: string) => {
  fs.writeFileSync(path.join(tmp, "llm-client.mjs"), "export const createLlmClient = () => ({ generate: async () => ({}) });");
  fs.writeFileSync(path.join(tmp, "node-agent.mjs"), agentBody);
  process.env.OPENCLAW_LIB_DIR = tmp;
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ask-"));
  // openclaw-lib memoizes by filename; each case writes a different body to
  // the same two names, so the registry has to be dropped between them.
  vi.resetModules();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.OPENCLAW_LIB_DIR;
});

const load = () => import("../agent-ask");

describe("askNode", () => {
  it("passes the question through and returns the answer with its trace", async () => {
    writeLib(`
      export const createDefaultProviders = () => ({ tag: 'providers' });
      export const createNodeAgent = ({ client, providers }) => ({
        ask: async (q) => ({
          answer: 'seen: ' + q,
          trace: [{ tool: 'get_fleet_state', args: {}, ms: 3, error: null }],
          rounds: 2,
          // Proves the two halves the loop does not build for itself were supplied.
          usage: { hasClient: client ? 1 : 0, hasProviders: providers?.tag === 'providers' ? 1 : 0 },
        }),
      });
    `);
    const { askNode } = await load();
    const out = await askNode("which nodes are down");
    expect(out.answer).toBe("seen: which nodes are down");
    expect(out.trace[0].tool).toBe("get_fleet_state");
    expect(out.usage).toEqual({ hasClient: 1, hasProviders: 1 });
  });

  it("caps the question rather than forwarding an unbounded prompt", async () => {
    writeLib(`
      export const createDefaultProviders = () => ({});
      export const createNodeAgent = () => ({ ask: async (q) => ({ answer: String(q.length), trace: [], rounds: 1 }) });
    `);
    const { askNode, MAX_QUESTION_CHARS } = await load();
    const out = await askNode("a".repeat(MAX_QUESTION_CHARS + 500));
    expect(out.answer).toBe(String(MAX_QUESTION_CHARS));
  });

  it("names the queue when the wait expires instead of hanging", async () => {
    writeLib(`
      export const createDefaultProviders = () => ({});
      export const createNodeAgent = () => ({ ask: () => new Promise(() => {}) });
    `);
    const { askNode, AskTimeout } = await load();
    const started = Date.now();
    await expect(askNode("anything", 60)).rejects.toThrow(AskTimeout);
    await expect(askNode("anything", 60)).rejects.toThrow(/the local model is busy \(asks queue behind extraction jobs\)/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("falls through to the repo checkout for a module the env dir lacks", async () => {
    // Only llm-client is stood in. node-agent.mjs is absent from the env dir,
    // so the loader must reach the real lib/node-agent.mjs one level up from
    // mission-control/ — this is the candidate order doing its job, and it is
    // the real loop that answers below.
    fs.writeFileSync(
      path.join(tmp, "llm-client.mjs"),
      "export const createLlmClient = () => ({ generate: async () => ({ content: 'answered by the real loop', toolCalls: [] }) });",
    );
    process.env.OPENCLAW_LIB_DIR = tmp;
    const { askNode } = await load();
    const out = await askNode("say something");
    expect(out.answer).toBe("answered by the real loop");
    expect(out.trace).toEqual([]);
    expect(out.rounds).toBe(1);
  });
});

describe("a model that is not there", () => {
  it("names the endpoint instead of surfacing undici's bare 'fetch failed'", async () => {
    writeLib(`
      export const createDefaultProviders = () => ({});
      export const createNodeAgent = () => ({ ask: async () => {
        const err = new Error('fetch failed');
        err.cause = { code: 'ECONNREFUSED' };
        throw err;
      } });
    `);
    fs.writeFileSync(
      path.join(tmp, "llm-client.mjs"),
      "export const DEFAULT_BASE_URL = 'http://localhost:11434';\nexport const createLlmClient = () => ({ generate: async () => ({}) });",
    );
    const { askNode, ModelUnreachable } = await load();
    await expect(askNode("x")).rejects.toThrow(ModelUnreachable);
    await expect(askNode("x")).rejects.toThrow("local model unreachable at http://localhost:11434 (ECONNREFUSED)");
  });

  it("leaves an ordinary failure alone rather than blaming the model", async () => {
    writeLib(`
      export const createDefaultProviders = () => ({});
      export const createNodeAgent = () => ({ ask: async () => { throw new Error('tool registry is empty'); } });
    `);
    const { askNode, ModelUnreachable } = await load();
    await expect(askNode("x")).rejects.toThrow("tool registry is empty");
    await expect(askNode("x")).rejects.not.toThrow(ModelUnreachable);
  });
});
