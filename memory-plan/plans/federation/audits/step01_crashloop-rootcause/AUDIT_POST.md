# AUDIT_POST — Step 0.1 · crash-loop root-cause

## §1 Promised-vs-landed ledger
| Promised (AUDIT_PRE §6) | Landed? | Where |
|---|---|---|
| Per-unit triage {unit·domain·exec·class·evidence·revive-precondition} | **yes** | DECISIONS D5 table (12 units) |
| Both launchd domains covered | **yes** | user ×11 + system `com.openclaw.agent` — Domain column |
| Deciding evidence = actual failing line | **yes** | `Cannot find module '…/openclaw/bin/*.js'` tails quoted |
| Class per unit (a/b/c) | **yes** | all in-scope = **C**; redesign-tick = deliberate |
| Revive-precondition per unit | **yes** | D5 table col 5 + Consequences |
| No unit started / no code fixed / no plist enabled | **yes** | diagnosis-only; `git diff` = docs+VERSION only |
| VERSION carrier walked pre→mid | **yes** | v0.1-pre (Ph1) → v0.1-mid (Ph4) |

Every row **yes** → step is done.

## §2 Greppable deltas
- `grep -c "Cannot find module" mesh-task-daemon.err` → **269948** (crash-loop mass, one file).
- `grep "## D5" DECISIONS.md` → the triage entry present.
- `git diff --stat` → 4 tracked docs (DECISIONS +53, INVENTORY ±1 row, SCOPE, VERSION); **0 production code**.
- `PlistBuddy Print :ProgramArguments` (every unit) → first arg is a node/bash target under
  `/Users/moltymac/openclaw/…` — the vanished dir (`[ -e /Users/moltymac/openclaw ]` → ABSENT).

## §3 Cross-refs still valid
- INVENTORY 1.2 "mesh daemons revived per the 0.1 triage" → now resolves to **D5** (the entry exists). ✔
- INVENTORY 0.1 Verify "the DECISIONS triage entry cites … covering both launchd domains" → satisfied by D5. ✔
- D4 "com.openclaw.agent zombie … workdir absent" → corroborated: execs absent `~/openclaw/agent.js`, same root. ✔

## §4 Findings
- **[POSITIVE]** Single root cause for all 9 crash-looping units (a directory rename), not nine
  separate bugs — one fix pattern (re-render at live path) covers every in-scope unit.
- **[POSITIVE]** The four in-scope mesh daemons are **believed-good code stranded behind dead unit
  files** — 1.2 is a unit re-render, not a code rewrite. Materially de-risks Block 1.
- **[POSITIVE]** D4's retire decision independently corroborated: the system-domain zombie execs the
  absent prototype `~/openclaw/agent.js` — same dead root, reinforcing retire-not-revive.
- **[NEGATIVE / honest limit]** Code health is **unobservable** from these logs — MODULE_NOT_FOUND
  means the entry never loaded, so nothing is proven about whether the daemons *run* clean. Recorded
  as 1.2's precondition, not glossed.
- **[NEGATIVE / breadcrumb]** The err-file *heads* show an earlier `NatsError: TIMEOUT` era — a
  revived unit could trade class-C for class-A. 1.1 (cluster reachable) must precede 1.2 health.

## §5 Phase-8 patches
None. No architectural choice surfaced that wasn't already in DECISIONS (D5 is the product itself,
proposed and recorded in-phase).

## §6 Carry-forwards to the next step (0.2 → and Block 1)
- **To 1.2:** revive the 4 in-scope mesh units by **re-rendering the plist at the live install path**
  (install.sh already deploys correctly), never by re-enabling the stale `~/openclaw/…` plist.
  Verify NATS reachability (1.1) *before* declaring the revived daemon healthy — the class-A
  breadcrumb.
- **To 1.1:** the historical NATS TIMEOUT is the reason the cluster must be up + reachable before
  any daemon revival passes health. Ordering confirmed: 1.1 before 1.2.
- **To 6.1 / D4:** `com.openclaw.agent` (system domain) is a retire target, not a revive — same dead
  root. Its retirement belongs to the D4 fleet cleanup.
- **To 0.2 (next step):** FEDERATION_SPEC can state the substrate assumption plainly — daemons exec
  from the live install path; the `~/openclaw/` layout is dead. No open question blocks 0.2.
- **Housekeeping (out-of-fed-scope, captured not acted):** the duplicate deploy-listener pair
  (`ai.openclaw.deploy-listener` + `ai.openclaw.mesh-deploy-listener`, same script) is a §4.6 dup;
  the multi-hundred-MB stale `.err` files (72–263 MB × 6) are disk worth reclaiming. Neither is a
  federation Need — noted here, not promoted.
