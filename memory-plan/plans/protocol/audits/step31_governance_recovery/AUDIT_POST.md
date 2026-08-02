# AUDIT_POST — step 3.1 · Governance recovery

## §1 Promised vs landed

| Promised (AUDIT_PRE §6) | Actual | Landed |
|---|---|---|
| Protocol control plane | Added Block/step 3.1, D8, current registry, bounded scope, audit pair, and coherent VERSION lifecycle | yes |
| Federation truth | Retired the expired 85-entry allow-list, reopened unmet step 2.6 at `v2.6-pre`, preserved 3.5/6.2/6.3 as unfinished, and recorded D14 | yes |
| HyperAgent truth | Retired the expired scope and recorded the live-but-evidence-empty substrate, down worker path, design-only companion lane, and unsigned cohort | yes |
| Public status | README no longer describes retired prompt rules; CLAUDE.md and AGENTS.md now carry the 2026-08-02 frontier and runtime findings | yes |
| Runtime repair separation | Seven concrete defects were recorded in protocol OUT_OF_SCOPE without changing runtime code | yes |

## §2 Greppable deltas

- `workspace-bin/plan-lint.sh protocol` -> `15 PASS / 1 WARN / 0 FAIL` after scope close,
  CONFORMANT. During execution the active-scope checks made this `18 PASS / 2 WARN / 0 FAIL`.
- `workspace-bin/plan-lint.sh federation` -> `15 PASS / 1 WARN / 0 FAIL`, CONFORMANT.
- `workspace-bin/plan-lint.sh hyperagent-evidence` -> `14 PASS / 2 WARN / 0 FAIL`, CONFORMANT.
- Full-silo check -> legacy and redesign CONFORMANT; repair remains NONCONFORMANT with 3 inherited
  control-plane FAILs (`automation.json`, `TICK_PROMPT.md`, `tick-logs/`), recorded out of scope.
- `workspace-bin/plan-tick.sh federation --preflight` -> next step `2.6`, VERSION `v2.6-pre`.
- `workspace-bin/plan-tick.sh hyperagent-evidence --preflight` -> next step `2.1`, VERSION `v2.0`.
- `workspace-bin/plan-tick.sh protocol --preflight` after close -> VERSION `v3.1`, next step
  `NONE - all steps closed`, CONFORMANT.
- `node --test test/plan-protocol.test.mjs` -> 9/9 pass, 0 fail.
- Host-level `node bin/openclaw-stack.mjs status` -> workplan viewer LIVE, PID 56252, port 7892
  open; sandbox-local process/loopback probes are not valid host-liveness evidence.
- Live `GET :7892/api/plans/protocol/registry` -> `present:true`, 3 families / 8 components,
  including the recovered scope and `v2.6-pre` federation frontier.
- Scope scan during execution -> one unexpired active scope and one open file block; v3.1 closure
  marks that block closed and leaves zero active scopes.
- `git diff --check` -> clean; changed paths are governance, audit, registry, and public docs only.

## §3 Cross-references

- Protocol D8 points to federation 2.6 before 3.5 and HyperAgent 2.1.
- Federation D14, INVENTORY, VERSION, and COMPONENT_REGISTRY all name the same `v2.6-pre` frontier.
- HyperAgent COMPONENT_REGISTRY agrees with its inventory: 2.1 is next; companion I1-I5 remains
  design-only and does not silently become a mesh-primary prerequisite.
- README, CLAUDE.md, and AGENTS.md distinguish live substrate from worker-cluster or improvement proof.

## §4 Findings

- [NEGATIVE->fixed] Three expired scopes were still labeled active, and the federation scope exposed
  85 stale writable paths. All historical blocks were retired; the recovery used one bounded block.
- [NEGATIVE->fixed] Federation VERSION `v6.3` concealed the unmet written 2.6 contract. D14 restores
  the real resume point while preserving the July one-task result as qualified evidence.
- [NEGATIVE->fixed] Root documentation described removed prompt-assisted HyperAgent rules as current.
  The documented flow now matches the explicit CLI synthesis and CLI-only approval implementation.
- [NEGATIVE->queued] Fresh probes found consolidation, NATS auth/naming, heartbeat, nested Sharp,
  watcher-truth, and HyperAgent operator-text defects. They are evidence for the next scope, not
  opportunistic additions to this governance batch.
- [NEGATIVE->queued] Repair v7.8 is implementation-complete but lacks three viewer/automation
  artifacts required by the newer protocol. This is a conformance retrofit, not a reopened repair.
- [POSITIVE] The plan engine now gives an unambiguous cold-start path: runtime repair, federation
  2.6, federation 3.5, then management; HyperAgent 2.1 may preregister the mesh-primary cohort in
  parallel once workers are viable.

## §5 Phase-8 patches

No implementation patch was needed. Verification corrected only final-state wording and audit
cross-references inside the approved governance scope.

## §6 Carry-forwards

1. Open one bounded runtime-repair scope: fix the consolidation idle gate, NATS client auth and
   local stream-name sanitization, scheduler-heartbeat authentication, nested Sharp dependency tree,
   watcher process/freshness truth, and HyperAgent CLI operator text.
2. Restore authenticated D11 advanced-LLM workers and observable grappe membership.
3. Execute federation 2.6 as five comparable blinded tasks with equivalent models/tools and costs.
4. If 2.6 passes, execute 3.5's matrix, eight chaos cells, 12-hour soak, and T7 acceptance.
5. Preregister HyperAgent 2.1 before cohort tasks; do not tune thresholds before cohort evidence.
6. Separately retrofit repair's missing protocol surfaces when archived-plan conformance is worth
   the maintenance cost.

## Feeds landing (Phase 9)

The corrected plan carriers feed every cold pickup and the workplan viewer. The root status docs feed
operators and external readers. The runtime findings feed the next bounded repair scope. Federation
2.6 and HyperAgent 2.1 now consume explicit prerequisites rather than inherited narrative state.
