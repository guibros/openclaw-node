# OUT_OF_SCOPE — protocol plan

Agnostic-spec capture of things observed while working this plan but not acted on (MASTER_PLAN §4.3). WHAT + WHY, never HOW. Reviewed at scope-closing checkpoints: promote, escalate, archive, or defer.

Format per entry: date · area/file · one-line problem · severity guess · next-touch pointer.

---

- **2026-06-03 ~02:50 ET** · `lib/obsidian-{summarizer,link-checker,decision-notes,theme-notes}.mjs`, `lib/pre-compression-flush.mjs`, `bin/vault-check.mjs` + matching tests · A second headless claude session was editing these repair-plan-domain files concurrently while the protocol plan's steps were closing (tree clean at session start; mtimes 02:47–02:49; two `claude --output-format` PIDs live; no tick locks — so not the chain engine). Meanwhile `plans/repair/` shows BLOCKED.md present and SCOPE idle, i.e. work happening in repair's domain outside an active repair scope. Also observed: `test/obsidian-summarizer.test.mjs` "slug-colliding entities… (repair 2.9)" fails with SQLITE_ERROR under the full suite but passes 18/18 in isolation (twice) — flaky or mid-edit contention. · Severity: medium (scope-discipline + test-stability signal, no data risk) · Next touch: operator — reconcile the parallel session with repair's BLOCKED/idle state.
