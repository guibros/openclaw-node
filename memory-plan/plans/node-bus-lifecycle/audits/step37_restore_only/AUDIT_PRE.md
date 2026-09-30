# Step 3.7 — Bounded restore-only recovery

## Micro Re-Orient

Block 3 has the native gate, sole Journal hold facade and tracked archive input.
3.7 makes an interrupted hold recoverable through one bounded command.
This serves the local-first preservation path without claiming a healthy cold copy.
3.11 consumes the command after its source, launch and readiness contracts land.
The next step is still 3.7; production commissioning remains gated on 3.8–3.10.

## Intent and boundary

Use the existing Journal/node_lock and JournaledHold. A reopened or adopted hold
restores the saved baseline only, then resolves; it never seals, certifies the
lost interval or invents a new baseline. The runnable acceptance is an isolated
owned Mac cohort. A live-node command is refused until the later pinned adapter
and launch contract exist. No production service or timer is changed.

## Pre-screened Needs

- 3.5 and 3.6 are closed on merged main; Journal, Gate and JournaledHold exist.
- The saved baseline includes the complete prior-state inventory and exact
  execution-hold descriptor. Journal rejects replacement on reopen.
- The owned cohort can use private fixtures and native launchd without touching
  any production label, source, store or listener.
- The fixed readiness and physical-check contract is reviewed before a command
  may report restored. Caller-supplied `verified` callbacks cannot authorize it.

## Risks and checks

- An active or SIGSTOP-suspended controller retains node_lock: refuse before
  mutation, without a progress heuristic.
- An intent-only/open or receipt/missing-marker branch can admit a real timer;
  classify the observed marker, then drain or refuse the straggler.
- Missing/substituted saved pins, malformed durable records and untrusted code
  or environment: refuse without baselining again.
- A partial restore reports the physical gate state and unresolved journal;
  any failed durable write aborts before the next dependency mutation.
- Exact readiness comes from owned observed process/launchd and file identity,
  not a fixture-supplied assertion.
- The existing full gate receipt binds root ctime/mtime. An unrelated entry
  change after publication can strand a closed hold; classify and refuse
  without pin recapture or new records. D23 retains this 3.1 decision.

## §6 File deltas

- A bounded command and its fixed owned readiness adapter beside the sole
  Journal/hold facade, with no second journal or controller.
- Only the saved private fixture timer or daemon may be bootstrapped or
  kickstarted for end-to-end acceptance; nats-1 and other units are absent.
- Owned real-process interruption/refusal tests and CI entry.
- Private runtime evidence for the actual command, then AUDIT_POST, registry,
  inventory and version carriers. No production rollout.

## Verify contract

Run the command on private owned launchd services and gate after killing a
controller; show restored prior state, resolved journal, open marker, and no
seal/certification. Repeat for active owner, substituted pins, corrupt history,
unready service, physical refusal, write failures and straggler deadline.
Record actual gate-marker and journal-head observations, not inferred state.
