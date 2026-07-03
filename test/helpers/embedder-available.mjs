/**
 * embedder-available.mjs — availability gate for the Xenova/bge-m3 model.
 *
 * The embedding suites need the ~2GB local model, which CI runners don't
 * (and shouldn't) carry. A skipped describe registers zero child tests, so
 * these skips would be invisible — every gated file therefore also registers
 * a sentinel test via embedderCensus() so the summary shows `skipped >= 1`
 * with the reason. OPENCLAW_REQUIRE_EMBEDDER=1 (e.g. on the node itself,
 * where LLM-L2-EMBED must pass anyway) turns the skip into a hard failure.
 */
import assert from 'node:assert/strict';
import { getEmbedder } from '../../lib/mcp-knowledge/core.mjs';

let cached;

export async function embedderSkipReason() {
  if (cached !== undefined) return cached;
  try {
    await getEmbedder();
    cached = false;
  } catch (err) {
    cached = `embedding model unavailable: ${String(err.message).split('\n')[0]}`;
  }
  return cached;
}

export function embedderCensus(test, skipReason, fileLabel) {
  test(`embedding-model census (${fileLabel})`, (t) => {
    if (!skipReason) return; // model present — the gated suites actually ran
    if (process.env.OPENCLAW_REQUIRE_EMBEDDER === '1') {
      assert.fail(`OPENCLAW_REQUIRE_EMBEDDER=1 but ${skipReason}`);
    }
    t.skip(skipReason);
  });
}
