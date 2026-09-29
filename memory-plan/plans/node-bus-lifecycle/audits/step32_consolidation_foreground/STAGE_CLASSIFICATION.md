# Local completion boundaries — 2026-09-29 05:09 EDT

This inventory follows the actual production scheduler and cycle imports at
32f135b plus the3.2 candidate. It does not promise a universal wall-time bound.

| Reachable stage | Boundary | Cancellation/completion |
|---|---|---|
| Idle admission | synchronous queue state or shared snapshot filesystem read | standalone uses readStateSnapshot; missing/stale/busy refuses; in-process caller explicitly supplies getStateFn |
| Open/init | synchronous SQLite open/schema/transaction | no event-loop timer can interrupt the synchronous call |
| Decay/prune | synchronous SQLite reads/transactions, archival/VACUUM backup and filesystem operations | checkpoints between stages; no arbitrary dataset or filesystem wall bound |
| Existing decay publication | awaited JetStream publish ACK | transport supplies its own publish timeout; aborted cycle still awaits its admitted publication |
| Reinforce/clusters | synchronous recency-filtered SQL self-joins and JS loops | checkpoints between stages, no cooperative preemption inside synchronous work |
| Session notes | awaited local vault helper, default20 notes | local SQLite/filesystem, no general wall bound; checkpoint before next helper |
| Decision notes | awaited helper, default30 notes, synchronous atomic file writes | no timer preemption inside synchronous writes; checkpoint before next helper |
| Theme notes | awaited local helper, threshold-filtered rows, filesystem writes | data-dependent count, no general wall bound; checkpoint before digest |
| Digest | awaited local filesystem reads/atomic write | no general filesystem wall bound |
| Concept discovery/prioritization | synchronous SQLite and local file reads, awaited vault setup | data-dependent work, cancellation check before each admitted concept analysis |
| Concept analysis | actual client.generateAnalysis, queue ticket and local HTTP fetch | caller and queue deadline reach fetch; abortable retry backoff; request settlement awaited; default per-concept wait12s, default max25 concepts |
| Concept write | awaited atomic async writer after post-analysis cancellation check | new admission is fenced after received abort; an already admitted write finishes before invocation release |
| Contradictions/promotion | synchronous SQLite/JS work | checkpoints between stages; no universal wall bound |
| Existing promotion publication | awaited JetStream publish ACK | retains existing best-effort error policy; actual admitted publication awaited |
| Failure notification | awaited real notification CLI exit with --foreground | Mac subprocess is awaited; Linux uses plain awaited notify-send, no detached click/xdg waiter; platform delivery owns its10s child timeout |
| Reporting/stop | foreground scheduler invocation promise | no age orphan; stop fences admission and waits before caller teardown |

The actual consolidation client has generateAnalysis. Its legacy injected
generate-only seam is not the production path. Extraction worker jobs are
separate invokers; current_job/external_jobs refuse consolidation admission,
but extraction completion and general memory-daemon shutdown still need their
own preservation proof. A local HTTP abort does not certify remote inference
termination. launchd's stop budget can still kill a stopping process: scheduled
maintenance holds leave the unit loaded and wait for natural foreground drain.

## Private snapshot profile

Installed Node24.13.0 ran the actual stage functions against a writable copy of
the accepted2026-09-28 SQLite snapshot. The accepted source remained byte
identical. No live DB, unit, source or dependency was changed. Original source
hash da8cd26ced1c0c7bd496c6c8c21bb677d376515e317ca81edf4e174b7370e028.
The51,929,088-byte copy has14 entities/289 mentions/20 decisions/724 themes.
The vault was fresh/private; the analysis client was an explicit local-only
fallback fixture, so these timings exclude LLM latency and live-vault size.

| Stage | Observed ms |
|---|---:|
| init | 0.837 |
| decay | 2.546 |
| prune | 0.593 |
| reinforce | 0.266 |
| clusters | 0.151 |
| session notes | 116.754 |
| decision notes | 103.904 |
| theme notes | 45.265 |
| digest | 14.434 |
| summaries, local only | 104.567 |
| contradictions | 0.559 |
| promotion | 0.463 |

No expensive synchronous bottleneck was observed on this saved dataset.
This does not explain the old300s failure:25 concepts×12s is itself300s,
before local stages, and the historical symptom did not identify a stage.
Do not attribute it to synchronous SQL without evidence. General scale/
availability profiling remains an installation and memory-readiness concern;
any refusing drain retains its hold and requires explicit recovery.
