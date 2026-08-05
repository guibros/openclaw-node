# pair2-deploydoc — dual-causation evidence (RUN_RULES clause 5 assessment)

## Layer 1: demonstrated host suspension (external infrastructure)
Driver polled every ~45 s continuously from submission (10:59:26Z) to 11:35:18Z, then a
3h32m dead gap to the next poll at 15:07:40Z (host/VM suspended — the driver, agents, and
daemon all froze together; caffeinate was armed on the driver immediately after, so pairs
3-5 cannot be affected by sleep).

## Layer 2: protocol failure PRECEDING the freeze (counts per clause 5)
At the last pre-freeze poll (11:35:18Z, ~36 min of real runtime) the session sat at
phase=finalization with ZERO stored artifacts and usage of $1.21 across 3 calls — every
member submission to that point failed to store an artifact. A session at finalization with
no artifacts cannot yield the required workArtifact+completionDiff pair in any remaining
budget; the pair was already lost on protocol grounds when the freeze occurred.

## Assessment
The forfeit STANDS as recorded (protocol failure dominates; clause 5: "model or protocol
failures count"). The demonstrated freeze is documented here so the operator can overrule
and order a rerun of this pair if they judge the infra layer decisive; per clause 5 that
decision requires this demonstration, which is hereby on record.
