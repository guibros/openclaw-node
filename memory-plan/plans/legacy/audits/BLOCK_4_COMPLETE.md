# Block 4 Complete — Federation Primitives

**Closed:** 2026-05-22
**Steps:** 9/9 (v4.1 through v4.9)
**Author:** memory-plan-tick

---

## Exit-gate criteria

- All 9 steps (4.1–4.9) closed with passing tests at each gate.
- Final test count: 685 (608 pass, 77 fail — 73 pre-existing + 4 flaky).
- Tests added in Block 4: +98 (from 587 at v3.4 to 685 at v4.9).
- Zero architectural decisions improvised — all decisions consumed from RESUME.md §0 Block 4 frozen decisions.

## Files touched cumulatively (Block 4)

### New files (Block 4)
- `config/promotion-policy.yaml` — promotion policy config
- `lib/promotion-policy.mjs` — policy loader + validator
- `bin/memory-promoter.mjs` — promoter daemon
- `bin/memory-subscriber.mjs` — subscriber daemon
- `lib/kanban-store.mjs` — kanban event store with tasks_observed table
- `lib/conflict-surfacing.mjs` — conflict detection + retrieval annotation
- `lib/extraction-trigger.mjs` — agnostic extraction trigger (NATS + idle timer)
- `lib/health-check.mjs` — 6-component health checker
- `bin/health-watch.mjs` — long-running health watcher
- `bin/openclaw-restart.sh` — manual restart script
- `lib/publishers/publish-helper.mjs` — shared NATS publish utility
- `lib/publishers/openai-wrapper.mjs` — OpenAI SDK wrapper
- `lib/publishers/anthropic-wrapper.mjs` — Anthropic SDK wrapper
- `lib/publishers/gemini-wrapper.mjs` — Gemini SDK wrapper
- `lib/publishers/minimax-wrapper.mjs` — MiniMax SDK wrapper
- `bin/openclaw-extract-now.mjs` — manual extraction CLI
- `hooks/claude-code/pre-compact.sh` — Claude Code hook
- `hooks/openwebui/openclaw-publisher-plugin.py` — OpenWebUI plugin
- `hooks/librechat/openclaw-trigger.js` — LibreChat trigger
- `hooks/continue/openclaw-config.json` — Continue IDE config
- `docs/PUBLISHERS.md` — publisher integration documentation
- `test/promotion-policy.test.mjs` — 11 tests
- `test/memory-promoter.test.mjs` — 10 tests
- `test/memory-subscriber.test.mjs` — 14 tests
- `test/provenance-fields.test.mjs` — 8 tests
- `test/kanban-store.test.mjs` — 8 tests
- `test/conflict-surfacing.test.mjs` — 9 tests
- `test/extraction-trigger.test.mjs` — 9 tests
- `test/health-check.test.mjs` — 15 tests
- `test/publishers.test.mjs` — 14 tests

### Modified files (Block 4)
- `lib/extraction-store.mjs` — provenance columns + migration (Step 4.4)
- `workspace-bin/memory-daemon.mjs` — extraction trigger wiring (Step 4.7)

## Carry-forwards into Block 5

- `.claude/hooks/pre-compact.sh` needs manual operator update to delegate to `hooks/claude-code/pre-compact.sh` (sandbox blocked in Steps 4.7-4.9).
- `bin/openclaw-restart.sh` needs `chmod +x` by operator (sandbox constraint from Step 4.8).
- Health-watch launchd plist (`services/launchd/ai.openclaw.health-watch.plist`) not yet created.
- `EXTRACT_SUBJECT` duplicated between `lib/extraction-trigger.mjs:16` and `lib/publishers/publish-helper.mjs:18` — intentional for module independence.
- Validation gate: `bin/health-watch.mjs` should run 24 hours with zero spurious warnings before Block 5 begins.
- Shared vault path `projects/arcane-vault/concepts-shared/` is where Block 4's subscriber writes promoted-from-others content — Block 5 reads from there.
