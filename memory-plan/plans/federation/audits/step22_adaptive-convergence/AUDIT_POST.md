# AUDIT_POST — Step 2.2 · Paper gap 14.1 — adaptive convergence (unanimous converged ⇒ early finalization)

**Closed:** 2026-07-11 (tests green + runtime evidence observed)

## §1 Promised-vs-landed ledger

| Promised (AUDIT_PRE §6) | Landed? | Where |
|---|---|---|
| audits/step22_adaptive-convergence/AUDIT_PRE.md | **yes** | prior phase |
| audits/step22_adaptive-convergence/AUDIT_POST.md | **yes** | this file |
| VERSION: v2.2-pre → v2.2-mid → v2.2 | **yes** | each phase |
| INVENTORY.md: flip 2.2 `[ ]` → `[A]` → `[x]` | **yes** | prior phase / phase 9 |
| COMPONENT_REGISTRY.md: adaptive convergence noted | **yes** | phase 9 |
| lib/mesh-collab.js: JSDoc comment fix (state machine diagram) | **yes** | phase 4 |
| test/circling-adaptive-convergence.test.mjs (NEW) | **yes** | phase 4 |

## §2 Greppable deltas

**lib/mesh-collab.js — JSDoc comment (7 lines, was 6):**
- `grep "paper §14.1 early exit" lib/mesh-collab.js` → line 725: `*   circling/step2, all converged, SR < max → finalization/step0  (paper §14.1 early exit)`
- Adds 2 lines to the state machine diagram; no logic changes.

**test/circling-adaptive-convergence.test.mjs (NEW — 291 lines):**
- Suite 1 (unit, 5 tests): `grep "advanceCirclingStep — adaptive convergence (paper §14.1)" test/circling-adaptive-convergence.test.mjs` → line 77
- Suite 2 (NATS integration, 1 test): `grep "adaptive convergence integration (real NATS KV)" test/circling-adaptive-convergence.test.mjs` → line 232

**Test results:**
```
npm test → 1724 pass / 2 fail (observer.test.mjs, embed-benchmark.test.mjs pre-existing) / 1 skipped
node --test test/circling-adaptive-convergence.test.mjs → 6 pass / 0 fail
```

**Runtime evidence (NATS integration test output):**
```
[step22-runtime] session=collab-step22-rt-001-1783749418240
  max_subrounds=3
  finalized_after_sr=1
  phase=finalization
  skipped_subrounds=2
```

Session with max_subrounds=3 reached finalization after SR1, skipping SR2 and SR3. KV confirmed:
`stored.circling.phase === 'finalization'`, `stored.circling.current_subround === 1`.

## §3 Cross-refs still valid

- INVENTORY 2.2 Needs "2.1 baseline" — COMPONENT_REGISTRY Family 2 LIVE (step 2.1) ✓
- INVENTORY 2.2 Needs "lib/mesh-collab.js advanceCirclingStep" — present at line 729, early-exit branch at 750-755 ✓
- INVENTORY 2.2 Verify `code:` — 5 unit tests, all pass ✓
- INVENTORY 2.2 Verify `runtime:` — NATS integration test observed: max_subrounds=3 → finalized after SR1 ✓
- INVENTORY 2.2 Feeds "2.4 uses it live" — early-exit now tested and confirmed ✓

## §4 Findings

- **[POSITIVE]** The early-exit branch was already present in `advanceCirclingStep` (lines 750-755) — it predates this step. The 2.1 run used max_subrounds=1 so the branch never fired (1 < 1 = false). This step proved it works correctly by testing the max_subrounds > 1 case for the first time.
- **[POSITIVE]** JSDoc comment correctly documents all 4 transitions now. The omitted "early exit on unanimous converge" case was the only misleading part.
- **[POSITIVE]** NATS integration test: session collab-step22-rt-001 in real JetStream KV shows finalization after SR1 with max_subrounds=3 (skipped_subrounds=2). Token budget benefit confirmed: 2 subrounds (~4 GPU-min each on D3's math) saved when consensus is unanimous.
- **[NOTE]** The integration test starts an ephemeral nats-server on port 14879 via the same pattern as federation-2node.test.mjs. Port chosen to avoid conflict with the live :4222 bus.

## §5 Phase-8 patches

None.

## §6 Carry-forwards to the next step

- **To 2.3 (parse-failure retry):** The retry mechanism is in the daemon reflect handler (a separate path from `advanceCirclingStep`). Carry-forward from 2.1 remains: the `checkRecruitingDeadlines` auto-assign patch is in place. 2.3 adds retry on `artifact_failures` count before degradation.
- **To 2.4 (first real LLM run):** With 2.2's early-exit confirmed, a real session that converges quickly will save GPU-minutes. 2.4 should record `current_subround` at completion to measure the actual early-exit rate in practice.
- **To all Block 2:** Test baseline is 1724 pass / 2 fail / 1 skip. The 2 pre-existing failures (observer.test.mjs, embed-benchmark.test.mjs) are unchanged.
