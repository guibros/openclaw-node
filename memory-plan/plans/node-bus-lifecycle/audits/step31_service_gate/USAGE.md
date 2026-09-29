# Scheduled application execution hold primitive

This prototype is deployed only to owned test consumers. It is not installed
on the live node. It applies to known foreground-only job entrypoints.

Initialize a new owner-private directory with service_gate.py init <absolute
gate-root>. Repeated init validates an open root; it never reopens a closed
one. Partial/invalid setup fails closed and is retained for explicit recovery.
A runner uses service_gate.py run <gate-root> -- <absolute executable> <args>.
Missing, invalid or symlink metadata refuses with exit78 and no output. Closed
or exclusively locked runs exit0 silently before application execution.

The controller imports Gate and calls close_and_drain(window, reason, seconds)
only after its durable intent. The marker is durable before the exclusive
lock waits for existing foreground runs. A deadline refusal retains the
marker: it never silently reopens after controller loss. The returned ClosedGate
checks owner, inode, metadata and marker identity, with actual continuous vnode
watches on Mac. watch evidence has a4096-event refusal bound. Repeated access
attributes are accepted only with unchanged identity. Linux reports
kernel_file_watch:false; continuous-watch acceptance there remains unproved.

ClosedGate.close() stops observation and retains the hold. Recovery calls
Gate.reopen(exact_marker) under its own durable intent, only after all dependent
services are ready. Exclusive locking covers unlink/fsync. A different window
refuses. Source, actual loaded entrypoints, gate metadata/lock/directory identity
and original open state must join the production baseline. The journal must
restore that explicit hold as well as service state; this integration is3.2.

The inherited lock covers the exec'd process. Node child_process can close it
in descendants. Detached/unawaited work is therefore not covered. Consolidation
currently has an unawaited notification path that must be finished before
installation. Remote work already delegated to the memory daemon must drain
through its separate fresh idle proof. Other callers of these scripts belong
in the writer inventory. Do not infer application quiescence from zero OS
process starts: gated scheduled starts are explicitly permitted.

Marker publication is an exclusive atomic hard link to a fully prepared/fsynced
private file. A failure before publication means no close/drain acceptance;
no service may be stopped or store copied. A failure after publication retains
a valid closed marker for explicit recovery. Leftover prepared bytes are
retained for the journal's forensic resolution procedure in3.2.
