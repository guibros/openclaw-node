# AUDIT_POST — Step 2.3 · Paper gap 14.2 — parse-failure retry ×3 before degradation

**Closed:** 2026-07-11 (tests green + runtime evidence observed)

## §1 Promised-vs-landed ledger

| Promised (AUDIT_PRE §6) | Landed? | Where |
|---|---|---|
| audits/step23_parse-retry/AUDIT_PRE.md | **yes** | prior phase |
| audits/step23_parse-retry/AUDIT_POST.md | **yes** | this file |
| VERSION: v2.3-pre → v2.3-mid → v2.3 | **yes** | each phase |
| INVENTORY.md: flip 2.3 `[ ]` → `[A]` → `[x]` | **yes** (→[x] at Phase 9) | prior phases + phase 9 |
| bin/mesh-task-daemon.js: retry logic before submitReflection | **yes** | phase 4 |
| bin/mesh-task-daemon.js: `retryCirclingNodeStep` helper | **yes** | phase 4 |
| test/daemon-circling-handlers.test.js: updated `simulateReflectHandler` | **yes** | phase 4 |
| test/daemon-circling-handlers.test.js: updated parse_failed tests | **yes** | phase 4 |
| test/circling-parse-retry.test.mjs (NEW — 5 tests) | **yes** | phase 4 |
| COMPONENT_REGISTRY.md: step 2.3 noted | **yes** | phase 9 |

## §2 Greppable deltas

**bin/mesh-task-daemon.js — new `retryCirclingNodeStep` function:**
- `grep "retryCirclingNodeStep" bin/mesh-task-daemon.js` → line 873: `async function retryCirclingNodeStep(sessionId, nodeId, failCount, preSession)`
- `grep "CIRCLING RETRY" bin/mesh-task-daemon.js` → line 882: `log(\`CIRCLING RETRY: ${nodeId} in ${sessionId} (parse failure ${failCount}/2, attempt ${failCount + 1})\`)`
- `grep "parse_retry" bin/mesh-task-daemon.js` → line 895: `parse_retry: failCount`

**bin/mesh-task-daemon.js — retry gate in handleCollabReflect:**
- `grep "failCount < 3" bin/mesh-task-daemon.js` → line 921
- `grep "Retry: resend" bin/mesh-task-daemon.js` → line 922

**test/daemon-circling-handlers.test.js — updated simulation:**
- `grep "paper §14.2" test/daemon-circling-handlers.test.js` → line 99 + 106 + 214
- `grep "degraded" test/daemon-circling-handlers.test.js` → lines 116, 261, 262, 263

**test/circling-parse-retry.test.mjs (NEW):**
- Suite 1 (unit, 4 tests): `grep "parse-failure retry (paper §14.2)" test/circling-parse-retry.test.mjs` → line 119
- Suite 2 (NATS integration, 1 test): `grep "double parse failure" test/circling-parse-retry.test.mjs` → line 293

**Test results:**
```
npm test → 1729 pass / 2 fail (observer.test.mjs, sampleLayers pre-existing) / 1 skipped
node --test test/circling-parse-retry.test.mjs → 5 pass / 0 fail
```
(Baseline was 1724+5=1729 pass; pre-existing 2-fail pattern unchanged.)

**Runtime evidence (NATS integration test output):**
```
[step23-runtime] session=collab-task-retry-test-rt-001-1783750452601
  worker_parse_failures=2
  failure_count_at_step1=2
  degraded=false
  worker_artifact_present=true
  barrier_advanced=true
```

Worker sent `parse_failed: true` twice → retry events emitted, barrier NOT advanced either time (0 reflections in round). Worker succeeded on 3rd attempt → artifact stored in KV. All 3 nodes eventually submitted → barrier advanced (step1→step2). No degradation (failure count stayed at 2, never 3).

## §3 Cross-refs still valid

- INVENTORY 2.3 Needs "2.1 baseline" — COMPONENT_REGISTRY Family 2 LIVE (steps 2.1+2.2) ✓
- INVENTORY 2.3 Needs "daemon reflect handler" — bin/mesh-task-daemon.js handleCollabReflect ✓
- INVENTORY 2.3 Needs "failure tracking" — collabStore.recordArtifactFailure() ✓
- INVENTORY 2.3 Verify `code:` — 4 unit tests covering all 4 cases ✓
- INVENTORY 2.3 Verify `runtime:` — NATS integration test observed double-failure+success completing ✓
- INVENTORY 2.3 Feeds "real-LLM reliability for 2.4" — retry path now tested and confirmed ✓

## §4 Findings

- **[POSITIVE]** `retryCirclingNodeStep` reuses `compileDirectedInput` exactly as `startCirclingStep` does — consistent context to the retried node.
- **[POSITIVE]** The pre-submit parse_failed check (before `submitReflection`) cleanly separates retry from degrade without needing a rollback API.
- **[POSITIVE]** `getArtifactFailureCount` is step-keyed (`nodeId_srX_stepY`) — failure counts don't bleed across steps. This is correct and was confirmed by the test-assertion fix (checking count before `advanceCirclingStep` moves the key).
- **[NOTE]** The step-keyed counter means a node that failed 2× on step1 and then succeeds will show failure_count=0 on step2 — which is correct (fresh step, fresh slate). Tests check the count at step1 explicitly.
- **[POSITIVE]** Existing `daemon-circling-handlers.test.js` now accurately reflects the new behavior; the old "parse_failed still counts toward barrier" test was replaced with two tests that describe the correct behavior.

## §5 Phase-8 patches

None.

## §6 Carry-forwards to the next step

- **To 2.4 (first real LLM run):** Retry is now live. 2.4 should:
  - Use `max_subrounds ≥ 2` (retry + early-exit both exercised if LLM parses cleanly)
  - Record `failure_count` at session end for D3's "GPU-min/session" planning data
  - `parse_retry` field is available in the round message — future improvement: add a "Your previous response could not be parsed. Try again." hint in the prompt, but this is out of scope for 2.4.
- **To all Block 2:** Test baseline is 1729 pass / 2 fail / 1 skip.
