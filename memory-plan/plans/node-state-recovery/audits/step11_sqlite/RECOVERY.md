# SQLite recovery procedure

These snapshots preserve each declared store at its recorded time window. They
are not one coordinated application/JetStream recovery point. Parent
node-readiness 1.3 remains open until that coordinated set exists. Do not combine
these stores and immediately resume automatic task execution or ingestion.

The helper requires WAL mode so its pinned reader does not block application
writers. It opens raw read-only SQLite connections, never application modules,
and loads no extension on production connections. All physical tables, including
FTS5/vec0 shadow tables, are fingerprinted with SQL types, raw text bytes, rowids
or WITHOUT ROWID keys. Header and foreign-key results are compared. Foreign-key
violations are preserved and reported, not repaired.

Run `backup_verify.py` with explicit `--root`, installed `--extension` paths for
provenance, and a fresh private `--output` directory outside application backup
rotation. Python SQLite must provide `backup` and `PRAGMA table_list`. The
validated runtime is Codex Python 3.12.14 / SQLite 3.53.1. The manifest identifies
the helper and extension hashes, every store's snapshot window and fingerprints.
Repeat `--extension` for each owner engine's vec binary. The physical-root scan
refuses undeclared SQLite headers; exact excluded files and pruned directory
reasons appear in the manifest. Symlink directory targets are outside this
inventory. Browser vendor state, dependency fixtures and historical recovery
copies are excluded; no new application or reindex path is silently accepted.
Snapshots, restores and atomically replaced manifests are fsynced and use
owner-private permissions. Capacity includes current WAL size with headroom;
continued writes can still consume that headroom during pinned snapshots.

Run `verify_native.cjs <manifest.json> <declared-store> <better-sqlite3-path>
<vec-dylib-path>` only on the isolated restored copies. It requires a declared
store, its matching file hash and a real path beneath the restore directory.
Use the owner's engine/binding: Node 22 for Mission
Control, Node 24 for the deployed memory/knowledge binding, and `node:sqlite`
with the gateway's own vec binary for gateway stores. Record SQLite and vec
versions. The observed native builds are memory/knowledge SQLite 3.49.2 and
Mission Control SQLite 3.53.2, and gateway Node SQLite 3.50.4 / vec 0.1.9; do not
infer another owner's engine from the root dependency. Plain Codex-owned agent
stores are tested for readability by the repository engine, not owner-engine
equivalence.
The FTS5 integrity command uses rank=1 to compare external content;
its transaction is rolled back. Vector checks enumerate counts and query the
first and last keys per nonempty table. Duplicate vectors may return another
rowid at distance zero; the digest covers all stored vectors and row identities.
These representative queries are not an exhaustive vector-index corruption scan.
No application initialization, rebuild, migration or source checkpoint occurs.
Matching digests prove faithful preservation; structurally valid incorrect
application values already present in the source are faithfully preserved too.

Rerun the isolated fixtures before coordinated recovery: Python 3.12.14 / SQLite
3.53.1 is the validated Mac runtime. `python3 test_backup.py` tests concurrent
WAL pinning, rollback-mode refusal, typed precision, rowids, inventory refusal
and atomic-manifest failure. `node test_native.cjs <binding> <vec-path>` tests
both vector key types and drifted external-content FTS. Run the latter with the
repository binding and the gateway's `node:sqlite` binding. These commands run
in CI on Node 22 with its installed Python/SQLite, using temporary stores only.

For an actual recovery:

1. Select a verified manifest and the required coherent recovery set. Check its
   hashes, private ownership and applicable engine versions before service work.
2. Stop every owner/writer for the selected state, including scheduled jobs and
   CLI processes. Verify that no process holds the live files. Keep executors
   stopped throughout reconciliation.
3. Move the original `.db`, `-wal`, `-shm` and `-journal` together into a fresh
   private quarantine directory. Retain them for rollback; never leave a stale
   sidecar beside the restored file.
4. Place the selected closed snapshot at the original database path with the
   owner's mode 0600. Recheck its hash and all applicable integrity/native probes
   before starting an application that might migrate it.
5. Reconcile session/extraction/knowledge cursors, task ownership and JetStream
   durable-consumer positions against the coordinated manifest. If restoring a
   single store, separately prove the affected replay and idempotency rules;
   this step does not claim those rules have been accepted.
6. Start the owning service under its supervisor, observe authenticated health,
   counters and reads, then resume execution only after reconciliation passes.

The source snapshots use SQLite's [backup API](https://sqlite.org/backup.html).
FTS5's [integrity-check command](https://sqlite.org/fts5.html#the_integrity_check_command)
has a separate external-content check. Neither a passing generic integrity
result nor a copied file alone proves complete application recovery.
