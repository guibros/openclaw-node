# OUT_OF_SCOPE — federation plan

Agnostic-spec capture of things observed while working this plan but not acted on (MASTER_PLAN
§4.3). WHAT + WHY, never HOW — no prescribed solution, no code excerpts. Always-writeable
regardless of scope. Reviewed at scope-closing checkpoints: each entry gets promoted into
SCOPE.md, escalated into INVENTORY.md, archived as won't-fix, or deferred forward.

Format per entry: date · area/file · one-line problem · severity guess · next-touch pointer.

---

- 2026-07-09 · INVENTORY.md:25-26,38,48 + GRANULAR_PHASE1.md:34 · step 0.1/1.2 contracts reference "DECISIONS D2" as the future crash-loop triage table, but D2 was consumed by the 2026-07-06 review decision (NATS trust floor) — the ledger id is taken, so 0.1's Verify contract points at the wrong entry · medium (a tick executing 0.1 would mis-file/mis-verify) · fix before 0.1 starts.
- 2026-07-09 · services/service-manifest.json + install.sh:794 · nats-{1,2,3} are absent from the service manifest and their plists live in services/nats/ while install.sh renders only services/launchd/ — the cluster units are orphaned from the install path, and g.1.1.d's "confirm all three are in the manifest" is a confirmation that is false today (they must be added, and the render loop doesn't reach them) · medium (step 1.1 task encodes a false precondition) · step 1.1.
- 2026-07-09 · GRANULAR_PHASE1.md T1.1.1 + DECISIONS D2 wording · "install.sh provisions OPENCLAW_NATS_TOKEN that nothing consumes" is imprecise: lib/nats-resolve.js:70,77,87 resolves it and passes opts.token client-side for every bin/ client — the real gap is server-side only (no authorization block in the .conf files). Security conclusion unchanged; the client half of g.1.1.h already exists · low (doc precision; D2 is append-only so needs a superseding note) · step 1.1 design phase.
- 2026-07-09 · plan naming vs lib/federation-startup.mjs, lib/federation-resilience.mjs, broadcast-emitter/offerer/acceptor, openclaw-status.mjs · the word "federation" is already occupied in code by the redesign's memory-broadcast layer (wired into the memory daemon; openclaw-status "federation wiring" means THAT layer) — the plan's fed.* probe family and plan name create a two-subsystems-one-name ops hazard, and the GRANULAR reality-anchor table omits this seventh neighbor · low-medium · 0.2 FEDERATION_SPEC naming section.
- 2026-07-09 · test-count citations · D1 + INVENTORY 2.1/3.1 say "40 tests"; g.2.2.b says "the existing 27" for collab-circling.test.js; actual top-level it() counts: collab-circling 31, daemon-circling-handlers 13 (their sum 44 matches g.3.1.c), circling-comprehensive 49 — the 40/27 constants match no current file, and 3.1's Verify contract cites "40 still green" · cosmetic (but it sits in a Verify contract) · 2.1/3.1 design.
