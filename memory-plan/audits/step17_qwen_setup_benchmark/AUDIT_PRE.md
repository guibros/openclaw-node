# AUDIT_PRE — Step 3.1: Set up Qwen3.5-27B locally + latency benchmark (~10-30s per 40-turn session)

**Version:** v3.1-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Create the LLM client module that communicates with a locally-running Qwen3.5-27B-Instruct
model via the `mlx-lm` server's OpenAI-compatible HTTP API. Provide a benchmark CLI tool
that measures structured-output extraction latency on a synthetic 40-turn session
(target: ≤30 seconds total). Deliver unit tests for the client module.

This is the foundational LLM integration layer that Steps 3.2–3.4 will build on.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [A] | Set up Qwen3.5-27B locally + latency benchmark (~10-30s per 40-turn session) |

## §3 — Design decisions

Consumed from Block 2 AUDIT_POST §6 carry-forwards (Step 2.5) and RESUME.md §0 Block 3
frozen decisions:

- **Extraction LLM:** Qwen3.5-27B-Instruct via `mlx-lm` (Apple Silicon native; ~3-5 tokens/sec
  on M4 for structured-output JSON). No Ollama. No cloud APIs. Ollama runtime acceptable as
  fallback only if mlx-lm setup proves blocking; model choice (Qwen3.5-27B) is fixed.
- **Communication:** `mlx-lm` provides an OpenAI-compatible HTTP server (`mlx_lm.server`).
  The Node.js client calls `POST /v1/chat/completions` and `GET /v1/models`. This is the
  standard way to invoke mlx-lm from a non-Python process.
- **Structured output:** Use `response_format: { type: "json_object" }` in the chat completions
  request for JSON-mode output. The schema validation will be added in Step 3.2.
- **Test baseline:** 559 tests (486 pass, 73 fail pre-existing). Step 3.1 adds 3-5 tests
  per frozen decisions.
- **Benchmark is a CLI tool**, not an automated test, because it requires the mlx-lm server
  to be running externally. Unit tests use a mock HTTP server (via `node:http`).

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | mlx-lm server not running during `npm test` | LOW | Unit tests use mock HTTP server; no live server dependency in test suite |
| 2 | Model name mismatch (Qwen3.5 vs Qwen2.5 naming) | LOW | Model name is configurable via `LLM_MODEL` env var; code works with any OpenAI-compatible model |
| 3 | `fetch` API availability | LOW | Node 18+ has global `fetch`; project already uses it elsewhere |

## §5 — Deferrals

- Extraction prompt design → Step 3.2
- Zod schema for extraction results → Step 3.2
- Daemon wiring → Step 3.3
- Feature flag for LLM vs regex → Step 3.3

## §6 — Phase 4 implementation outline

| # | File | Type | Delta description |
|---|------|------|-------------------|
| 1 | `lib/llm-client.mjs` | new | LLM client module. Exports `createLlmClient({ baseUrl, model, timeout })` factory returning `{ generate(messages, opts), healthCheck() }`. `generate()` calls `POST /v1/chat/completions`; supports `jsonMode: true` for structured output. `healthCheck()` calls `GET /v1/models` and returns `{ ok, model, error }`. Configurable via `LLM_BASE_URL`, `LLM_MODEL` env vars. Default base URL `http://localhost:8080`. Uses `fetch` (Node built-in). |
| 2 | `test/llm-benchmark.test.mjs` | new | 4 tests: (1) createLlmClient returns object with generate and healthCheck methods, (2) generate sends correct request format to mock HTTP server, (3) healthCheck parses model list response from mock HTTP server, (4) JSON mode sets response_format correctly in request body. |
| 3 | `bin/llm-benchmark.mjs` | new | CLI benchmark tool for operator use. Generates a 40-turn synthetic session (realistic session patterns: code discussion, debugging, architecture). Calls `generate()` with JSON-mode prompt. Measures wall-clock latency. Reports: total time, tokens/sec (if available from response), pass/fail against ≤30s target. Usage: `node bin/llm-benchmark.mjs [--base-url URL] [--model NAME] [--turns N]`. |
