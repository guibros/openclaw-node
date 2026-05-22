/**
 * minimax-wrapper.mjs — MiniMax SDK wrapper for OpenClaw extraction triggering.
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
 *   // client.chat.completions.create(...) now auto-publishes extraction events
 */

/**
 * Wrap a MiniMax client (OpenAI-compatible) to publish extraction events
 * after each chat completion.
 *
 * @param {object} client - MiniMax client instance with OpenAI-compatible interface
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @returns {object} The same client with wrapped chat.completions.create
 */
export function wrapMiniMax(client, publisher) {
  if (!client?.chat?.completions?.create) {
    throw new Error('wrapMiniMax: client must have chat.completions.create');
  }

  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async function wrappedCreate(...args) {
    const result = await originalCreate(...args);
    publisher.publish('minimax-wrapper').catch(() => {});
    return result;
  };

  return client;
}
