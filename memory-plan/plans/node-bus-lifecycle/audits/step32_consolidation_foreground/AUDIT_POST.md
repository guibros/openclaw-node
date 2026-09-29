# Step3.2 post-audit — 2026-09-29 05:26 EDT

## 1. Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Await cancelled cycle and retain whole invocation guard | yes | awaited cycle, activeRun through notification; ignored-signal/delayed-cleanup controls |
| Stop fences admission; both callers await completion | yes | stopped flag/await activeRun; CLI and memory-daemon await stop; actual child stop control |
| Analysis cancellation reaches HTTP; no early queue release or retry | yes | summary→client→queue signal, own ticket removal, abortable backoff/loop guards; actual HTTP close and delayed-cleanup controls |
| No new concept after abort; admitted atomic write finishes | yes | post-analysis checkpoint; real staged cycle held FileHandle.sync across scheduler abort, then completed sync/rename before returning |
| Both event publications finish before cycle return | yes | delayed/rejected ACK and abort-during-ACK controls; best-effort policy preserved |
| Foreground notification and platform child finish before release | yes | actual default CLI child exit; no detached Linux click waiter; actual Mac gate retains ownership through cleanup and notification |
| Private deployed consumer, exact review and isolated CI | yes | candidate-v2 hashes equal159b8dd; real Node24 exits0; Claude72/74 approve as-is/Linux158 reproduced; CI36547696359 green3/3 |

The deployment target is the written private-consumer contract. Production
scheduled consumers are not installed by this step;3.5 remains open.

## 2. Greppable deltas

`rg -n 'await runCycle|activeRun|notifyFailure|await scheduler.stop' bin/consolidation-scheduler.mjs`
finds cycle:160, ownership:206/248, notification:239 and CLI stop:323.
`rg -n 'await .*publishLocal' bin/consolidate.mjs` finds:150/:248.
`rg -n 'await federationState.scheduler.stop' workspace-bin/memory-daemon.mjs` finds:1834.
`rg -n 'throwIfAborted|onCallerAbort|abortSignal.*aborted|signal: opts.abortSignal' lib/ollama-queue.mjs`
finds caller cancellation:269/:288 and guarded retry:332 onward.
`rg -n 'signal: genOpts.signal' lib/llm-client.mjs` finds analysis signal forwarding.
`rg -n 'signal: opts.signal|signal.*aborted|await atomicWriteFile' lib/obsidian-summarizer.mjs`
finds:253/:530/:557, enclosing the owned write.
`rg -n 'foreground' bin/openclaw-notify.mjs` finds:53/:89.
Six focused files directly exercise these boundaries. Seven old-source
negative controls fail as expected, with zero unexpected passes.

## 3. Cross-references and verification

D18 and INVENTORY3.2 still describe one local-ownership outcome. Seven source
files and six test files match AUDIT_PRE§6; no new daemon or algorithm rewrite.
Private candidate-v2 passes158 tests/51 suites on Node24.13.0, zero failed,
cancelled or skipped. Claude independently reproduced158 on Linux. Source CI
36547696359 passes root20/22 (2532 total,2527 pass,5 skips, zero fail/cancelled)
and MC129 plus lint/build/audit gates. Full suites never ran on live resources.

OWNED_FOREGROUND_EVIDENCE.json raw SHA
48f63d4e7c14b33073a19494b23fdf2fd5b838e707cbd414dc7336edc87dd99c
records private gate→Node→CLI→platform child ownership, normal exit0, drain
and explicit private reopen. OWNED_PENDING_WRITE_EVIDENCE.json raw SHA
c5aa536e71d1b1ec16d90aa315f4b62de6edcef0cf47da7daabc1da3bd79fea5
records a real cycle's admitted atomic write held across cancellation:
invocation pending/alive until release, generated1, sync/rename finished,
hard-cap failure returned, exit0/stderr0, accepted snapshot unchanged. Records
contain no source rows, note contents, tokens or production payloads.

The12-stage profile on the51.9MB snapshot copy/fresh private vault measures
sum390.339ms/max116.754ms. Local-only analysis excludes LLM/live-vault scale;
it identifies no cause of the historical300s failure or universal wall bound.
Fresh09:20:13UTC resume has13 exact live PID/runs unchanged and primarye57
unchanged: continuity only, not service health/data integrity/VM-crash cause.

## 4. Findings

[POSITIVE] Cancellation requests and settlement are distinct; synchronous
overrun is reported even when its timer cannot run. Uncooperative admitted
work retains ownership; preservation drain refuses instead of admitting work.

[POSITIVE] Claude74 withdrew the outer notification timeout suggestion:
Promise.race returns early; killing only the CLI can orphan its platform
grandchild. Source159b8dd is approved as-is, without a wall-cap claim.

[POSITIVE] Mac records are Codex observations; Claude independently reviewed
source/reproduced Linux controls, not the Mac runtime observations.

[NEGATIVE] General memory-daemon/extraction completion, remote inference,
other invokers and production timer installation remain unproved.

## 5. Phase8 patches

None. Accepted source159b8dd is unchanged; closure adds records/ledger only.

## 6. Carry-forwards and Feeds

3.5 consumes the verified foreground scheduler/notification behavior;
recovery1.2 still needs independent delegated-memory idle proof.3.3 is next:
disabled Discord exits normally before bus/writes, conditional restart,
integration still disabled.3.4 owns interrupted journal recovery before3.5.

Track two reviewer observations for parent memory/operations readiness:
hard-cap failure discards partial removal/write reporting, and long owned
waits lack log-only duration visibility. Separate observability outcomes,
not missing3.2 completion behavior; neither permits early release or killing
an unverified process tree. A later external cancellation/forced-reclaim design
needs child-exit/remaining-work evidence; loaded natural drain or refusal
remains accepted. Live source/shared modules/production units are unchanged.
No full-node preservation is claimed.
