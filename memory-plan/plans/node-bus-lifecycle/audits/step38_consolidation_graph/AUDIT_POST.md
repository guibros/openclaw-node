# Step 3.8 — Post-implementation audit

## 1. Promised vs landed

| AUDIT_PRE §6 delta | Landed | Evidence |
|---|---|---|
| Private release assembly, source/dependency graph, native and child manifest | yes | `workspace-bin/stage-consolidation-graph.mjs`; corrected loaded-Node release manifest SHA-256 `6159fb51b28dfc6834962c95afc61fac609cdb758438616a68928290049ddab8` |
| Exact Node-22 dependency closure | yes | `workspace-bin/consolidation-graph-package.json` and lock; 46 package paths, each retained by path and root-lock version/integrity; private `npm audit` reports zero advisories |
| Graph/staging failure controls | yes | `test/consolidation-graph.test.mjs` passes 1/1 on Mac; generated-file and native-binary mutation refuse |
| Owned real-entry probe, runtime record and post-audit | yes | `probe.mjs` and `RUNTIME_EVIDENCE.md`; private JetStream events, model-backed note, foreground notifier and negative controls observed |
| Silo status and decision ledger | yes | `INVENTORY.md`, `VERSION`, `COMPONENT_REGISTRY.md`, `DECISIONS.md` D24 |

## 2. Greppable deltas

- `rg -n 'function scanGraph|function checkLock|function verifyRelease|function stageRelease' workspace-bin/stage-consolidation-graph.mjs`: first hit `57:export function scanGraph`; later hits validate lock paths, actual native loading and private assembly.
- `rg -n '"better-sqlite3"|"nats"|"typescript"' workspace-bin/consolidation-graph-package.json`: first hit `5: "better-sqlite3": "11.10.0"`.
- `rg -n 'private consolidation graph|dependency path|generated|native' test/consolidation-graph.test.mjs`: first hit `9:const nativeMac`; the Mac test compares lock paths and refuses selected/other native drift.
- `rg -n 'NATS connected|llmHits|brokenSchema|notifierFinished|checkRelease' memory-plan/plans/node-bus-lifecycle/audits/step38_consolidation_graph/probe.mjs`: first hit `37:let llmHits = 0`; the probe also asserts the loaded launchd program.
- `git diff 159b8dd HEAD -- bin/consolidation-scheduler.mjs lib/consolidation.mjs packages/event-schemas/src`: no accepted 3.2 consolidation source delta.

## 3. Cross-references

The step's `INVENTORY.md` §11 Goal/Needs/Feeds/Verify, `AUDIT_PRE.md` §6, D24 and this audit agree: 3.8 stages a private graph, while 3.9 owns the protected launch entries and real notifier. The corrected release lives at `/Users/moltymac/.openclaw/backups/node-readiness/consolidation-graph-20260930-4`; its manifest names the scheduler, every scanned first-party edge, installed file hash, loaded Node 24 ABI, actual SQLite binding, other native build file and foreground notifier child. The captured runtime proof is in `RUNTIME_EVIDENCE.md`. The stage script and tracked lock reproduce the release for 3.9/3.11. The primary workspace, shared dependencies and production timers were untouched.

## 4. Findings

- [POSITIVE] The loaded timer's Node 24.13.0 loads the private `better-sqlite3` binary and executes SQLite 3.49.2. The second native build file is also inventoried and hashed. Generated event-schema output is byte-identical across two locked builds.
- [POSITIVE] The argv-less scheduler from cwd `/` completed a real private cycle, published two retained JetStream events, called the owned model and wrote a concept note. A failure ran the foreground private notification child before exit.
- [POSITIVE] Stale/busy snapshots caused no fixture DB change; corrupted schema dist produced a misleading scheduler exit 0 but no NATS connection/events, and the probe rejected it. Source, installed dependencies, Node and lock hashes stayed unchanged through the run.
- [POSITIVE] Claude's exact-source review found a bare-parent path acceptance and nested dependency identity loss. Both are fixed; the test requires manifest dependency paths to equal every staged lock package path.
- [POSITIVE] Claude's exact-diff review of the loaded-Node correction found no blocker after tracing the launchctl-to-manifest-to-ABI checks, actual `process.dlopen` selection and the extra-native drift assertion.
- [NEGATIVE] Mission Control's high-severity dependency audit is red on this PR and on unmodified `main` run 36780863183; its lint and 129 tests pass. This unrelated baseline issue is recorded, not treated as proof that the 3.8 code failed.
- [NEGATIVE] `plan-lint.sh node-bus-lifecycle` reports 12 PASS / 2 FAIL because this silo has no `automation.json` or `tick-logs/`; both omissions predate this step. Its inventory, audit coverage, version and canonical-document checks pass.
- [NEGATIVE] The first closeout misidentified a Node 22 binary as the loaded timer Node. Read-only launchd/plist inspection showed Node 24 and live scheduler source drift. The Node 22 release remains historical cross-version evidence, but the Node 24 release and its rerun are the only accepted loaded-interpreter baseline. No live source swap occurred.
- [LIMIT] The queue is fixture-supplied, and the private notifier is a stub for the OS popup. The probe does not establish production timer admission, other daemon invokers or remote inference cancellation.

## 5. Phase-8 patches

None. The mistaken Node-22 launch claim was discovered after the first merge, so 3.8 was reopened at `v3.8-mid`; the Node-24 restage, native-inventory correction and full private rerun were Phase-4/5 work, not a silent Phase-8 patch.

## 6. Carry-forwards and Feeds

Step 3.9 must use the corrected Node 24 release's manifest/Node/native identity while pinning the actual five-job cohort and protected source/admission contract. It must validate the real notifier executable and its environment before trusting the foreground child claim. Step 3.10 must prove the first transition from the older live consolidation source and other ungated entries is drain-safe. Step 3.11 consumes the staged entry and protected 3.9 contract for actual installation; until then, this release is private evidence, not a live timer replacement. Parent recovery 1.2 and remote inference cancellation remain separate.
