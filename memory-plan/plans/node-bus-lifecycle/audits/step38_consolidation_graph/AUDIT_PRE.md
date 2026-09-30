# Step 3.8 — Complete private consolidation graph

## Micro Re-Orient

Block 3 is building scheduled application quiescence, not a preservation controller.
Step 3.7 supplied an owned restore-only command and has merged as PR #161.
Step 3.8 supplies the complete private consolidation source and dependency graph for 3.9/3.11.
The north star is a verified quiet window with no code-on-disk/runtime gap.
This remains the first open step; actual timer installation is still 3.11.

## Intent and pre-screen

Stage the current-main consolidation scheduler and every reachable local source file, generated event schema, native dependency and child entry in one private release. Step 3.7 is closed and merged; accepted 3.2 source is unchanged on the consolidation path since `159b8dd`. Node 22.22.0, `nats-server` 2.12.6, the package lock, and an isolated HOME/store/bus are available. The shared `better-sqlite3` binary is built for Node 24 and fails under Node 22; the private release must install the same locked package version with its own Node-22-compatible binary before acceptance. Claude's read-only pre-delta graph review found silent fallback paths for the bus, model, tracer and notification, plus a zero-exit broken-schema case. The private test must explicitly fence each one.

## Design and acceptance

Copy the tracked `bin/`, `lib/` and event-schema source into an owner-private release. Install only the locked dependency closure in that release under launchd's Node 22; compile schema dist twice there and require byte-identical output. Produce a machine-readable manifest of copied-source and installed-dependency hashes, generated files, package lock identity, static imports, dynamic resolution sites, native binding and child-process edges. Refuse unresolved local imports, symlinked/hard-linked release files, dependency drift or a native probe failure. No source or dependency under the primary repo or live workspace is changed.

Run the staged scheduler's actual argv-less CLI from cwd `/` with an explicit fresh environment: isolated HOME, queue snapshot, DB, vault, owned tokenized JetStream, local LLM endpoint, observability DB and private notifier stub/ledger. Require a real cycle, actual event publication, concept note/model request, a failure-notification child and foreground cleanup. A broken schema, stale and busy queue states are negative controls. Explicit private endpoints must prevent silent fallback to the live bus, Ollama, store, tracer DB or notifier. `--no-events`/missing dist is not a successful event test because the scheduler swallows that failure. The stub stands in for the OS popup only; 3.9 must pin the real notifier executable and loaded unit environment.

## Risks and boundaries

- Literal import scans miss computed paths, generated dist and the notification child. Inventory each and assert the staged target.
- Package version equality alone does not prove native ABI; execute SQLite under the exact Node 22 binary.
- The scheduler catches NATS and LLM setup failures and can exit 0 with reduced behavior. Runtime evidence must assert actual JetStream events, schema validation and local LLM use where the fixture reaches analysis; a corrupted dist proves the false-success path.
- An isolated HOME does not isolate all defaults: the tracer follows `OPENCLAW_WORKSPACE`/`OPENCLAW_OBS_DB`; LLM and NATS default to live loopback endpoints. The test environment is an explicit allowlist.
- Private real-entry evidence proves local completion and graph resolution. The queue snapshot is fixture-supplied, and the private notifier is a stub, not the installed OS app. It does not establish remote inference cancellation, other daemon invokers, or production timer admission.

## §6 file deltas

1. `workspace-bin/stage-consolidation-graph.mjs`: private release assembly, locked dependencies, generated dist and graph/native/child manifest.
2. `workspace-bin/consolidation-graph-package.json` and `workspace-bin/consolidation-graph-package-lock.json`: exact small dependency closure for Node 22 private staging.
3. `test/consolidation-graph.test.mjs`: graph and stage failure controls.
4. `audits/step38_consolidation_graph/probe.mjs`, runtime record and post-audit.
5. This silo's `INVENTORY.md`, `VERSION`, `COMPONENT_REGISTRY.md` and append-only `DECISIONS.md` for phase and closure state.

## Mid-Implementation Findings

1. Claude's exact-source challenge found that `within()` accepted the bare parent `..` and that dependency versions were recorded by package name, collapsing a nested package's manifest identity. Both were corrected before the final private release. The graph test now compares every dependency path with the staged lock. The owned probe was rerun against the corrected release.
2. CI's Mission Control dependency-audit job is red on unchanged `mission-control/package-lock.json`, including on `main` merge commit `ab9b8fb` (run 36780863183). Its lint and 129 tests pass; both root Node jobs pass on PR #162. The high-severity audit failure is an unrelated baseline finding and is not altered in this step.
