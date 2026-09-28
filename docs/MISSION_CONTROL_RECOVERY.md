# Mission Control database recovery

A failed integrity check stops Mission Control database initialization. It does not
run REINDEX or discard data. Confirmed corruption remains blocked until the process
restarts; temporary locks are retried on the next request after a five-second wait.
Database and journal files must remain readable and writable only by their owner.

1. Record the deployed revision, database path, integrity diagnostic and service
   definition. Pause the scheduler and maintenance callers. Stop Mission Control
   through its service manager, then identify and stop every other writer to this
   database, including telemetry writers. A stopped dashboard alone is insufficient.
2. Preserve a consistent, owner-private backup. Use SQLite's online backup API when
   it can read the source. Otherwise, after confirming no writers remain, preserve
   the database together with any WAL/journal sidecars. Never copy just a live main
   database file or remove its WAL. Retain this original evidence unchanged.
3. Restore a known-good backup into a separate directory. If salvage is necessary,
   attempt it only on another copy. Validate integrity_check and foreign_key_check,
   task identities, scheduling fields and required historical data. A successful
   REINDEX alone does not establish that application data is complete.
4. Rehearse startup against the verified copy with isolated home/workspace paths,
   a private port and no production bus or scheduler. Compare data before and after
   migrations. Use the same Node version and native dependencies as the service.
5. While all writers remain stopped, preserve the failed set and install the
   verified database set with owner-private permissions. Restart the existing
   supervised production service. Check authenticated UI/API, anonymous rejection,
   unchanged task state and a stable health observation window. Restore other
   writers and the scheduler only after their state and dispatch candidates have
   been reviewed. Retain the old set for rollback.

`mc-health --restart` is explicit operator recovery through launchd or systemd.
It never repairs the database or starts a development server. Authentication errors
do not trigger a restart. Automatic process recovery belongs to the service manager;
memory maintenance reports failed health and skips dependent work.
