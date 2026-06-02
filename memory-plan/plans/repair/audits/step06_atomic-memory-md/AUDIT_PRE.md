# AUDIT_PRE — Step 1.6: MEMORY.md writes go through atomic-write (R39)

## §0 Re-orient
- Where am I: Block 1, step 6/8, 6/48 overall. Autonomous chain. Last code step before the operator-driven data repair.
- Last step changed: 1.5 — turn_index stamp (v1.5).
- This step contributes: MEMORY.md (the working-memory surface read by memory-budget reloads / companion-bridge) can never be observed half-written; closes the last write-race residue the tick guard (1.1) didn't structurally remove.
- Block serves the north star via: the readable surface must be trustworthy at every instant.
- Still the right next step? Yes.

## Intent
Three bare `fs.writeFileSync` sites on MEMORY.md (`pre-compression-flush` LLM + regex paths, `memory-budget #writeFile`) while other processes read the file. `lib/atomic-write.mjs` (tmp + fsync + rename, F-Q105 concurrent-writer-safe) exists for exactly this (FINDINGS R39).

## Design decisions
- `atomicWriteFileSync(path, content)` at all three sites. memory-budget's `#writeFile` keeps its mkdir via the helper's `mkdirp: true` (it created dirs before; preserve).
- No new tests mandated by the Proof (grep is the structural check; existing flush/budget tests exercise the new writer).

## File-delta outline
- `lib/pre-compression-flush.mjs`: import + 2 sites.
- `lib/memory-budget.mjs`: import + 1 site.

## Done-evidence contract (INVENTORY 1.6 Proof)
grep: zero bare `writeFileSync` on MEMORY.md paths in the three sites — all via atomic-write; one flush observed writing MEMORY.md intact; tests green.
