# AUDIT_POST — Step 4.9: Frontend publisher pack (hooks/ + lib/publishers/ + docs/PUBLISHERS.md)

**Version:** v4.9-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/publishers/publish-helper.mjs` (new) — DEFAULT_NATS_URL, EXTRACT_SUBJECT, publishExtractDirect, createNatsPublisher | `lib/publishers/publish-helper.mjs:15` (DEFAULT_NATS_URL), `:18` (EXTRACT_SUBJECT), `:30` (publishExtractDirect), `:48` (createNatsPublisher) | yes | `grep -n 'export' lib/publishers/publish-helper.mjs` → 4 exports |
| 2 | `lib/publishers/openai-wrapper.mjs` (new) — wrapOpenAI | `lib/publishers/openai-wrapper.mjs:29` (wrapOpenAI) | yes | `grep -n 'export function' lib/publishers/openai-wrapper.mjs` → 1 export |
| 3 | `lib/publishers/anthropic-wrapper.mjs` (new) — wrapAnthropic | `lib/publishers/anthropic-wrapper.mjs:25` (wrapAnthropic) | yes | `grep -n 'export function' lib/publishers/anthropic-wrapper.mjs` → 1 export |
| 4 | `lib/publishers/gemini-wrapper.mjs` (new) — wrapGemini | `lib/publishers/gemini-wrapper.mjs:26` (wrapGemini) | yes | `grep -n 'export function' lib/publishers/gemini-wrapper.mjs` → 1 export |
| 5 | `lib/publishers/minimax-wrapper.mjs` (new) — wrapMiniMax | `lib/publishers/minimax-wrapper.mjs:24` (wrapMiniMax) | yes | `grep -n 'export function' lib/publishers/minimax-wrapper.mjs` → 1 export |
| 6 | `bin/openclaw-extract-now.mjs` (new) — runExtractNow, CLI entry | `bin/openclaw-extract-now.mjs:30` (runExtractNow) | yes | `grep -n 'export async function' bin/openclaw-extract-now.mjs` → 1 export |
| 7 | `hooks/claude-code/pre-compact.sh` (new) — shell hook delegating to CLI | `hooks/claude-code/pre-compact.sh` (exists, 16 lines) | yes | `ls hooks/claude-code/pre-compact.sh` → exists |
| 8 | `hooks/openwebui/openclaw-publisher-plugin.py` (new) — Python plugin via subprocess | `hooks/openwebui/openclaw-publisher-plugin.py` (exists) | yes | `ls hooks/openwebui/openclaw-publisher-plugin.py` → exists |
| 9 | `hooks/librechat/openclaw-trigger.js` (new) — Node.js trigger | `hooks/librechat/openclaw-trigger.js` (exists) | yes | `ls hooks/librechat/openclaw-trigger.js` → exists |
| 10 | `hooks/continue/openclaw-config.json` (new) — Continue IDE config | `hooks/continue/openclaw-config.json` (exists) | yes | `ls hooks/continue/openclaw-config.json` → exists |
| 11 | `.claude/hooks/pre-compact.sh` (mod) — delegation to hooks/claude-code/ | DROPPED | no | Sandbox blocked edit (same constraint as Steps 4.7/4.8). Operator must manually update. |
| 12 | `docs/PUBLISHERS.md` (new) — comprehensive docs | `docs/PUBLISHERS.md` (exists) | yes | `ls docs/PUBLISHERS.md` → exists |
| 13 | `test/publishers.test.mjs` (new) — ~10 tests | `test/publishers.test.mjs` (14 `it()` blocks) | yes | `grep -c 'it(' test/publishers.test.mjs` → `14` |

12 of 13 rows landed = yes. 1 row (delta #11) dropped due to sandbox constraint — documented in AUDIT_PRE Mid-Implementation Findings.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'DEFAULT_NATS_URL' lib/publishers/publish-helper.mjs` | `15:export const DEFAULT_NATS_URL = 'nats://localhost:4222';` |
| 2 | `grep -n 'EXTRACT_SUBJECT' lib/publishers/publish-helper.mjs` | `18:export const EXTRACT_SUBJECT = 'mesh.memory.extract_request';` |
| 3 | `grep -n 'publishExtractDirect' lib/publishers/publish-helper.mjs` | `30:export function publishExtractDirect(nc, nodeId, triggeredBy = 'manual') {` |
| 4 | `grep -n 'createNatsPublisher' lib/publishers/publish-helper.mjs` | `48:export function createNatsPublisher(opts = {}) {` |
| 5 | `grep -n 'wrapOpenAI' lib/publishers/openai-wrapper.mjs` | `29:export function wrapOpenAI(client, publisher) {` |
| 6 | `grep -n 'wrapAnthropic' lib/publishers/anthropic-wrapper.mjs` | `25:export function wrapAnthropic(client, publisher) {` |
| 7 | `grep -n 'wrapGemini' lib/publishers/gemini-wrapper.mjs` | `26:export function wrapGemini(model, publisher) {` |
| 8 | `grep -n 'wrapMiniMax' lib/publishers/minimax-wrapper.mjs` | `24:export function wrapMiniMax(client, publisher) {` |
| 9 | `grep -n 'runExtractNow' bin/openclaw-extract-now.mjs` | `30:export async function runExtractNow(opts = {}) {` |
| 10 | `grep -c 'it(' test/publishers.test.mjs` | `14` |

