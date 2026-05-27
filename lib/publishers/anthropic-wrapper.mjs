/**
 * anthropic-wrapper.mjs — Anthropic SDK wrapper for OpenClaw extraction triggering
 * and ambient memory injection.
 *
 * Wraps an Anthropic client so that every `messages.create` call:
 *   1. Parses @memory directives from the user prompt (Step 7.4)
 *   2. (optional) Injects ambient memory into the system prompt prefix
 *   3. Fires a `mesh.memory.extract_request` NATS event after the response
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
import { parseMemoryDirective, replaceLastUserContent } from '../memory-directives.mjs';
import { DEFAULT_TOKEN_BUDGET } from '../memory-injector.mjs';

/**
 * Wrap an Anthropic client to publish extraction events and optionally
 * inject ambient memory before each messages.create call.
 *
 * @param {object} client - Anthropic client instance
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @param {{ injector?: { retrieve: (prompt: string, opts?: object) => Promise<object> } }} [opts] - optional memory injector
 * @returns {object} The same client with wrapped messages.create
 */
export function wrapAnthropic(client, publisher, opts = {}) {
  if (!client?.messages?.create) {
    throw new Error('wrapAnthropic: client must have messages.create');
  }

  const { injector } = opts;
  const originalCreate = client.messages.create.bind(client.messages);
  // F-P301 fix: see openai-wrapper.mjs for the full rationale. `none` is
  // now per-turn (equivalent to `off`); no cross-call closure state.

  client.messages.create = async function wrappedCreate(...args) {
    let callArgs = args;

    // Inject memory if injector is available
    if (injector && args[0]?.messages) {
      try {
        const prompt = extractLastUserPrompt(args[0].messages);
        if (prompt) {
          const directive = parseMemoryDirective(prompt);

          // Strip directive from messages if one was found
          if (directive.type) {
            const cleaned = replaceLastUserContent(args[0].messages, directive.cleanedText);
            callArgs = [{ ...args[0], messages: cleaned }, ...args.slice(1)];
          }

          // F-P301/F-P302: 'none' = per-turn skip; 'only:X' uses cleanedText
          // as query + themeFilter (matches memory-inject-server).
          const skipInjection = directive.type === 'off' || directive.type === 'none';
          if (!skipInjection) {
            const retrieveQuery = directive.cleanedText;
            const retrieveOpts = {
              ...(directive.type === 'deep' ? { tokenBudget: DEFAULT_TOKEN_BUDGET * 2 } : {}),
              ...(directive.type === 'only' && directive.param ? { themeFilter: directive.param } : {}),
            };
            const memory = await injector.retrieve(retrieveQuery, retrieveOpts);
            const block = formatMemoryBlock(memory);
            if (block) {
              const params = callArgs[0] || args[0];
              const systemContent = params.system || '';
              const injected = injectIntoSystemMessage(systemContent, block);
              callArgs = [{ ...params, system: injected }, ...args.slice(1)];
            }
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
