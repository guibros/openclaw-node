# AUDIT_PRE — step 4.2 · Native dependency topology

## §0 Re-orient

- Where am I: Block 4, step 4.2, after v4.1 restored scheduler/event-path liveness.
- Last step changed: queue activity and local event identity now come from authoritative signals.
- This step contributes: one dependency authority for every process that imports mcp-knowledge.
- Serves the north star via: a stable semantic-memory and watcher process without duplicate native ABI state.
- Still the right next step? Yes; the duplicate Sharp trees currently abort the full watcher and retain
  the vulnerable 0.34.5/libvips generation that the root security override was intended to remove.

## §1 Needs pre-screen

- Operator approval: runtime-repair block approved 2026-08-02 (`gogogogogogog`).
- Step 4.1: closed and pushed at `d4bc066`.
- Root dependency authority: `package-lock.json` resolves Sharp 0.35.3 under the root override.
- Nested source/workspace tree: 2.7 GB, Sharp 0.34.5, better-sqlite3 11.10.0; workspace `lib` is a
  symlink to the source tree, so both imports hit the same stale native copy.
- Nested mesh tree: separate 2.7 GB copy at `~/openclaw/lib/mcp-knowledge/node_modules`, also Sharp 0.34.5.
- Installer cause: `workspace.sh` runs npm inside both copied package directories and mesh rsync does
  not exclude nested node_modules; `components.sh` treats nested deps as the embedder readiness signal.
- Root npm workspace list excludes `lib/mcp-knowledge`; its standalone lock therefore bypasses root overrides.

## §4 Risks

- Removing nested trees before parent dependency resolution is live would break every semantic-memory import.
- Scoped dependencies need package-level linking; linking only an existing `@scope` directory can leave a
  required child absent.
- Runtime cleanup must be reversible and must not delete model caches or user data.
- Mission Control has its own process-local Sharp 0.35.x tree; it is not duplicate state inside the watcher
  process and must not be conflated with the mcp-knowledge defect.

## §6 File deltas

- Root package/lock: register `lib/mcp-knowledge` as a workspace under the root override.
- Nested package: remove its independent lockfile; retain its dependency declaration as workspace metadata.
- Installer: exclude nested node_modules from both copies, remove child npm installs, and link root packages
  into workspace/mesh parent node_modules with correct scoped-package handling.
- Prefetch: test the parent dependency surface, not the forbidden nested directory.
- Tests: lock the workspace, no-child-install, rsync-exclusion, scoped-link, and prefetch contracts.
- Runtime: quarantine both nested trees under `/private/tmp`, restart affected services, resolve/import Sharp,
  and run a full deep watcher to normal process exit.

## Mid-implementation findings

- Removing the duplicate native trees did not by itself stop the watcher abort. The first post-cleanup deep
  report completed, then exited 134 after the embedder reported an incomplete ONNX external-data file. This
  corrects the earlier causal claim: duplicate Sharp was proven security/process risk, but not the mutex root.
- The 2.7 GB child install also owned a BGE-M3 cache. Hoisting exposed a partially downloaded parent cache;
  during the two watcher probes its external-data file grew to the complete 2266820608-byte artifact.
- The completed parent ONNX and data files byte-match the quarantined known-good cache. A direct embedding now
  returns 1024 finite dimensions at norm 1.0 and exits normally. The full watcher must still prove clean exit.
- A second full watcher with the complete cache returned valid embedding and extraction results, then still
  exited 134. Minimal isolated embedding, delayed shutdown, and aborted-fetch-plus-embedding probes all exit
  normally, so the exact native teardown interaction is not established. The monitor must isolate the ONNX
  check in a child process: a native probe failure is evidence, never permission to terminate the watcher.
- With the embed check isolated, the deployed full deep watcher completed every axis and exited rc 1 solely
  because its report contained one BROKEN graph-cache probe. It reported 28 WORKING / 1 BROKEN / 3 OFF /
  4 UNKNOWN, embedding dimension 1024 at norm 1.000, and produced no duplicate-libvips warning or mutex abort.
