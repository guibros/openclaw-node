# AUDIT_POST — Step 2.5: Checker on the synthesis cadence + surfaced (R9)

(§0: Block 2, step 5/11, 13/48; turns the 2.4 instrument from manual to automatic; still-right-next: yes.)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `packages/event-schemas/src/memory/synthesized.ts` | ✓ | optional `vault_integrity` object (6 nonneg ints); dist rebuilt (publishLocal validates against dist). |
| `lib/pre-compression-flush.mjs` | ✓ | `checkVaultLinks()` after the synthesis chain, non-fatal try/catch; counts in the synthesis return. |
| `workspace-bin/memory-daemon.mjs` | ✓ | `emitSynthesizeEvent` passes `vault_integrity` through when present. |
| `test/event-schemas.test.mjs` | ✓ | +1 validation case with the counts. |

## Verification (Phase 5 — the Proof)

- **Tests:** 46/46 (schemas + flush integration files).
- **Runtime (live daemon, synthesisMs 60s temporarily, reverted after):** a real interval-synthesis flush emitted `memory.synthesized status=ok` whose payload carries `vault_integrity {notes 76, links 1264, resolved 503, slug_resolvable 204, dangling 557, orphans 29}` — **byte-identical** to a manual `bin/vault-check.mjs --json` run and to what `GET /api/watcher?op=memory.synthesized` serves (the watcher detail panel renders payloads verbatim, so the counts are on the mission-control surface with zero UI changes). Daemon restarted back on the default config (PID 14804).

## Findings

1. **`findCurrentJsonl` has a 50KB floor** — sessions under 50KB are never selected for interval synthesis/NATS flushes. Cost an hour of llm-dedup confusion during verification (the daemon was correctly deduping a big unchanged workspace session while the small fixture was invisible). Not a defect per se (the floor skips trivial sessions deliberately) but **undocumented and it interacts with the dedup** such that small sessions never flush on the interval path — captured to OUT_OF_SCOPE for triage.
2. The fixture session was padded to 56KB with labeled verification content to cross the floor — it remains the designated test session.

## Carry-forwards
- The dangling count (557) includes the fixture's own session-note links; 2.6/2.8 work from live numbers that now update per flush.
