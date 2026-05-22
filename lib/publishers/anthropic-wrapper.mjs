/**
 * anthropic-wrapper.mjs — Anthropic SDK wrapper for OpenClaw extraction triggering.
 *
 * Wraps an Anthropic client so that every `messages.create` call fires a
 * `mesh.memory.extract_request` NATS event after the response.
 *
 * Usage:
 *   import { createNatsPublisher } from '../publishers/publish-helper.mjs';
 *   import { wrapAnthropic } from '../publishers/anthropic-wrapper.mjs';
 *   import Anthropic from '@anthropic-ai/sdk';
 *
 *   const publisher = createNatsPublisher();
 *   const client = wrapAnthropic(new Anthropic(), publisher);
 *   // client.messages.create(...) now auto-publishes extraction events
 */

/**
 * Wrap an Anthropic client to publish extraction events after each
 * messages.create call.
 *
 * @param {object} client - Anthropic client instance
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @returns {object} The same client with wrapped messages.create
 */
export function wrapAnthropic(client, publisher) {
  if (!client?.messages?.create) {
    throw new Error('wrapAnthropic: client must have messages.create');
  }

  const originalCreate = client.messages.create.bind(client.messages);

  client.messages.create = async function wrappedCreate(...args) {
    const result = await originalCreate(...args);
    publisher.publish('anthropic-wrapper').catch(() => {});
    return result;
  };

  return client;
}
