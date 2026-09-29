# Recovery tools foundation checkpoint

Recorded 2026-09-29 07:12:37 EDT; source5fabf6e integrated with main51a817f.

This PR lands the existing reviewed Journal, managed launchd stop adapter,
admission checks and isolated archive/restore tools. Its diff against current
main is confined to this plan and the recovery CI step. No production
entrypoint imports these tools; no controller, service installation, timer
hold or healthy production stop is added. All three Python tool hashes match
5fabf6e; see FOUNDATION_EVIDENCE.json.

A fresh private copied Journal consumer passes58 controls in25.552s. The prior
21 actual Mac managed-stop controls and one unavailable cross-domain negative
remain historical evidence inherited by unchanged source/test hashes. They
are not relabeled fresh runs. The earlier failed drafts and kernel events remain
intact. RUNTIME_EVIDENCE.md and the other evidence JSONs are tool-development
history, not a claim that preservation is live.

Claude98 accepts the foundation-first dependency sequence conditionally:
confined diff, no production imports, unchanged reviewed tool bytes, explicit
open parent outcome, scoped forensic history and exact integration CI3/3.
Exact-head re-review and CI are pending for this checkpoint.

Recovery1.2 remains[A]/v1.2-pre. The offline member-1 master and eleven separate
online archives retain their prior qualified acceptance. The three healthy
cold masters, complete controller/static baseline and truthful restoration
proof remain open. Bus3.5 consumes this one normal repository journal after
merge for owned restore-only hold-interruption controls;3.6 installs the five
actual Mac timers later. These dependencies do not certify a production
preservation window or close recovery1.2/1.3.
