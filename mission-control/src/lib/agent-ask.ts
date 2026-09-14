/**
 * agent-ask.ts — put a question to this node's own agent.
 *
 * The loop and the tools live in lib/node-agent.mjs at the root (step 6.2) and
 * are loaded, not reimplemented. This file only supplies the two things the
 * loop deliberately does not open for itself — an LLM client and the live
 * providers — and bounds how long a caller waits.
 *
 * On the bound: generate() routes through the ollama queue as an EXTRACTION
 * job — it waits to completion and never degrades, which is right for a
 * question an operator is waiting on. But an ask issued while extraction is
 * running queues behind it, and an HTTP client hanging with no explanation is
 * the worst version of that. So the wait is bounded and the cause is named.
 * Bypassing the queue is not the alternative: it would put a second inference
 * on the GPU beside the extraction, which is what the queue exists to prevent.
 */

import { loadOpenclawLib } from "./openclaw-lib";

export const ASK_TIMEOUT_MS = Number(process.env.AGENT_ASK_TIMEOUT_MS) || 120_000;
export const MAX_QUESTION_CHARS = 2000;

export interface AskTrace { tool: string; args: Record<string, unknown>; ms: number; error: string | null }
export interface AskResult {
  answer: string | null;
  trace: AskTrace[];
  rounds: number;
  usage?: Record<string, number> | null;
  error?: string;
}

interface NodeAgentModule {
  createNodeAgent: (deps: Record<string, unknown>) => { ask: (q: string) => Promise<AskResult> };
  createDefaultProviders: (opts?: Record<string, unknown>) => Record<string, unknown>;
}
interface LlmClientModule {
  createLlmClient: (opts?: Record<string, unknown>) => Record<string, unknown>;
  DEFAULT_BASE_URL: string;
}

export class AskTimeout extends Error {}
/** The local model endpoint did not answer the socket — a dependency being down, not a bug. */
export class ModelUnreachable extends Error {}

/**
 * undici reports a refused connection as the bare string "fetch failed", which
 * tells an operator reading a 500 nothing at all. Name the endpoint and the
 * syscall instead, the way the local TTS provider names VoiceStudio.
 */
function asModelUnreachable(err: unknown, baseUrl: string): Error {
  const e = err as { message?: string; cause?: { code?: string } };
  const code = e?.cause?.code;
  if (code || e?.message === "fetch failed") {
    return new ModelUnreachable(`local model unreachable at ${baseUrl}${code ? ` (${code})` : ""}`);
  }
  return err as Error;
}

async function buildAgent() {
  const [agentMod, llmMod] = await Promise.all([
    loadOpenclawLib<NodeAgentModule>("node-agent.mjs"),
    loadOpenclawLib<LlmClientModule>("llm-client.mjs"),
  ]);
  const agent = agentMod.createNodeAgent({
    client: llmMod.createLlmClient(),
    providers: agentMod.createDefaultProviders(),
  });
  return { agent, baseUrl: llmMod.DEFAULT_BASE_URL };
}

export async function askNode(question: string, timeoutMs = ASK_TIMEOUT_MS): Promise<AskResult> {
  const { agent, baseUrl } = await buildAgent();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      agent.ask(question.slice(0, MAX_QUESTION_CHARS)).catch((err: unknown) => {
        throw asModelUnreachable(err, baseUrl);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AskTimeout(
            `no answer within ${Math.round(timeoutMs / 1000)}s — the local model is busy (asks queue behind extraction jobs)`,
          )),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
