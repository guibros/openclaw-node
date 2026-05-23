/**
 * gemini-wrapper.mjs — Google Gemini SDK wrapper for OpenClaw extraction triggering
 * and ambient memory injection.
 *
 * Wraps a Gemini GenerativeModel so that every `generateContent` call:
 *   1. (optional) Injects ambient memory as a prefixed text part
 *   2. Fires a `mesh.memory.extract_request` NATS event after the response
 *
 * Gemini uses a different content format than OpenAI — content can be a string
 * or an array of parts. Injection prepends the memory block as a text part.
 *
 * Usage:
 *   import { createNatsPublisher } from '../publishers/publish-helper.mjs';
 *   import { wrapGemini } from '../publishers/gemini-wrapper.mjs';
 *   import { GoogleGenerativeAI } from '@google/generative-ai';
 *
 *   const publisher = createNatsPublisher();
 *   const genAI = new GoogleGenerativeAI(apiKey);
 *   const model = wrapGemini(genAI.getGenerativeModel({ model: 'gemini-pro' }), publisher);
 *   // Basic: extraction events only
 *
 *   const model = wrapGemini(genAI.getGenerativeModel({ model: 'gemini-pro' }), publisher, { injector });
 *   // With injection: memory context prepended to content
 */

import { formatMemoryBlock } from '../memory-formatter.mjs';

/**
 * Extract user prompt text from Gemini generateContent arguments.
 * Handles string, array of parts, and object with parts array.
 *
 * @param {*} content - first arg to generateContent
 * @returns {string}
 */
function extractGeminiPrompt(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') return part;
      if (part?.text) return part.text;
    }
  }
  if (content?.contents) {
    for (const c of content.contents) {
      if (c.role === 'user' && c.parts) {
        for (const p of c.parts) {
          if (p.text) return p.text;
        }
      }
    }
  }
  return '';
}

/**
 * Inject a memory block into Gemini generateContent arguments.
 * Prepends the memory block as a text element before the original content.
 *
 * @param {*} content - original first arg
 * @param {string} memoryBlock
 * @returns {*}
 */
function injectIntoGeminiContent(content, memoryBlock) {
  if (typeof content === 'string') {
    return `${memoryBlock}\n\n${content}`;
  }
  if (Array.isArray(content)) {
    return [{ text: memoryBlock + '\n\n' }, ...content];
  }
  if (content?.contents) {
    return {
      ...content,
      contents: [
        { role: 'user', parts: [{ text: memoryBlock }] },
        ...content.contents,
      ],
    };
  }
  return content;
}

/**
 * Wrap a Gemini GenerativeModel to publish extraction events and optionally
 * inject ambient memory before each generateContent call.
 *
 * @param {object} model - Gemini GenerativeModel instance
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @param {{ injector?: { retrieve: (prompt: string) => Promise<object> } }} [opts] - optional memory injector
 * @returns {object} The same model with wrapped generateContent
 */
export function wrapGemini(model, publisher, opts = {}) {
  if (!model?.generateContent) {
    throw new Error('wrapGemini: model must have generateContent');
  }

  const { injector } = opts;
  const originalGenerate = model.generateContent.bind(model);

  model.generateContent = async function wrappedGenerate(...args) {
    let callArgs = args;

    // Inject memory if injector is available
    if (injector && args[0]) {
      try {
        const prompt = extractGeminiPrompt(args[0]);
        if (prompt) {
          const memory = await injector.retrieve(prompt);
          const block = formatMemoryBlock(memory);
          if (block) {
            const injectedContent = injectIntoGeminiContent(args[0], block);
            callArgs = [injectedContent, ...args.slice(1)];
          }
        }
      } catch {
        // Injection failure must never affect the LLM call
      }
    }

    const result = await originalGenerate(...callArgs);
    publisher.publish('gemini-wrapper').catch(() => {});
    return result;
  };

  return model;
}
