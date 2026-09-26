# AUDIT — audit remediation 2026-09-26 (D3)

Batch `audit-remediation-2026-09-26` (SCOPE.md), operator-approved in session on 2026-09-26.
One batch on operator instruction: five defects the 2026-09-26 audit verified on main, plus making
enforcement opt-in. Steps 2.1 and 2.2 go back to `[A]`; no step closes here.

## §0 Re-orient

- **Where:** foreman plan, Block 2 (enforcement) re-opened; `VERSION` back to `v1.1`, the last step
  whose Verify ran as written. Next action is still step 1.2 (operator deploy-and-observe).
- **What changed last:** PR #27 (df503b3) merged Blocks 1+2 with enforcement on by default (D2).
- **What this contributes:** a supervisor that is safe to leave on everywhere (shadow) and a gate
  that does what D2 said it did when an operator turns enforcement on.
- **Still the right next step?** Yes — Block 2's runtime Verify cannot be run honestly on the
  code as merged: its gate completed unverified work.

## §1 Defects, re-verified on main (df503b3) before acting

| # | Defect | Evidence at df503b3 |
|---|---|---|
| 1 | No-metric completion inverted: no decision, or any decision but START_VERIFIER, completed the attempt unverified | `bin/mesh-agent.js:381` `if (!decision) return none;` · `:388` `if (decision.action !== 'START_VERIFIER') return none;` — `none` is the completion path at `:1873` |
| 2 | Verdict parser took the first match; `PASS/FAIL`, `PASS or FAIL will follow` parsed as PASS; the worker's output closed the verifier prompt | `lib/foreman/verifier.mjs:12` `/^\s*FOREMAN_VERDICT:\s*(PASS\|FAIL)\b.*$/im` with `text.match` at `:53`; `'Previous worker report (tail):'` last at `:41` |
| 3 | "Read-only" verifier could write, after the harness, straight into the commit; for `shell` it re-ran the task | `lib/llm-providers.js:96` `--permission-mode bypassPermissions`; harness at `bin/mesh-agent.js:1831` runs before `foremanVerify` (`:1873`); `commitWorktree` `git add -A` at `:665`; shell `buildArgs` runs `task.description` (`lib/llm-providers.js:197`) |
| 4 | One noisy sample stopped a worker | `lib/foreman/policy.mjs:88–111` STOP on a single `worker_stuck`/`work_off_track` ≥ 0.8; claude runs `--output-format text` (`lib/llm-providers.js:94`); git evidence used `git diff` / `git diff --name-only` (`lib/foreman/observation.mjs:52–53`), blind to staged and new files (reproduced in a scratch worktree: staged `a.txt` and untracked `new.txt` absent from `--name-only`) |
| 5 | A throw in `executeTask` leaked a supervisor that kept assessing; idle decisions counted toward the ceiling | no `try/finally` after `createTaskSupervisor` (`bin/mesh-agent.js:1753`); `schedule()` always re-armed the periodic timer (`lib/foreman/supervisor.mjs:168`); every non-CONTINUE decision counted (`:218`), and an idle cycle decides START_WORKER |

Also found on the way: 2.1's Verify (`sleep` in a shell task) could not run — the shell filter
refuses `sleep`; 1.2's Verify queried `hyperagent_telemetry` (the table is `ha_telemetry`).

## §2 Deltas

| File | Change |
|---|---|
| `lib/foreman/supervisor.mjs` | `enforce` defaults false; `MESH_FOREMAN_ENFORCE === '1'` enables; `MESH_FOREMAN_STOP_CONFIRMATIONS`; an idle loop never arms a timer and a timer never cycles an idle loop; decisions with no running worker do not count toward the ceiling; per-worker `warning_streak` over tree snapshots |
| `lib/foreman/policy.mjs` | `stop_confirmations` (3); STOP only once the streak reaches it, CONTINUE with `unconfirmed (n/K …)` before; `workerWarning()` shared with the supervisor |
| `lib/foreman/observation.mjs` | git evidence against `HEAD` plus untracked names; `treeSnapshot()` (the tree `git add -A` would commit, via a scratch index copy); `restoreTree()` |
| `lib/foreman/verifier.mjs` | exactly one verdict line or null (`reason`); worker report fenced as evidence, its verdict tokens neutralized, contract last |
| `lib/foreman/index.mjs` | exports `workerWarning`, `treeSnapshot`, `restoreTree` |
| `lib/llm-providers.js` | `shell.acceptsPrompt = false` |
| `bin/mesh-agent.js` | `foremanVerify` rewritten (ESCALATE releases; otherwise verify; snapshot/restore; strict verdict; escalation during the verifier releases; promptless providers complete on exit code); `superviseTask` + `runAttempts` split so every exit closes the supervisor; exports for tests |
| `services/launchd/ai.openclaw.mesh-agent.plist`, `services/systemd/openclaw-mesh-agent.service` | `MESH_FOREMAN_ENFORCE=${MESH_FOREMAN_ENFORCE}` |
| `scripts/install/services.sh`, `bin/openclaw-node-init.js` | both renderers map the new variable (unset → empty → shadow); `openclaw.env.example` documents it |
| `test/foreman-*.test.mjs`, `test/node-init-render.test.mjs` | new `foreman-verify-gate.test.mjs` (12); policy, verifier, observation, supervisor, enforcement suites updated and extended; the unit renders `MESH_FOREMAN_ENFORCE` empty unless set |
| docs | `docs/foreman.md`, `CLAUDE.md`, this silo's INVENTORY/ROADMAP/DECISIONS (D3)/COMPONENT_REGISTRY/VERSION/OUT_OF_SCOPE |

