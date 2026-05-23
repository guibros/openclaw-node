/**
 * minimax-wrapper.mjs — MiniMax SDK wrapper for OpenClaw extraction triggering
 * and ambient memory injection.
 *
 * MiniMax uses an OpenAI-compatible API, so this wrapper follows the same
 * pattern as openai-wrapper.mjs: wraps `client.chat.completions.create`.
 *
 * Usage:
 *   import { createNatsPublisher } from '../publishers/publish-helper.mjs';
 *   import { wrapMiniMax } from '../publishers/minimax-wrapper.mjs';
 *
 *   const publisher = createNatsPublisher();
 *   const client = wrapMiniMax(minimaxClient, publisher);
 *   // Basic: extraction events only
 *
 *   const client = wrapMiniMax(minimaxClient, publisher, { injector });
 *   // With injection: memory context prepended to system message
 */

import {
  formatMemoryBlock,
  extractLastUserPrompt,
  injectIntoMessages,
} from '../memory-formatter.mjs';

/**
 * Wrap a MiniMax client (OpenAI-compatible) to publish extraction events
 * and optionally inject ambient memory before each chat completion.
 *
 * @param {object} client - MiniMax client instance with OpenAI-compatible interface
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @param {{ injector?: { retrieve: (prompt: string) => Promise<object> } }} [opts] - optional memory injector
 * @returns {object} The same client with wrapped chat.completions.create
 */
export function wrapMiniMax(client, publisher, opts = {}) {
  if (!client?.chat?.completions?.create) {
    throw new Error('wrapMiniMax: client must have chat.completions.create');
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
    publisher.publish('minimax-wrapper').catch(() => {});
    return result;
  };

  return client;
}
