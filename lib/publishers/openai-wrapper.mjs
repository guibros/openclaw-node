/**
 * openai-wrapper.mjs — OpenAI SDK wrapper for OpenClaw extraction triggering
 * and ambient memory injection.
 *
 * Wraps an OpenAI client so that every `chat.completions.create` call:
 *   1. Parses @memory directives from the user prompt (Step 7.4)
 *   2. (optional) Injects ambient memory into the system message prefix
 *   3. Fires a `mesh.memory.extract_request` NATS event after the response
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
import { parseMemoryDirective, replaceLastUserContent } from '../memory-directives.mjs';
import { DEFAULT_TOKEN_BUDGET } from '../memory-injector.mjs';

/**
 * Wrap an OpenAI-compatible client to publish extraction events and
 * optionally inject ambient memory before each chat completion.
 *
 * @param {object} client - OpenAI client instance (or compatible: Kimi, DeepSeek, OpenRouter)
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @param {{ injector?: { retrieve: (prompt: string, opts?: object) => Promise<object> } }} [opts] - optional memory injector
 * @returns {object} The same client with wrapped chat.completions.create
 */
export function wrapOpenAI(client, publisher, opts = {}) {
  if (!client?.chat?.completions?.create) {
    throw new Error('wrapOpenAI: client must have chat.completions.create');
  }

  const { injector } = opts;
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  let memoryDisabledForSession = false;

  client.chat.completions.create = async function wrappedCreate(...args) {
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

          // Handle session-level disable
          if (directive.type === 'none') {
            memoryDisabledForSession = true;
          }

          // Skip injection if disabled
          if (!memoryDisabledForSession && directive.type !== 'off') {
            const retrieveQuery = directive.type === 'only' ? directive.param : directive.cleanedText;
            const retrieveOpts = directive.type === 'deep'
              ? { tokenBudget: DEFAULT_TOKEN_BUDGET * 2 }
              : {};
            const memory = await injector.retrieve(retrieveQuery, retrieveOpts);
            const block = formatMemoryBlock(memory);
            if (block) {
              const msgs = directive.type ? callArgs[0].messages : args[0].messages;
              const injectedMessages = injectIntoMessages(msgs, block);
              callArgs = [{ ...callArgs[0] || args[0], messages: injectedMessages }, ...args.slice(1)];
            }
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
