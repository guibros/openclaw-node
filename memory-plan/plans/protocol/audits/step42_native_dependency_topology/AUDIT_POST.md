# AUDIT_POST — step 4.2 · Native dependency topology

## 1. Verdict

PASS, with one causal correction. The duplicate vulnerable Sharp/libvips trees are removed from
source and both deployments, and all mcp-knowledge imports resolve the root-pinned native version.
That removal did not by itself stop the watcher teardown abort. Isolating the embedding probe in a
child process did: the full deployed watcher now completes and exits according to its report.

## 2. Landed

- Registered `lib/mcp-knowledge` as a private root npm workspace and removed its independent lock.
- Made both installer copies exclude node_modules and link the root dependency tree into the
  workspace and mesh parents, including package-level links beneath scoped namespaces.
- Changed embedder readiness to consult the parent dependency authority.
- Added `bin/embed-probe.mjs`; acceptance invokes it as a bounded child and rejects malformed,
  model-error, nonzero-exit, and signal-terminated results.
- Quarantined the two deployed 0.34.5 trees reversibly under `/private/tmp`; no user data or model
  cache was deleted.

## 3. Code Evidence

- `node --test test/install-modules.test.mjs test/mcp-knowledge-sessions.test.mjs`: 20/20 pass.
- `node --test test/node-acceptance-probes.test.mjs`: acceptance/isolation set included in 39/39 pass.
- `npm audit --audit-level=high`: rc 0, no high/critical findings and no Sharp advisory.
- `npm test`: 1927 pass / 1 fail / 1 skip of 1929. The sole failure is the pre-existing fixed
  embedding performance budget: 888.7ms mean versus 500ms; 100-item batch completes in 8.66s.
- `npm pack --dry-run --json`: rc 0; helper and workspace package are present and the removed child
  lockfile is absent. The oversized package surface is separately captured in OUT_OF_SCOPE.

## 4. Runtime Evidence

- Source, `~/.openclaw/workspace`, and `~/openclaw` resolve the identical root Sharp path at
  Sharp 0.35.3/libvips 8.18.3. Repository and deployed helper/probe SHA-256 hashes match.
- No nested `mcp-knowledge/node_modules` exists in any of those three trees.
- The completed parent BGE-M3 ONNX external-data artifact is 2266820608 bytes and byte-matches the
  quarantined known-good cache. Direct embedding returns 1024 finite dimensions at norm 1.0.
- The deployed full deep watcher reports 28 WORKING / 1 BROKEN / 3 OFF / 4 UNKNOWN and exits rc 1,
  the documented result for a report containing BROKEN. It emits no duplicate-libvips warning,
  mutex abort, or exit 134.

## 5. Honest Boundaries

- Duplicate Sharp/libvips was proven dependency-security and process-stability debt, not the proven
  root cause of the native mutex abort. The exact in-process teardown interaction remains unknown.
- Child isolation converts any future native probe failure into bounded probe evidence and protects
  the long-lived watcher; it does not claim to repair an unidentified upstream native defect.
- The current BROKEN graph-cache freshness result and slow local LLM probes are watcher/runtime
  findings, not regressions in this step. Watcher verdict truthfulness proceeds in 4.3.

## 6. Re-orient

Step 4.2 restores one native dependency authority and a stable deep-watch process. Step 4.3 can now
make gateway freshness and actual service PIDs load-bearing without its evidence process dying after
the report. Scheduler heartbeat authentication remains isolated to 4.4.
