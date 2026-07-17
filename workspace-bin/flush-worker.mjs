/**
 * flush-worker.mjs — runs the memory pipeline's HEAVY transcript work OFF the
 * daemon's main thread: the pre-compression flush, the shouldFlush token check,
 * and the live session import. All three parse a multi-MB JSONL synchronously;
 * on the daemon's event loop they starved the :7893 inject server for the whole
 * window — and under llama-server full-burn the starvation stretched to minutes
 * (thread-sample + live curl evidence in audits/memory_ingest_remediation and
 * audits/flush_worker).
 *
 * Tasks (workerData.kind):
 *   'flush'  — optional shouldFlush gate, then runFlush. LLM client + extraction
 *              store are constructed HERE (env-derived; not structured-cloneable).
 *   'import' — SessionStore.importSession (full parse + wholesale row replace).
 *
 * No embedder is loaded in this worker.
 */
import { parentPort, workerData } from 'node:worker_threads';

const { kind = 'flush' } = workerData;

try {
  if (kind === 'import') {
    const { jsonlPath, source, format } = workerData;
    const { SessionStore } = await import('../lib/session-store.mjs');
    const store = new SessionStore();
    const result = await store.importSession(jsonlPath, { source, format });
    parentPort.postMessage({ ok: true, result });
  } else {
    const { jsonlPath, memoryMdPath, charBudget, checkShouldFlush, contextWindowTokens } = workerData;
    const { runFlush, shouldFlush, USE_LLM_EXTRACTION } = await import('../lib/pre-compression-flush.mjs');
    let check = null;
    if (checkShouldFlush) {
      check = await shouldFlush(jsonlPath, { contextWindowTokens: contextWindowTokens || 200000 });
      if (!check.shouldFlush) {
        parentPort.postMessage({ ok: true, result: { flushed: false, skippedByCheck: true, check } });
      }
    }
    if (!check || check.shouldFlush) {
      let llmClient = null;
      let extractionStore = null;
      if (USE_LLM_EXTRACTION) {
        const { createLlmClient } = await import('../lib/llm-client.mjs');
        llmClient = createLlmClient();
        try {
          const { createExtractionStore } = await import('../lib/extraction-store.mjs');
          extractionStore = createExtractionStore();
        } catch {
          // runFlush degrades to the regex path without a store — same behavior
          // the daemon's own getExtractionStore() failure produces.
        }
      }
      const result = await runFlush(jsonlPath, memoryMdPath, { charBudget, llmClient, extractionStore });
      if (check) result.check = check;
      parentPort.postMessage({ ok: true, result });
    }
  }
} catch (err) {
  parentPort.postMessage({ ok: false, error: err?.message || String(err) });
}
// Let the message drain, then exit — undici keep-alive sockets from the LLM
// client can otherwise hold the worker's loop open for minutes.
setTimeout(() => process.exit(0), 200);
