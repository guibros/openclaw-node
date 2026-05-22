/**
 * openai-wrapper.mjs — OpenAI SDK wrapper for OpenClaw extraction triggering.
 *
 * Wraps an OpenAI client so that every `chat.completions.create` call
 * fires a `mesh.memory.extract_request` NATS event after the response.
 * The extraction publish is fire-and-forget — failures never affect the
 * LLM response.
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
 *   // client.chat.completions.create(...) now auto-publishes extraction events
 */

/**
 * Wrap an OpenAI-compatible client to publish extraction events after
 * each chat completion.
 *
 * @param {object} client - OpenAI client instance (or compatible: Kimi, DeepSeek, OpenRouter)
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @returns {object} The same client with wrapped chat.completions.create
 */
export function wrapOpenAI(client, publisher) {
  if (!client?.chat?.completions?.create) {
    throw new Error('wrapOpenAI: client must have chat.completions.create');
  }

  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async function wrappedCreate(...args) {
    const result = await originalCreate(...args);
    publisher.publish('openai-wrapper').catch(() => {});
    return result;
  };

  return client;
}
