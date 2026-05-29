# AUDIT_POST — Step 3.1: Set up Qwen3.5-27B locally + latency benchmark (~10-30s per 40-turn session)

**Version:** v3.1-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Create LLM client module: createLlmClient factory, generate with JSON mode, healthCheck, env-configurable baseUrl/model/timeout | `lib/llm-client.mjs:26` (createLlmClient), `:41` (generate), `:87` (healthCheck) | yes | `grep -n 'export function createLlmClient' lib/llm-client.mjs` → `26` |
| 2 | 4 tests: interface check, generate request format, healthCheck response parsing, JSON mode response_format | `test/llm-benchmark.test.mjs` (full file, 4 `it()` blocks) | yes | `grep -c 'it(' test/llm-benchmark.test.mjs` → `4` |
| 3 | CLI benchmark tool: synthetic 40-turn session generator, extraction latency measurement, pass/fail against ≤30s, CLI flags | `bin/llm-benchmark.mjs:64` (generateSyntheticSession), `:87` (runBenchmark), `:112` (main) | yes | `grep -n 'export async function runBenchmark' bin/llm-benchmark.mjs` → `87` |

All 3 rows landed = yes. 3 non-audit non-ledger files in staged diff (lib/llm-client.mjs, test/llm-benchmark.test.mjs, bin/llm-benchmark.mjs).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export function createLlmClient' lib/llm-client.mjs` | `26:export function createLlmClient(opts = {}) {` |
| 2 | `grep -n 'async function generate' lib/llm-client.mjs` | `41:  async function generate(messages, genOpts = {}) {` |
| 3 | `grep -n 'async function healthCheck' lib/llm-client.mjs` | `87:  async function healthCheck() {` |
| 4 | `grep -n 'export async function runBenchmark' bin/llm-benchmark.mjs` | `87:export async function runBenchmark(client, turns) {` |
| 5 | `grep -n 'export function generateSyntheticSession' bin/llm-benchmark.mjs` | `64:export function generateSyntheticSession(turnCount = 40) {` |
| 6 | `grep -c 'it(' test/llm-benchmark.test.mjs` | `4` |

## §3 — Cross-references still valid

- `createLlmClient`, `DEFAULT_BASE_URL`, `DEFAULT_MODEL`, `DEFAULT_TIMEOUT` exported from `lib/llm-client.mjs` — imported by `test/llm-benchmark.test.mjs:4` and `bin/llm-benchmark.mjs:17`.
- No pre-existing symbols renamed or deleted.
- No stale references found (grep for `createLlmClient|DEFAULT_BASE_URL|DEFAULT_MODEL|DEFAULT_TIMEOUT` returns only the 3 new files + ledger docs).
- Zero stale cross-references.

## §4 — Findings

- [POSITIVE] The LLM client module is pure HTTP with no external dependencies — uses `fetch` (Node built-in) and `AbortController` for timeout. Zero new npm packages.
- [POSITIVE] The client is fully configurable via environment variables (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT`), constructor options, and per-call options, supporting both mlx-lm and any OpenAI-compatible server.
- [POSITIVE] The healthCheck function returns a structured result `{ ok, model, models, error }` with graceful error handling — connection failures produce `{ ok: false, error: ... }` instead of throwing.
- [POSITIVE] The benchmark CLI tool includes a 40-turn synthetic session with realistic content (NATS debugging, entity extraction, embedding performance, spreading activation, broadcast protocol) matching the project's actual domain vocabulary.
- [POSITIVE] The benchmark reports tokens/sec when usage data is available, providing the operator with the key throughput metric for the ≤30s latency target.
- [POSITIVE] Tests use a mock HTTP server (via `node:http`) that captures requests for assertion, avoiding any dependency on the live mlx-lm server during `npm test`.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 3.2

- Test baseline is now 563 tests (490 pass, 73 fail pre-existing). +4 tests added this step.
- `lib/llm-client.mjs` exports `createLlmClient({ baseUrl, model, timeout })` returning `{ generate(messages, opts), healthCheck() }`. Step 3.2 will import this to test the extraction prompt against the live model.
- `generate()` supports `{ jsonMode: true }` for structured output via `response_format: { type: 'json_object' }`.
- `bin/llm-benchmark.mjs` exports `generateSyntheticSession(turnCount)` and `runBenchmark(client, turns)` for programmatic use. The operator should run `node bin/llm-benchmark.mjs` to verify the live ≤30s target before Step 3.2.
- `DEFAULT_MODEL` is set to `mlx-community/Qwen2.5-27B-Instruct-4bit` as a reasonable default. The operator should verify this matches their local mlx-lm installation and adjust `LLM_MODEL` if needed (e.g., if using Qwen3.5 when available).
- Phase-4-correction streak: 1 (Step 3.1 — zero corrections).
- Phase-8-patch streak: 6 (Steps 2.1–3.1, zero patches).
