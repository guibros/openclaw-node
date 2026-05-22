# AUDIT_PRE — Step 4.9: Frontend publisher pack (hooks/ + lib/publishers/ + docs/PUBLISHERS.md)

**Version:** v4.9-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Implement the frontend publisher pack — agnostic event publishers for popular LLM frontends.
Any frontend can trigger extraction by publishing `mesh.memory.extract_request` to NATS.
This step creates Tier 1 direct hooks (shell/Python/JS for specific frontends), Tier 2 SDK
wrappers (OpenAI/Anthropic/Gemini/MiniMax), a Tier 3 manual CLI command, and comprehensive
documentation. This is the last step of Block 4.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.9 | v4.9 | [A] | Frontend publisher pack (hooks/ + lib/publishers/ + docs/PUBLISHERS.md) |

## §3 — Design decisions (carry-forwards from Step 4.8 AUDIT_POST §6)

- Test baseline is 671 tests (594 pass, 77 fail — 73 pre-existing + 4 flaky).
- `EXTRACT_SUBJECT` = `'mesh.memory.extract_request'` in `lib/extraction-trigger.mjs:16`.
- `publishExtractRequest(nc, nodeId, opts)` at `lib/extraction-trigger.mjs:30` — existing function for NATS publish.
- `.claude/hooks/pre-compact.sh` remains a no-op stub — this step replaces it with delegation to `hooks/claude-code/pre-compact.sh`.
- `bin/openclaw-restart.sh` needs `chmod +x` by operator (sandbox constraint from Step 4.8).
- Health-watch launchd plist (`ai.openclaw.health-watch.plist`) — carry-forward suggestion from Step 4.8; deferred to Block 5 as it is not part of this step's frozen description.

**Frozen decisions consumed (RESUME.md §0 Block 4):**
- Step 4.9 scope per frozen decisions: Tier 1 hooks, Tier 2 SDK wrappers, Tier 3 manual CLI, `docs/PUBLISHERS.md`.
- Kimi/DeepSeek/OpenRouter share the OpenAI wrapper (OpenAI-compatible APIs).
- The 45-min idle timer from Step 4.7 is already deployed — Tier 3 references it as existing.

**Architecture for SDK wrappers:**
- All wrappers share a common `publish-helper.mjs` that provides fire-and-forget NATS publishing.
- Wrappers accept a `publisher` object (from `createNatsPublisher`) via dependency injection.
- Each wrapper monkey-patches or proxies the relevant SDK method to call `publisher.publish(triggeredBy)` post-response.
- Publishing failures are silently caught — extraction is best-effort, never disrupts the LLM call.
- `nats` (^2.28.2) is already a project dependency.

**Architecture for shell/script hooks:**
- All Tier 1 hooks delegate to `bin/openclaw-extract-now.mjs` (the manual CLI) which handles NATS connection + publish.
- `hooks/claude-code/pre-compact.sh` calls the CLI with `--triggered-by=claude-code-pre-compact`.
- `.claude/hooks/pre-compact.sh` is updated to exec the new `hooks/claude-code/pre-compact.sh`.
- Python plugin (OpenWebUI) uses `nats-py` or subprocess call to `bin/openclaw-extract-now.mjs`.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| SDK wrappers require SDKs to be installed for testing | LOW | Tests use mock clients/publishers — no real SDK dependencies needed |
| `nats` package is ESM-only — shell hooks can't `require()` it | LOW | Shell hooks delegate to `bin/openclaw-extract-now.mjs` which is an ESM script |
| Python plugin requires `nats-py` which may not be installed | LOW | Python plugin uses subprocess fallback to `openclaw-extract-now.mjs`; documented in PUBLISHERS.md |
| Many new files (13 changed) in one step | MEDIUM | All files are small, independent, and follow the same pattern. Tests cover the shared publish-helper core. |

## §5 — Deferrals

- Health-watch launchd plist (`services/launchd/ai.openclaw.health-watch.plist`) — deferred to Block 5; not part of Step 4.9 frozen scope.
- `chmod +x` on shell scripts — sandbox constraint; operator applies manually post-commit.

## Mid-Implementation Findings

1. `.claude/hooks/pre-compact.sh` modification blocked by sandbox (same tooling constraint as Steps 4.7 and 4.8). Delta #11 dropped from this step — operator should manually update `.claude/hooks/pre-compact.sh` to delegate to `hooks/claude-code/pre-compact.sh` post-commit.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/publishers/publish-helper.mjs` | new | Shared NATS publish utility. `createNatsPublisher(opts)` → `{ publish(triggeredBy), close() }` with lazy NATS connection. `publishExtractDirect(nc, nodeId, triggeredBy)` for callers with existing nc. |
| 2 | `lib/publishers/openai-wrapper.mjs` | new | `wrapOpenAI(client, publisher)` — wraps `client.chat.completions.create` to fire extraction event post-response. Returns wrapped client. |
| 3 | `lib/publishers/anthropic-wrapper.mjs` | new | `wrapAnthropic(client, publisher)` — wraps `client.messages.create` to fire extraction event post-response. |
| 4 | `lib/publishers/gemini-wrapper.mjs` | new | `wrapGemini(model, publisher)` — wraps `model.generateContent` to fire extraction event post-response. |
| 5 | `lib/publishers/minimax-wrapper.mjs` | new | `wrapMiniMax(client, publisher)` — wraps `client.chat.completions.create` (OpenAI-compatible). |
| 6 | `bin/openclaw-extract-now.mjs` | new | Manual extraction CLI. Connects to NATS (`NATS_URL` env), publishes `mesh.memory.extract_request`, exits. `--triggered-by` flag. Exports `runExtractNow(opts)` for programmatic use. |
| 7 | `hooks/claude-code/pre-compact.sh` | new | Shell hook that calls `bin/openclaw-extract-now.mjs --triggered-by=claude-code-pre-compact`. |
| 8 | `hooks/openwebui/openclaw-publisher-plugin.py` | new | Python plugin. Subprocess call to `openclaw-extract-now.mjs` on message completion. |
| 9 | `hooks/librechat/openclaw-trigger.js` | new | Node.js trigger for LibreChat. Imports `publish-helper.mjs`, publishes on invocation. |
| 10 | `hooks/continue/openclaw-config.json` | new | Continue IDE config referencing extraction trigger endpoint. |
| 11 | `.claude/hooks/pre-compact.sh` | mod | Replace no-op stub with exec delegation to `hooks/claude-code/pre-compact.sh`. |
| 12 | `docs/PUBLISHERS.md` | new | Comprehensive documentation: Tier 1/2/3 integration guides, env vars, closed-app limitations, troubleshooting. |
| 13 | `test/publishers.test.mjs` | new | ~10 tests: publish-helper exports, publishExtractDirect with mock nc, error silencing, wrapper exports, wrapper proxy behavior with mock client+publisher, extract-now exports, hook file existence. |
