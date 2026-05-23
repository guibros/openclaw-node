/**
 * gemini-wrapper.mjs — Google Gemini SDK wrapper for OpenClaw extraction triggering
 * and ambient memory injection.
 *
 * Wraps a Gemini GenerativeModel so that every `generateContent` call:
 *   1. Parses @memory directives from the user prompt (Step 7.4)
 *   2. (optional) Injects ambient memory as a prefixed text part
 *   3. Fires a `mesh.memory.extract_request` NATS event after the response
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
import { parseMemoryDirective } from '../memory-directives.mjs';
import { DEFAULT_TOKEN_BUDGET } from '../memory-injector.mjs';

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
 * Replace user prompt text in Gemini content, preserving structure.
 * Used to strip @memory directives from the content before sending to the LLM.
 *
 * @param {*} content - original content
 * @param {string} originalText - original prompt text (from extractGeminiPrompt)
 * @param {string} cleanedText - text with directive stripped
 * @returns {*}
 */
function replaceGeminiPromptText(content, originalText, cleanedText) {
  if (typeof content === 'string') return cleanedText;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string' && part === originalText) return cleanedText;
      if (part?.text === originalText) return { ...part, text: cleanedText };
      return part;
    });
  }
  if (content?.contents) {
    return {
      ...content,
      contents: content.contents.map(c => {
        if (c.role === 'user' && c.parts) {
          return {
            ...c,
            parts: c.parts.map(p =>
              p.text === originalText ? { ...p, text: cleanedText } : p
            ),
          };
        }
        return c;
      }),
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
 * @param {{ injector?: { retrieve: (prompt: string, opts?: object) => Promise<object> } }} [opts] - optional memory injector
 * @returns {object} The same model with wrapped generateContent
 */
export function wrapGemini(model, publisher, opts = {}) {
  if (!model?.generateContent) {
    throw new Error('wrapGemini: model must have generateContent');
  }

  const { injector } = opts;
  const originalGenerate = model.generateContent.bind(model);
  let memoryDisabledForSession = false;

  model.generateContent = async function wrappedGenerate(...args) {
    let callArgs = args;

    // Inject memory if injector is available
    if (injector && args[0]) {
      try {
        const prompt = extractGeminiPrompt(args[0]);
        if (prompt) {
          const directive = parseMemoryDirective(prompt);

          // Strip directive from content if one was found
          if (directive.type) {
            const cleaned = replaceGeminiPromptText(args[0], prompt, directive.cleanedText);
            callArgs = [cleaned, ...args.slice(1)];
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
              const base = directive.type ? callArgs[0] : args[0];
              const injectedContent = injectIntoGeminiContent(base, block);
              callArgs = [injectedContent, ...args.slice(1)];
            }
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
