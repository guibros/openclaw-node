# OUT_OF_SCOPE — openviking-adopt plan

Agnostic-spec capture of things observed while working this plan but not acted on (MASTER_PLAN
§4.3). WHAT + WHY, never HOW — no prescribed solution, no code excerpts. Always-writeable
regardless of scope. Reviewed at scope-closing checkpoints: each entry gets promoted into
SCOPE.md, escalated into INVENTORY.md, archived as won't-fix, or deferred forward.

Format per entry: date · area/file · one-line problem · severity guess · next-touch pointer.

---

- **2026-09-21 · Obsidian vault decision surfaces (`lib/obsidian-{decision-notes,session-notes,summarizer,link-checker}.mjs`)** · Block 3 excludes superseded decisions from recall (injector, decision-FTS channel) and from MEMORY.md, but the vault note generators still list every decision row, so a superseded decision keeps a note beside its successor. · Severity: low (browsing surface only; recall is correct) · Next touch: a small follow-up that renders supersession in the decision note (a "superseded by [[…]]" line) rather than hiding the row.
- **2026-09-21 · `memory.extracted` event payload** · The flush result now carries the typed-merge counts (`entities_new`, `aliases_resolved`, `decisions_superseded`, `known_entities`), but `workspace-bin/memory-daemon.mjs` `emitExtractEvent` copies named fields only and `packages/event-schemas` does not declare them, so the watcher cannot see them yet. Step 3.2's runtime Verify therefore reads the tables, not the event. · Severity: low · Next touch: extend the event schema + emitter in a schema-bump step.
- **2026-09-21 · consolidation archive vs aliases** · When consolidation archives an entity (`entities_archived`) its `entity_aliases` rows are cascade-deleted (FK ON DELETE CASCADE), so a resurrected entity comes back without its aliases. · Severity: low · Next touch: archive aliases alongside the entity in `lib/consolidation.mjs` when Block 3 closes on the node.
- **2026-09-21 · LoCoMo memory-quality benchmark** · The review recommended running LoCoMo against the inject server; OpenViking's `benchmark/` harness is under its AGPL root. Needs a live LLM + embedder, so it cannot run in the authoring container. · Severity: medium (no memory-quality baseline exists) · Next touch: a separately scoped benchmark step on the node, with a license check on any reused harness code.
