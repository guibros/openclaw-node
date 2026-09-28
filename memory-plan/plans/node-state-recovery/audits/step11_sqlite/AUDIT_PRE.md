# Step 1.1 — SQLite recovery snapshots

## 0 — Re-orient
The parent plan needs recovery before topology repair.
The viewer is deployed with browser acceptance explicitly pending.
This independent step preserves SQLite without changing running stores.
Durable local-first history needs verified recovery, not untested copies.
The declared prerequisites exist; this is the correct next independent action.

## 1 — Intent and prerequisites
Twelve application stores have valid SQLite headers. Python SQLite backup and the installed sqlite-vec dylib exist; approximately 49 GiB is free. Create a fresh private dated directory under ~/.openclaw/backups/node-readiness. No service stops.

## 2 — Design
Pin read-only source snapshots, record logical fingerprints, then use SQLite backup. Restore closed backups elsewhere and compare integrity/schema/user_version/counts/typed digests. Include memory, knowledge, graph, MC, task runs, plugin, flow and agent application state. Exclude browser vendor caches.

## 3 — Risks
Virtual tables require the extension. Stream rows rather than accumulating transcripts. WAL writers remain active. Failed equality/integrity keeps the step open with private evidence, never automatic source repair.

## 4 — Verification
Execute against all declared stores, inspect restores/permissions and service liveness, then receive independent challenge from Claude. No root suite, application initialization, source migration, REINDEX or VACUUM.

## 5 — Runtime output
Dated owner-private snapshots, isolated restores and fingerprint manifest. No credentials or conversation rows in stdout.

## 6 — File deltas
- This silo's roadmap, inventory, registry, decisions, version and bound prompt.
- audits/step11_sqlite/backup_verify.py: read-only snapshot/restore helper.
- audits/step11_sqlite/test_backup.py: isolated concurrency/digest fixture tests.
- audits/step11_sqlite/test_native.cjs: isolated vector and drifted-FTS fixtures.
- audits/step11_sqlite/verify_native.cjs: offline virtual-table checks using owning SQLite builds.
- audits/step11_sqlite/RECOVERY.md: owner-stop and sidecar-safe restore runbook; cross-store consistency limits.
- AUDIT_POST and sanitized evidence after acceptance.
- Generated argv-less shim; chain stays unloaded.
- .github/workflows/test.yml: run isolated recovery fixtures on the Node 22 CI job.

## Mid-Implementation Findings

The system Python 3.9.6 SQLite build lacks loadable-extension support despite
having the backup API. The first run stopped before any source query or snapshot.
Its empty output directory and failure manifest are retained. Codex's installed
Python 3.12.14 supports extension loading; SQLite 3.53.1 loaded the actual vec0
dylib and reported v0.1.7 in an in-memory pre-screen. Use this explicit runtime.

Claude's independent challenge strengthens verification: gate live snapshots on
WAL; pin and fingerprint on the backup's own connection; hash raw text bytes,
types and rowids; include physical shadow tables and header/foreign-key state.
Production connections now load no extension. Native offline FTS5 checks and
representative vector self-queries supplement core integrity. Snapshots remain
per-store, with individual time windows; a coordinated SQLite/JetStream set is
explicitly required before parent topology repair. No repair or index rebuild.

Claude's PR review found the gateway store was checked with the repository's
engine, and fixed enumeration could omit a new application database. The same
step now scans regular-file SQLite headers, fails on an undeclared store, and
records explicit historical/browser/dependency exclusions. The two February
gateway reindex temporaries are excluded by exact path, retain their originals,
and have no open owner; future temporary paths are not silently excluded.
Directory symlink targets are outside this physical-root inventory.
The native verifier supports the gateway's own node:sqlite/vec build and probes
both ends of each vector table. Agent Codex stores receive compatibility probes,
not an assertion about their owner's SQLite engine. Manifest replacement is
atomic, capacity includes WAL bytes, and pin timestamps sharpen the windows.
This extends verification of the same recoverability outcome; no production
storage or application code is modified.
