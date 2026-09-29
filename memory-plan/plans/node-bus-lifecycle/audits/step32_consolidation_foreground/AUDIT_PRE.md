# Step3.2 pre-audit — 2026-09-29 05:00 EDT

## 0. Micro Re-Orient

Block3 scheduled quiescence; parent preservation still incomplete.
3.1 merged32f135b: private foreground hold/drain/reopen only.
This step makes one local consolidation invocation own all of its work.
North star: durable local-first memory, runtime truth before readiness.
Still next: yes; early completion defeats the already accepted hold contract.
Production units, shared modules and primary e57 remain preserved.

## 1. Intent and pre-screen

3.1 is closed with actual owned Mac evidence and independent source challenge.
Fresh source at32f135b has two reachable scheduler callers: its CLI and
workspace-bin/memory-daemon.mjs. Both currently call stop without waiting.
The scheduler races the cycle against abort and can age-orphan its guard.
Actual old-source owned negative returns in22.561ms before a150ms cycle
settles; private OLD_SOURCE_NEGATIVE_V2.json retains source/runtime hashes.
Both local event publications and the failure notification child are unawaited.
The actual summary path uses generateAnalysis, whose queue timeout frees its
slot before fetch cleanup. Summary cancellation never reaches that fetch.
These are all work belonging to the same local invocation lifetime.

## 2. Design

The deadline requests cooperative cancellation; completion still waits for the
cycle's promise and its finally blocks. Keep a single owned invocation from
idle check through reporting/notification. No elapsed-age orphaning. Stop
fences admission, removes its interval and awaits that invocation. Both callers
await stop before their existing teardown. No general daemon-drain claim.

Pass caller AbortSignal from summaries through the client and analysis queue.
Cancel queued tickets and retry backoff; running work retains its slot until
its own promise settles. Analysis deadline fallback occurs only after that
settlement. Caller cancellation throws after settlement. Prevent a concept
write after cancellation received during its LLM call, and checkpoint between
the already awaited vault helpers. Await each existing best-effort event
publication before cycle completion, including abort. Keep its current error
policy; reliable retry/idempotency is separate work.

Await the notification CLI's actual exit and use explicit --foreground mode,
which excludes Linux's detached click waiter. Its existing platform command
timeout remains; do not kill the parent while its child is still awaited.
Notification failure remains best-effort. No new daemon or duplicate path.

## 3. Risks and limits

An arbitrary promise ignoring cancellation, synchronous SQLite work, a hung
filesystem or remote inference cannot be given a guaranteed wall termination
by an AbortSignal. Retaining ownership is safer than admitting another writer.
Real local HTTP abort must be observed against an owned server. This establishes
local request settlement, not remote server computation termination. A loaded
launchd stop budget may still kill a stopping daemon: maintenance keeps gated
scheduled units loaded and drains foreground work without signalling them.
Global queue shutdown/general handlers and other maintenance invokers remain
parent work. The detached clawvault checkpoint in memory-maintenance is one
explicit later3.5 inventory item; it is not in this call chain.

## 4. Verification

Deferred cleanup controls reject early return/slot reuse, including ignored
signals, pending-ticket cancellation and abort during retry backoff. Verify
stop fences/waits through an actual owned child. Hold event ACKs and reject
one while the cycle stays pending; keep best-effort semantics. Verify no
post-abort concept note write. Real owned HTTP request observes local abort.
Negative controls use old source, with finite releases so tests cannot leave
orphans. Focused tests use private HOME/vault and existing dependencies read
only; full root/MC suites run only in isolated CI. Independent Claude challenge.
Private staged runtime is the declared deployment consumer for this bounded
step; production consumer integration is3.5. Step stays active until evidence
and exact source review/CI exist.

Pre-implementation source classification also requires reporting every
stage's actual bound and a private saved-snapshot profile. This is verification
of the completion design, not a license to change unrelated algorithms. The
historical300s symptom names no stage; do not invent its cause.

## 5. Decision

D18 records the cancellation-versus-completion boundary and code scope.
No master principle changes, no production acceptance substituted by tests.

## 6. File deltas

| File | Delta |
|---|---|
| bin/consolidation-scheduler.mjs | await cancelled cycle, own whole invocation, fence/wait stop, await foreground notification, await CLI stop |
| bin/consolidate.mjs | await two existing event publications; checkpoints between vault helper calls |
| workspace-bin/memory-daemon.mjs | await scheduler stop at its existing teardown boundary only |
| lib/ollama-queue.mjs | caller cancellation, no timeout slot orphan, cancelled-ticket/backoff lifecycle |
| lib/llm-client.mjs | forward caller signal to analysis queue |
| lib/obsidian-summarizer.mjs | forward signal; stop before concept write after cancelled analysis |
| bin/openclaw-notify.mjs | explicit foreground delivery excludes detached Linux waiter |
| test/consolidation-scheduler.test.mjs | cleanup/ownership/stop/child lifetime regressions |
| test/consolidation.test.mjs | event ACK lifetime controls |
| test/ollama-queue.test.mjs | delayed cleanup, ignored signal, caller/pending/backoff cancellation |
| test/llm-client.test.mjs | actual owned HTTP caller-abort control |
| test/obsidian-summarizer.test.mjs | signal forwarding and no post-abort note |
| test/notify.test.mjs | foreground CLI/delivery controls if needed |
| this audit, AUDIT_POST, evidence and plan ledger files | actual source/runtime/checkpoint record; keep unfinished version until acceptance |

## Mid-Implementation Findings

None. Queue early release and omitted caller cancellation were found before
implementation and explicitly included above; unrelated maintenance escape is
tracked for3.5, not silently repaired here.
