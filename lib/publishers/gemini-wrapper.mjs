/**
 * gemini-wrapper.mjs — Google Gemini SDK wrapper for OpenClaw extraction triggering.
 *
 * Wraps a Gemini GenerativeModel so that every `generateContent` call fires a
 * `mesh.memory.extract_request` NATS event after the response.
 *
 * Usage:
 *   import { createNatsPublisher } from '../publishers/publish-helper.mjs';
 *   import { wrapGemini } from '../publishers/gemini-wrapper.mjs';
 *   import { GoogleGenerativeAI } from '@google/generative-ai';
 *
 *   const publisher = createNatsPublisher();
 *   const genAI = new GoogleGenerativeAI(apiKey);
 *   const model = wrapGemini(genAI.getGenerativeModel({ model: 'gemini-pro' }), publisher);
 *   // model.generateContent(...) now auto-publishes extraction events
 */

/**
 * Wrap a Gemini GenerativeModel to publish extraction events after each
 * generateContent call.
 *
 * @param {object} model - Gemini GenerativeModel instance
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @returns {object} The same model with wrapped generateContent
 */
export function wrapGemini(model, publisher) {
  if (!model?.generateContent) {
    throw new Error('wrapGemini: model must have generateContent');
  }

  const originalGenerate = model.generateContent.bind(model);

  model.generateContent = async function wrappedGenerate(...args) {
    const result = await originalGenerate(...args);
    publisher.publish('gemini-wrapper').catch(() => {});
    return result;
  };

  return model;
}
