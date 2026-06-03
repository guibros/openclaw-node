# AUDIT_PRE — Step 2.2: One slugify behavior for writers + UI route (R7)

## §0 Re-orient
- Where am I: Block 2, step 2/11, 10/48 overall. Autonomous chain.
- Last step changed: 2.1 — writers transparent (v2.1).
- This step contributes: the content browser stops lying about long-named concepts ("No concept note written yet" for notes that exist).
- Block serves the north star via: the UI must resolve the same filenames the writers produce — referential integrity at the render layer.
- Still the right next step? Yes.

## Intent
Writer `slugifyName` (obsidian-summarizer, imported by promoter) is uncapped; the mission-control route's mirror adds `.slice(0, 60)` → >60-char slugs resolve to filenames that were never written (FINDINGS R7).

## Proof-gate substitution (documented per the v2 structure rule)
The INVENTORY gate said "single definition imported by both sides." Verified impossible cleanly: the runtime mission-control is a **file-copy deploy** (not a symlink), so one relative import path cannot resolve in both trees (repo: 5 levels up; runtime: 6). Substituted gate of equal strength: **byte-equivalent mirror + a source-parity test** (`test/slugify-parity.test.mjs`) that extracts the route's function from source, executes it, and battery-asserts equality with `slugifyName` (incl. >60-char names) plus a no-`.slice(` regression lock — the same source-assertion pattern as the wiring-manifest. Same precedent as redesign 0.2's done-evidence refinement.

## Design decisions
- Route mirror becomes the identical replace-chain (drop the cap, keep the `-+` collapse so the two are textually parallel).
- Runtime deploy via file copy (the established mission-control model); Next dev hot-reloads.
- Runtime render proof: seed a >60-char-named entity, write its note via the real writer (client:null), query `/api/memory-content` → prose present; clean up the seed.

## File-delta outline
- `mission-control/src/app/api/memory-content/route.ts`: the mirror.
- `test/slugify-parity.test.mjs` (new).

## Done-evidence contract (INVENTORY 2.2 Proof, substituted)
Parity test green over a hostile battery; >60-char concept renders its prose via the live API (was "No concept note"); no-cap regression locked.
