# AUDIT_POST — Step 0.2 · FEDERATION_SPEC.md

## §1 Promised-vs-landed ledger

| Promised (AUDIT_PRE §6) | Landed? | Where |
|---|---|---|
| `docs/FEDERATION_SPEC.md` created | **yes** | docs/FEDERATION_SPEC.md (509 lines) |
| Three mode flow-diagrams | **yes** | §3.1 (adversarial), §3.2 (cooperative), §3.3 (collaborative) |
| Task/result envelope schemas | **yes** | §5.1 (task), §5.2 (result) |
| Change-set envelope schema (for 5.2) | **yes** | §5.3 |
| Decomposition schema (for 4.1) | **yes** | §4.1 management session schema |
| Mode-selection guidance (for 3.4) | **yes** | §3.4 table |
| ≥10 file:line cross-refs | **yes** | 23 distinct refs in §9 cross-reference index |
| Substrate exec-path note (0.1 carry-forward) | **yes** | §2.2 mentions live install path assumption |
| VERSION walked pre→mid | **yes** | v0.2-pre (Ph1) → v0.2-mid (Ph4) |
| INVENTORY row flipped [ ]→[A] | **yes** | row 0.2 |

Every row **yes** → step is done.

## §2 Greppable deltas

- `grep -c "SUB-ROUND LOOP" docs/FEDERATION_SPEC.md` → 1 (adversarial flow diagram)
- `grep -c "PROPOSE\|DECOMPOSE" docs/FEDERATION_SPEC.md` → cooperative + collaborative
- `grep -c "envelope_type" docs/FEDERATION_SPEC.md` → 3 (task, result, change_set)
- `grep -c "mesh-collab.js:[0-9]" docs/FEDERATION_SPEC.md` → cross-ref index has 8 entries
- Total distinct file:line cross-refs: 23 (threshold ≥10 ✔)

## §3 Cross-refs still valid

- INVENTORY 0.2 Verify: "grep finds the three mode flow-diagrams, task/result envelope schemas, and ≥10 file:line cross-references" → satisfied. ✔
- INVENTORY 1.1 Needs "FEDERATION_SPEC (0.2)" → now resolves. ✔
- INVENTORY 5.2 Needs "change-set schema in FEDERATION_SPEC (0.2)" → §5.3 present. ✔
- INVENTORY 4.1 Needs "decomposition schema in FEDERATION_SPEC" → §4.1 management schema present. ✔
- INVENTORY 3.4 Needs "mode-selection guidance in FEDERATION_SPEC" → §3.4 table present. ✔

## §4 Findings

- **[POSITIVE]** All 23 file:line references grounded in grep-confirmed line numbers from this tick's read pass — no aspirational refs. The cross-reference index (§9) is a one-stop verifiability surface for future steps.
- **[POSITIVE]** The cooperative and collaborative flow diagrams are specified at the level needed for step 3.1's `architecture` field anchor without pre-deciding the exact message schemas of steps 3.2/3.3 — the right level of specificity.
- **[POSITIVE]** The change-set schema (§5.3) and write-jail invariant (§6.3) are specified before Block 5 coding — the gate-security property is explicit from the start, not retrofitted.
- **[POSITIVE]** Mode-selection guidance (§3.4) in the spec means step 3.4 is a codification of an already-decided table, not an open design question — reduces Phase-1 design time for that step.
- **[NEGATIVE / pre-existing]** 1 pre-existing test failure in `test/observer.test.mjs:36` (`observer.test.mjs` — interaction window logic). NOT introduced by this step (confirmed by stash/unstash baseline comparison). Out of federation scope.
- **[NOTE]** The cooperative and collaborative state schemas (round tracking, subtask tracking) are deferred to steps 3.2/3.3 per the §4 risk register decision — this was the right call; the spec's flow diagrams give enough for step 3.1 to land the `architecture` field.

## §5 Phase-8 patches

None. No architectural choice arose that wasn't already in DECISIONS. The one open item (savant telemetry collector mechanism — JetStream consumer vs periodic scrape) was deliberately deferred to step 5.1 per the spec text.

## §6 Carry-forwards to the next step (1.1 and Block 1)

- **To 1.1:** the spec's §2.1 confirms the adoption-and-harden framing (D2) — the cluster configs already exist; step 1.1 adds loopback + token enforcement. The cutover plan (4222 live bus with 14k+ JetStream msgs) is the main risk; the spec explicitly calls it a "production migration."
- **To 1.2:** §2.2 notes that `spawnNode()` at `bin/spawn-node.mjs:131` is the single code path for all node types — revival of mesh daemons uses the same logical-node pattern, just with the correct install path (D5 carry-forward satisfied).
- **To 1.3:** §2.4 provides the grappe manifest schema. The `openclaw-grappe` CLI implements against it.
- **To 1.4:** §5.1 defines the task envelope signing contract; §2.3 anchors the signing pattern at `lib/deploy-trigger-auth.mjs:58` + `lib/node-identity.mjs:374`. Step 1.4 implements against this.
- **To 3.1:** the `architecture` field anchor is in §3 preamble (same `lib/mesh-collab.js:54` `createSession()` schema, `circling` block stays null for non-adversarial modes).
- **To 4.1:** §4.1 management session schema is the design contract. The five stored roles follow the same pattern as circling's stored reviewer IDs (`lib/mesh-collab.js:105`).
- **To 5.1:** the telemetry sources (§6.1) are enumerated; collection mechanism remains an open DECISIONS item.
- **To 5.3:** §6.3 write-jail invariant must be implemented structurally — "no apply path outside OUT_OF_SCOPE" is verifiable by grep + the G1-G5 gate-security test cells.