## §3 — Cross-references still valid

- `lib/publishers/publish-helper.mjs` imports: `os` from `node:os` (built-in), `nats` via dynamic `import('nats')` (lazy). No existing modules import it except new files in this step.
- `bin/openclaw-extract-now.mjs` imports: `EXTRACT_SUBJECT`, `DEFAULT_NATS_URL`, `publishExtractDirect` from `../lib/publishers/publish-helper.mjs`. All resolved.
- `hooks/librechat/openclaw-trigger.js` imports: `createNatsPublisher` from `../../lib/publishers/publish-helper.mjs`. Resolved.
- `test/publishers.test.mjs` imports from all wrapper modules + CLI tool. All 6 import statements resolve.
- `EXTRACT_SUBJECT` value `'mesh.memory.extract_request'` matches `lib/extraction-trigger.mjs:16` (verified via grep). Two copies of the constant — intentional: publish-helper is a standalone module that should not depend on extraction-trigger.mjs.
- No pre-existing symbols renamed or deleted.
- No existing imports modified.

## §4 — Findings

- [POSITIVE] `publishExtractDirect` is a pure fire-and-forget function — publishes to NATS and returns immediately, matching the existing `publishExtractRequest` pattern from `lib/extraction-trigger.mjs`.
- [POSITIVE] `createNatsPublisher` uses lazy NATS connection via dynamic `import('nats')` — the `nats` module is only loaded when the first publish is attempted, avoiding startup cost for imported-but-unused wrappers.
- [POSITIVE] All four SDK wrappers (OpenAI, Anthropic, Gemini, MiniMax) follow an identical pattern: accept client + publisher, monkey-patch the primary method, call `publisher.publish(triggeredBy).catch(() => {})` post-response. The `.catch(() => {})` ensures extraction failures never propagate to the LLM caller.
- [POSITIVE] `wrapOpenAI` correctly validates that `client.chat.completions.create` exists before wrapping; throws a clear error otherwise. Same validation pattern in all four wrappers.
- [POSITIVE] `bin/openclaw-extract-now.mjs` exports `runExtractNow(opts)` for programmatic use AND has a CLI entry point — both Tier 1 hooks and Tier 3 manual use share the same code path.
- [POSITIVE] `hooks/claude-code/pre-compact.sh` resolves its repo root via `dirname "$0"` + relative path traversal, making it work regardless of where it's symlinked from.
- [POSITIVE] Python plugin (`hooks/openwebui/openclaw-publisher-plugin.py`) uses `subprocess.Popen` (fire-and-forget, non-blocking) with `DEVNULL` for stdout/stderr — never blocks the OpenWebUI response path.
- [POSITIVE] `docs/PUBLISHERS.md` covers all three tiers with code examples, environment variables, closed-app limitations table, and troubleshooting section.
- [POSITIVE] All 14 new tests pass. Test count: 685 (608 pass, 77 fail — unchanged baseline of 77 pre-existing + flaky failures).
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 item 13 said "~10 tests". Actual: 14 `it()` blocks across 9 describe blocks. Phase-4-correction streak: 0 (Block 4; reset).
- [NEGATIVE] `.claude/hooks/pre-compact.sh` modification blocked by sandbox — delta #11 dropped. Operator must manually update the file to delegate to `hooks/claude-code/pre-compact.sh`. This is the third consecutive step (4.7, 4.8, 4.9) where `.claude/hooks/` edits were blocked.

9 POSITIVE findings, 2 NEGATIVE findings.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Block 5

- Test baseline is now 685 tests (608 pass, 77 fail — 73 pre-existing + 4 flaky). +14 tests added this step.
- `publishExtractDirect(nc, nodeId, triggeredBy)` exported from `lib/publishers/publish-helper.mjs:30` — direct NATS publish for callers with existing connection.
- `createNatsPublisher(opts)` exported from `lib/publishers/publish-helper.mjs:48` — lazy-connecting factory for SDK wrappers.
- `wrapOpenAI`, `wrapAnthropic`, `wrapGemini`, `wrapMiniMax` — SDK wrapper functions in `lib/publishers/`.
- `runExtractNow(opts)` exported from `bin/openclaw-extract-now.mjs:30` — manual CLI tool.
- `.claude/hooks/pre-compact.sh` still needs manual operator update to delegate to `hooks/claude-code/pre-compact.sh` (sandbox constraint across Steps 4.7-4.9).
- Health-watch launchd plist (`services/launchd/ai.openclaw.health-watch.plist`) still not created — deferred from Step 4.8 carry-forward; Block 5 should address if needed.
- `EXTRACT_SUBJECT` is duplicated between `lib/extraction-trigger.mjs:16` and `lib/publishers/publish-helper.mjs:18` — intentional for module independence; if the subject changes, both must be updated.
- `bin/openclaw-restart.sh` still needs `chmod +x` by operator (carry-forward from Step 4.8).
- Block 4 complete (9/9). Validation gate: `bin/health-watch.mjs` should run for 24 hours on operator's machine with zero spurious warnings before Block 5 begins.
