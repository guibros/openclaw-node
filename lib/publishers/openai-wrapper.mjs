/**
 * openai-wrapper.mjs — OpenAI SDK wrapper for OpenClaw extraction triggering
 * and ambient memory injection.
 *
 * Wraps an OpenAI client so that every `chat.completions.create` call:
 *   1. (optional) Injects ambient memory into the system message prefix
 *   2. Fires a `mesh.memory.extract_request` NATS event after the response
 *
 * Extraction publish and memory injection are both fire-and-forget —
 * failures never affect the LLM response.
 *
 * Also works for Kimi, DeepSeek, and OpenRouter (OpenAI-compatible APIs).
 *
 * Usage:
 *   import { createNatsPublisher } from '../publishers/publish-helper.mjs';
 *   import { wrapOpenAI } from '../publishers/openai-wrapper.mjs';
 *   import OpenAI from 'openai';
 *
 *   const publisher = createNatsPublisher();
 *   const client = wrapOpenAI(new OpenAI(), publisher);
 *   // Basic: extraction events only
 *
 *   const client = wrapOpenAI(new OpenAI(), publisher, { injector });
 *   // With injection: memory context prepended to system message
 */

import {
  formatMemoryBlock,
  extractLastUserPrompt,
  injectIntoMessages,
} from '../memory-formatter.mjs';

/**
 * Wrap an OpenAI-compatible client to publish extraction events and
 * optionally inject ambient memory before each chat completion.
 *
 * @param {object} client - OpenAI client instance (or compatible: Kimi, DeepSeek, OpenRouter)
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @param {{ injector?: { retrieve: (prompt: string) => Promise<object> } }} [opts] - optional memory injector
 * @returns {object} The same client with wrapped chat.completions.create
 */
export function wrapOpenAI(client, publisher, opts = {}) {
  if (!client?.chat?.completions?.create) {
    throw new Error('wrapOpenAI: client must have chat.completions.create');
  }

  const { injector } = opts;
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async function wrappedCreate(...args) {
    let callArgs = args;

    // Inject memory if injector is available
    if (injector && args[0]?.messages) {
      try {
        const prompt = extractLastUserPrompt(args[0].messages);
        if (prompt) {
          const memory = await injector.retrieve(prompt);
          const block = formatMemoryBlock(memory);
          if (block) {
            const injectedMessages = injectIntoMessages(args[0].messages, block);
            callArgs = [{ ...args[0], messages: injectedMessages }, ...args.slice(1)];
          }
        }
      } catch {
        // Injection failure must never affect the LLM call
      }
    }

    const result = await originalCreate(...callArgs);
    publisher.publish('openai-wrapper').catch(() => {});
    return result;
  };

  return client;
}
