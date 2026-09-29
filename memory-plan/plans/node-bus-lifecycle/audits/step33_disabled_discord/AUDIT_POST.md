# Step3.3 post-audit — 2026-09-29 06:08 EDT

## 1. Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Strict explicit-false preflight before token/runtime libraries | yes | Reviewed f21c6df entry d1341cfa; actual inactive diagnostic/exit0; private import controls |
| Preserve malformed/missing/enabled failure and legacy token behavior | yes | Ten real controls pass on private Mac Node24 and independently on Linux |
| Conditional unsuccessful-exit restart with preserved remaining policy | yes | Real owned Mac failure restarts seven times; disabled runs once and stays inactive |
| Preserve enabled permanent-loss recovery | yes | Real owned NATS loss exits1; old source exits0 and fails the regression |
| Explain inactive baseline and explicit planned restart | yes | Existing Discord runbook updated |
| Deploy the reviewed entry/policy without enabling Discord | yes | Actual bootout/bootstrap10:01:47UTC, entry d1341cfa, rendered plist6f532574; only entry/KeepAlive changed |
| Stable actual disabled unit and unchanged collateral | yes | Same-unit65.402s/84 samples10:05:28–10:06:34UTC, run1/exit0/noPID,13 other ownerPID/runs unchanged |

This closes the disabled-inactivity outcome only. The first, overly broad
zero-node-admission window remains refused; it is not silently made successful.
The later fresh same-unit window certifies its own interval, not the intervening
gap. No full preservation or production timer-hold acceptance follows.

## 2. Greppable deltas

- `rg -n 'enabled === false|closeError|createRegistry' bin/mesh-tool-discord.js`
  shows the strict guard before runtime import and the error-bearing close check.
- `rg -n 'SuccessfulExit|RunAtLoad' services/launchd/ai.openclaw.mesh-tool-discord.plist`
  shows unsuccessful-exit restart with RunAtLoad retained.
- `rg -n 'Restart=' services/systemd/openclaw-mesh-tool-discord.service`
  returns `Restart=on-failure`.
- `rg -n 'Optional mesh history tool' skills/discord-telegram-triage/references/discord-runbook.md`
  reaches the inactive/restart/baseline contract.
- `RUNTIME_EVIDENCE.json` links exact source CI36551411822, owned proof and live
  records by immutable hashes. Root Node20/22 each:2542 tests,2537 pass,
  five existing skips, zero failures/cancellations; Mission Control129 pass.

## 3. Cross-references and provenance

D19/INVENTORY3.3/AUDIT_PRE remain the governing contract. Claude80 approves
exact f21c6df, reproduces Linux10/10 and withdraws the unconditional shutdown
error suppression. Claude82 accepts the reported green exact CI and supplies
the live challenge. The live evidence/qualified closure was sent in message83.
Claude84 finds no blocker in the qualified reasoning/source-checkable facts;
message85 resolves its rollback question and bounds the monitoring follow-up.
The source review and Codex's Mac observations remain separately attributed.

Actual release:`~/.openclaw/releases/discord-inactive-f21c6df-e57`, retaining
immutable e57 base and the existing shared dependency link without install or
rebuild. Entry SHA256:
`d1341cfa04a3289c2338cc0e4a76e77dbf28d4c50f08ce5b18371c468b321d17`.
Rendered plist SHA256:
`6f53257453c9e8351d6c361840d474fc2be38f5548ce51bc635d446de430f67c`.
It preserves the actual environment/cwd/other argv and schedule values; it
is not a literal copy of unexpanded template bytes. Original aac55ff9 plist is
privately backed up. New identity dev16777233/ino58975700/mode0644/uid501/gid20
feeds the next baseline; prior refused preservation evidence is not recertified.

The release is a new path. Original
`/Users/moltymac/openclaw/bin/mesh-tool-discord.js` still hashes to
`2e0b4376b99cc36ebcd8d3bb6d21ff4708b16a5d40715bc950248ca8ac79e6ef`;
no primary entry was overwritten. Plist-only rollback after bootout, restoring
the backed-up original0644 plist then bootstrap, restores both original source
path and unconditional policy. It would restore the former crash loop, so it
is a fallback provenance record, not the healthy target. Config is not changed.

## 4. Findings

[POSITIVE] Actual RunAtLoad produces one inactive diagnostic, exit0 and loaded
not-running state. The fresh65s continuation has no further stdout/stderr bytes,
unchanged disabled/no-token/zero-account config hash3ee9c292, unchanged entry,
plist, primarye57 and13 other owners. All persistent bus clients remain intact;
no Discord client/subject is observed. HTTP-only stream metadata shows no
KV_MESH_TOOLS on any member; read-only actual MC DB count for module
mesh-tool-discord is zero. The strict early return and import controls exclude
registry/tracer/Discord request execution; no global live OS socket tracing is
claimed.

[NEGATIVE, retained] First live window3a40bb63 refuses after total node bus
admissions1858→1859. Closed-client monitoring identifies health-watch CID52638
at06:01:51EDT, after Discord's06:01:47 normal exit. No source/contract widening,
rollback or unrelated writer stop was used. Fresh continuation31e53566 records
admissions1876→1880 from ongoing other work and does not claim zero full-node
admissions. Initial read-only probe schema/pagination/timestamp errors and the
first fixture-node-ID failure remain unaccepted private records.

[NEGATIVE, separate parent work] `lib/node-watch.mjs:89` grades any loaded mesh
unit without a PID as BROKEN. This now conflicts with the accepted healthy
disabled state; no monitoring source was changed here. Feed node-readiness1.5
and its monitoring/installation follow-up with the explicit inactive baseline.

## 5. Phase8 patches

None. Source remains exactly reviewed f21c6df. Live closure review and the
documentation-only closure commit must retain that identity and pass exact CI.

## 6. Carry-forwards / Feeds

The separately bounded monitoring correction is the next atomic change after
this closure, before further journal/timer integration or any new production
preservation baseline. The currently queued3.4 journal/3.5 timer identifiers
are historical until the explicit next-step plan re-orientation maps them.
Timer installation follows journal integration/readiness. Recovery1.2 must
capture a new complete baseline including this approved inactive unit.
Full healthy-store preservation, general async-handler drain and Discord
enablement remain open/separate. Linux supervisor behavior requires its own
actual systemd/installer acceptance in the agnostic parent project.

Do not classify inactive Discord as absent or blindly restart it to satisfy
node-watch. Do not stop other writers to manufacture a passing3.3 window.
Existing registry hostname-default/config identity behavior remains a separate
operator-neutral cluster/install observation, with the failed fixture retained.
