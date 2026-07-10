# AUDIT_PRE — Step 0.1 · crash-loop root-cause (diagnosis only)

## §0 Micro Re-Orient (≤6 lines)
- **Where:** Block 0 (Spec + ground truth), step 0.1 — the plan's first action; overall 0/31 open.
- **Last step changed:** nothing built yet — the plan was authored, reviewed, and D4-reconciled.
- **This step contributes:** the evidence that says which dead mesh units are safe to revive vs must be fixed first — Block 0's ground-truth floor.
- **North-star line:** MASTER_PLAN "runtime-verified, not assumed" — you cannot revive what you have not diagnosed.
- **Still the right next step?** Yes. 1.2's revival Needs this triage; reviving blind is the May-2026 failure mode.

## Intent
Name the exact reason each dead/zombie OpenClaw unit stopped, across **both** launchd domains:
the 11 user-domain `~/Library/LaunchAgents/*.disabled` and the system-domain
`/Library/LaunchDaemons/com.openclaw.agent.plist` (D4). Diagnosis **only** — no unit is started,
no code is fixed, no plist is enabled. The single output is the DECISIONS crash-loop triage entry.

## Design
Per unit, produce one row `{unit · domain · exec-path · class · deciding-evidence · revive-precondition}`:
- **exec-path** — read each plist's `ProgramArguments`; flag any pointing at the pre-rename
  `-Users-moltymac-openclaw` path (the D4 / 2026-07-04b stale-config hypothesis) or an absent script.
- **deciding-evidence** — pull the crash window from the unified log
  (`log show --predicate 'process CONTAINS "mesh" OR eventMessage CONTAINS "openclaw"'`, the
  2026-07-03 window) + tail each unit's declared `StandardErrorPath`. Capture the actual failing line.
- **class** — exactly one of: **(a)** NATS-dependency loop (connect-fail tight loop, exit before
  the code faults), **(b)** code fault (stack trace / throw in the script), **(c)** stale-config
  fault (bad path/env from the pre-rename era, or a missing exec target).
- **revive-precondition** — what must be true/fixed before this unit may start in Phase 1
  (e.g. "cluster up" for class-a, "commit fix at file:line" for class-b/c). This is the field 1.2
  consumes; it does **not** perform the fix here.

Grouping expectation to test, not assume: several mesh units likely share one root (all point at
the same stale project dir, or all tight-loop on an absent NATS) — the triage records the shared
cause once and maps each unit to it. The two tick units (`memory-plan-tick`, `redesign-tick`) and
the aux units (`lane-watchdog`, `log-rotate`, `deploy-listener`) are classified too, but flagged
**out-of-federation-scope** if their cause is unrelated to the mesh substrate (they are not 1.2 Needs).

## Risk register
- **R1 — logs rolled off.** The 2026-07-03 window is 6 days old; `log show` may have aged out. If a
  unit's crash line is unrecoverable, its class is graded from plist+source static evidence and
  marked `evidence: static-only` — not fabricated. Honest UNKNOWN over invented certainty.
- **R2 — scope temptation.** Finding a one-line fix is in-scope to *record* as a revive-precondition,
  out-of-scope to *apply* (that's 1.2). Any fix applied here would be an atomicity break (§5.3).
- **R3 — domain miss.** The system-domain agent needs `launchctl print system/...` + root-owned plist
  read, not the user-domain `ls`. Covered explicitly so the D4 zombie isn't skipped.

## §6 File-delta outline (what Phase 4/9 will touch — nothing else)
- `audits/step01_crashloop-rootcause/AUDIT_PRE.md` — this file.
- `audits/step01_crashloop-rootcause/AUDIT_POST.md` — Phase 7 ledger.
- `DECISIONS.md` — the crash-loop triage entry (the step's product).
- `INVENTORY.md` — row 0.1 `[ ]`→`[A]`→`[x]`.
- `VERSION` — `v0.0`→`v0.1-pre`→`v0.1-mid`→`v0.1`.
- `COMPONENT_REGISTRY.md` — Phase 9: record the observed dead-unit inventory as runtime truth.
- **Zero production code / zero plist changes** — diagnosis-only step.

## Needs pre-screen (Phase 1 gate — all verified present 2026-07-09 22:35 EDT)
- ✅ 11 user-domain `.disabled` plists in `~/Library/LaunchAgents/`.
- ✅ system-domain `/Library/LaunchDaemons/com.openclaw.agent.plist` (root:wheel, 1101 bytes).
- ✅ `log` unified-logging tool available.
- ✅ mesh sources present in `bin/` (mesh-agent, mesh-bridge, mesh-task-daemon, …).
No missing Need → no BLOCK.
