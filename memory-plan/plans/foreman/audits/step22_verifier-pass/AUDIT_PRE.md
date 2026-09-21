# AUDIT_PRE — step 2.2 · Independent verifier pass

## §0 Micro Re-Orient
- **Where:** foreman plan, Block 2, step 2.2 of 2; closes the block.
- **Last step changed:** 2.1 made STOP/ESCALATE act.
- **This step contributes:** completion of no-metric tasks is gated by an independent verification worker's verdict.
- **North-star line served:** MASTER_PLAN §5 spirit applied to worker output — "the worker said so" is not verification.
- **Still the right next step?** Yes — today the no-metric branch completes on the worker's word alone.

## §1 Intent
After a clean exit on a task with no metric, the supervisor's post-exit decision can run a read-only verifier whose `FOREMAN_VERDICT` gates completion; FAIL retries with the findings.

## §2 Design (D2)
`lib/foreman/verifier.mjs` (mission prompt + verdict parser); `foremanVerify()` in the agent: `assessNow()` → ESCALATE → release; START_VERIFIER → `workerStarted({kind:'verifier'})`, `runLLM(verifier prompt)`, `parseVerdict`, `recordVerification({workerId})`; FAIL/no verdict → failed attempt → retry.

## §3 Risk register
| Risk | Mitigation |
|---|---|
| Verifier edits the tree despite the rule | read-only instruction; the retry re-runs the coder anyway; same worktree, so any edit is visible in the diff |
| No verdict line | counts as FAIL (no verdict, no verification) |
| Verifier cost on every no-metric task | only when the policy asks (`needs_verification ≥ 0.65` and `implementation_complete ≥ 0.75`) |

## §6 File-delta outline
- `lib/foreman/verifier.mjs`, `lib/foreman/index.mjs` export, `recordVerification({workerId})`
- `bin/mesh-agent.js`: `foremanVerify` + the no-metric branch
- `test/foreman-verifier.test.mjs`; enforcement test for `recordVerification({workerId})`
