/**
 * anthropic-wrapper.mjs — Anthropic SDK wrapper for OpenClaw extraction triggering
 * and ambient memory injection.
 *
 * Wraps an Anthropic client so that every `messages.create` call:
 *   1. (optional) Injects ambient memory into the system prompt prefix
 *   2. Fires a `mesh.memory.extract_request` NATS event after the response
 *
 * Anthropic uses a separate `system` parameter (not a system message in the
 * messages array), so injection prepends to that string.
 *
 * Usage:
 *   import { createNatsPublisher } from '../publishers/publish-helper.mjs';
 *   import { wrapAnthropic } from '../publishers/anthropic-wrapper.mjs';
 *   import Anthropic from '@anthropic-ai/sdk';
 *
 *   const publisher = createNatsPublisher();
 *   const client = wrapAnthropic(new Anthropic(), publisher);
 *   // Basic: extraction events only
 *
 *   const client = wrapAnthropic(new Anthropic(), publisher, { injector });
 *   // With injection: memory context prepended to system prompt
 */

import {
  formatMemoryBlock,
  extractLastUserPrompt,
  injectIntoSystemMessage,
} from '../memory-formatter.mjs';

/**
 * Wrap an Anthropic client to publish extraction events and optionally
 * inject ambient memory before each messages.create call.
 *
 * @param {object} client - Anthropic client instance
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @param {{ injector?: { retrieve: (prompt: string) => Promise<object> } }} [opts] - optional memory injector
 * @returns {object} The same client with wrapped messages.create
 */
export function wrapAnthropic(client, publisher, opts = {}) {
  if (!client?.messages?.create) {
    throw new Error('wrapAnthropic: client must have messages.create');
  }

  const { injector } = opts;
  const originalCreate = client.messages.create.bind(client.messages);

  client.messages.create = async function wrappedCreate(...args) {
    let callArgs = args;

    // Inject memory if injector is available
    if (injector && args[0]?.messages) {
      try {
        const prompt = extractLastUserPrompt(args[0].messages);
        if (prompt) {
          const memory = await injector.retrieve(prompt);
          const block = formatMemoryBlock(memory);
          if (block) {
            const systemContent = args[0].system || '';
            const injected = injectIntoSystemMessage(systemContent, block);
            callArgs = [{ ...args[0], system: injected }, ...args.slice(1)];
          }
        }
      } catch {
        // Injection failure must never affect the LLM call
      }
    }

    const result = await originalCreate(...callArgs);
    publisher.publish('anthropic-wrapper').catch(() => {});
    return result;
  };

  return client;
}
