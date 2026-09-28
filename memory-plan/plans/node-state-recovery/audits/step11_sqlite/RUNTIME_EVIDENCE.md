# SQLite recovery evidence — accepted

Observed on the Mac, 2026-09-28 08:31 EDT. This is a per-store recovery result,
not a completed coordinated SQLite/JetStream acceptance.

The strengthened helper ran using installed Python 3.12.14 / SQLite 3.53.1.
All twelve live application stores reported WAL mode. Raw source connections
were read-only/query-only, loaded no extension and pinned each snapshot on the
same connection used for fingerprints and SQLite backup. No service was stopped,
source checkpointed, migrated, rebuilt or repaired.

Snapshots total 852,017,152 bytes. All 116 physical tables, including virtual
shadow tables, retain matching SQL type/raw-text/rowid or key digests. Schema,
user_version, application_id, page size, encoding, auto-vacuum and foreign-key
results match their isolated restores; core integrity is ok. Individual snapshot
time windows are recorded. This set is not one cross-store point in time.

Native checks on the isolated restores pass for all twelve stores. The daemon's
state/graph and knowledge use Node 24.13.0 / SQLite 3.49.2; Mission Control uses its launchd
PATH's Node 22.22.0 / SQLite 3.53.2. The knowledge module resolves the recorded
sqlite-vec dylib, v0.1.7, from the root dependency; no nested vec package exists.
The gateway's memory/main.sqlite, task runs, plugin and flow stores now use its
actual Node 24.13.0 node:sqlite engine, SQLite 3.50.4 and sqlite-vec 0.1.9. Installed
gateway source uses DatabaseSync; its default vector configuration has no path
override and resolves the recorded gateway vec binary. The three Codex agent
stores and empty lcm.db pass repository-engine compatibility probes; their
owner's engine equivalence is not claimed.
All six FTS5 rank=1 integrity checks pass. Vector counts/self-queries pass for
chunks_vec (13), chunk_vectors (9,290), session_chunk_vectors (20,399) and
directory_vectors (25). First and last keys provide eight distance-zero probes;
this is representative query evidence, not an exhaustive vector scan.
Restored file hashes are unchanged after native probes.

Seven isolated Python fixtures pass: concurrent WAL writer, rollback-mode refusal,
integers above 2^53, invalid UTF-8/TEXT-versus-BLOB distinction, and rowid plus
WITHOUT ROWID preservation, unknown-store refusal and failed atomic manifest
replacement retaining the previous file. Native fixtures pass both integer and text-keyed
vector queries and detect deliberately drifted external-content FTS with
SQLITE_CORRUPT_VTAB while preserving its file hash, using both repository and
gateway engines. Deployed copies of the new fixtures pass too. No root suite ran locally.

All backup/restore directories are 0700 and files 0600. Helper code was copied
into the private runtime evidence directory with a hash manifest. Application
stores were explicitly listed; the header scan found exactly twelve declared
application stores. Browser vendor state, historical backups, dependencies and
three known source-code links are explicitly excluded. Four dated root backups
and two unpromoted gateway reindex temporaries are excluded by exact path; the
temporaries have February 4 mtimes and no open owner. New SQLite headers or
directory links cause refusal. Source pin timestamps and current-WAL-inclusive
capacity are recorded; manifests are replaced atomically.
Gateway PID 2902/runs 17074, MC 26400/runs 2, memory daemon 58622/runs 2, viewer
35823/runs 3 and watcher 29201/runs 1 remained running. Gateway, authenticated
viewer discovery and authenticated MC health returned 200 afterwards.
Verified-3 has the same byte/table totals as verified-2; state, knowledge and
MC file hashes differ between the runs. No claim is made that production writes
overlapped a particular pinned window; concurrency safety rests on the fixtures.

Private copies, fingerprints and native results live under
`~/.openclaw/backups/node-readiness/sqlite-20260928-verified-3/`.
Helper SHA256: 89f4a965fc08bef47c512d2c89f9fa5983ac3678fa30511c47e6e30fcd8b3f6a.
Manifest SHA256: 885c192d6085e0994adc92d7a1135483bd8d52486dddf3855bc83a8caeccabff.
No credentials, vectors or conversation rows are published.

Earlier preliminary copies and failed-run metadata are retained privately.
The strengthened run adds raw byte/type/rowid/header verification and leaves
extension code off production connections. Claude's source/evidence challenge
at b965148 found no source blocker in pinning/digests; all five core mutants
failed its fixtures 3/3 times, and additional precision, corruption and four-writer
counterexamples held. Its owner-engine and coverage corrections above are
implemented. Message 68 accepts e750e3e with no source blocker and confirms the
gateway engine fixture and real-corruption/four-writer regressions independently.
The CI recovery fixture step executed successfully. Atomic-rename file churn
can abort the inventory scan safely; this robustness carry-forward belongs to
1.3 alongside its non-SQLite canonical-source classification and capture.
Step 1.3 separately establishes coordinated
cursors and bus acknowledgements before parent node-readiness 1.3 can close.