## §3 Evidence (code — this checkout, macOS, Node v24.13.0)

- `node --test test/foreman-*.test.mjs` → **88 pass / 0 fail** (assessment 9, assessor 6,
  enforcement 6, observation 11, policy 21, supervisor 13, verifier 10, verify-gate 12).
- Related suites (`node-init-render`, `llm-providers`, `grappe-worker-provider`,
  `wiring-manifest`, `hyperagent-integration`, all foreman) → 163 pass / 0 fail; after the
  render test was added, `node-init-render` alone → 12 pass / 0 fail.
- Renderers: node-init renders `MESH_FOREMAN_ENFORCE` empty when unset and `1` when set, in both
  units; the sed fallback renders it empty; `plutil -lint` on the plist template OK;
  `bash -n scripts/install/services.sh` OK.
- **Mutation check** — each fix reverted alone, the named suite rerun:

  | Reverted | Suite | Result |
  |---|---|---|
  | verdict: several lines accepted (first match) | verifier | 1 fail |
  | gate verifies only on START_VERIFIER | verify-gate | 7 fail |
  | no tree guard | verify-gate | 1 fail |
  | no `finally` close in `superviseTask` | verify-gate | 1 fail (before the test was hardened, the leaked loop hung the test process — the defect itself) |
  | idle loop polls (both guards removed) | supervisor | 1 fail |
  | idle decisions count toward the ceiling | supervisor | 1 fail |
  | no hysteresis | supervisor | 2 fail |
  | enforce by default | supervisor | 2 fail |
  | `shell` accepts prompts | verify-gate | 1 fail |

- Full `npm test`: see §3.1.

### §3.1 Full suite (`npm test`, this machine)

| Run | tests | pass | fail | skipped |
|---|---:|---:|---:|---:|
| baseline — unmodified `origin/main` (df503b3), before any edit | 2333 | 2327 | 2 (+ a suite-hook failure) | 4 |
| this batch, first run (other sessions' suites were sharing the live mesh) | 2381 | 2376 | 5 | 0 |
| this batch, final tree | 2380 | 2377 | 3 | 0 |

Every failure is outside the changed code. `install.sh --dry-run writes nothing under $HOME` and
`plan-protocol` "blocks a listed path that is a symlink escaping the repo" fail on unmodified main
here too (captured in `OUT_OF_SCOPE.md`). The rest were NATS request timeouts in live-mesh suites —
`collab-integration` ×3 on the first run, `agent-recruit` ×1 on the final — which load none of the
changed files and pass alone once the node's shared mesh is quiet (52/52 and 5/5). The baseline's
`circling-adaptive-convergence` ENOTEMPTY teardown failure did not recur; the 4 embedding-model
skips at baseline ran in the later runs. **Locally the suite is not green, before or after this
batch**; CI (Linux, hermetic NATS + daemon) is the green reference for the PR.

**Runtime-Evidence: none on the node.** Foreman has never run on the operator's node: probe
2026-09-26 21:30 UTC — `~/.openclaw/workspace/lib` resolves to the main checkout, which is on a
branch without `lib/foreman/`; `~/.openclaw/foreman/` does not exist; `ai.openclaw.mesh-agent` is
loaded with no PID. Every INVENTORY row this batch touches stays open until its `runtime:` Verify
is observed there.

## §4 Operator rulings (in session, 2026-09-26)

- Scope approved as proposed, **including the optional STOP hysteresis**.
- A no-metric `shell` task, enforcing, **completes on its exit code** (no verifier can take its
  prompt), rather than being released fail-closed.

## §5 Findings

- [POSITIVE] With shadow as the default, a node that never sets the variable behaves as before
  Foreman, plus timelines — the substrate D1 wanted, without D2's risk.
- [POSITIVE] The gate's decisive facts (verdict count, tree hash, exit code) are all mechanical;
  the assessor can only release (ESCALATE), never complete.
- [NEGATIVE] What the gate still cannot see is captured in `OUT_OF_SCOPE.md` (verifier writes
  outside the worktree, verifiers that cannot inspect the tree, single-sample `needs_human`,
  silent claude output, sticky escalation, unrendered units via `mesh deploy --include-services`).

## §6 Carry-forwards

1. **Step 1.2 (operator):** deploy a commit carrying D3 to the node, restart `ai.openclaw.mesh-agent`
   with `MESH_FOREMAN_ENFORCE` unset, run one real task, and check its timeline and
   `ha_telemetry.meta_notes` (`Foreman[shadow]`).
2. **Steps 2.1 / 2.2 (operator):** with `MESH_FOREMAN_ENFORCE=1` rendered into the unit (re-run the
   renderer — `mesh deploy --include-services` does not render), run the 2.1 idle-worker task and
   a 2.2 FAIL/PASS pair exactly as their Verify lines say; only then flip them to `[x]`.
