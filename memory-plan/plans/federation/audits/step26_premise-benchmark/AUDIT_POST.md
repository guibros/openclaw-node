# AUDIT_POST — Step 2.6 · Premise benchmark

**Closed:** 2026-07-15 · **Verdict:** PREMISE EVIDENCED (qualified pass) — operator directive
"3 then 2": one blind hand-run, then move to Block 3. Full 5-task automated benchmark abandoned
(finding: infeasible without heavier engineering — see below).

## The hand-run (blind, 30-min cap)

Task: harden FEDERATION_SPEC F1/F2/F4 (well-specified — the team's WEAKER case).
- **solo arm:** direct text-only claude/sonnet call (no tools, full stdout) — 2,673 chars.
- **grappe arm:** reused the tick's completed spec-harden circling session (max_subrounds:1,
  3 harness-loaded claude workers), largest workArtifact — 4,678 chars.
- Both de-identified + coin-flip blinded to A/B, key sealed.

**Result:** operator AND orchestrator independently picked B (blind) as the better answer.
Key reveal: **B = grappe, A = solo. The team won the blind head-to-head.**

**Why it won (honest):** the grappe answer verified claims against the actual file, cited
file:line for every fix, and tabulated a status summary — more thorough and better-grounded.
It was NOT a slam-dunk: (a) the win was thoroughness/rigor, not catching a defect the solo
missed; (b) the grappe answer left a loose end (cited node-identity.mjs:534 reading `event.node_id`
but still labeled `signer_node_id` as the checked field — an unreconciled inconsistency);
(c) it cost ~4–6× the solo's time/tokens.

**Verdict:** the collaboration produces observably better work on high-stakes artifacts (specs,
migrations, security-sensitive review) where thoroughness and grounding matter; for quick
well-specified fixes a solo OpenClaw is close enough and far cheaper. Consistent with 2.4, where
the grappe shone brightest on open-ended review (found COLLAB_MODE + node_id bugs unprompted).
Premise EVIDENCED — the plan does not BLOCK (D3). Proceed to Block 3.

## Why the full automated 5-task benchmark was abandoned (findings)

Three infra gremlins + one fundamental asymmetry, all cost real compute:
- **Wedged agents:** mesh-agents freeze after certain errors (e.g. a cancelled task mid-run) —
  processes alive but claiming nothing; a 3.5h driver run produced zero pairs. Needs a watchdog.
- **Truncated solo storage:** solo completion stored only `summary.slice(0,200)`. Fixed:
  mesh-agent completion now includes `result.output` = full worker stdout (this batch).
- **Fragment grappe artifact:** the "last" workArtifact is often a ~50-char preamble; fixed to
  take the LARGEST workArtifact (fed-benchmark.mjs).
- **FUNDAMENTAL asymmetry:** the solo mesh-agent path EDITS FILES directly (deliverable = git
  diff), while the grappe worker produces TEXT artifacts. A blind text-vs-text comparison is
  apples-to-oranges; symmetric capture needs either tool-constrained solo or diff-vs-diff — real
  additional engineering the premise question didn't warrant. The hand-run sidestepped this by
  running the solo tool-free (text-only), which is the correct design for any future full run.

## Carry-forward
- `bin/fed-benchmark.mjs` + `bin/fed-benchmark-driver.mjs` retained (with the two extraction
  fixes) for a future symmetric run if wanted; not wired to CI.
- mesh-agent full-output storage is a general improvement (kept).
- Block 3 inherits the COLLAB_MODE gap (cooperative/collaborative/management absent) the grappe
  itself found — direct groundwork.
