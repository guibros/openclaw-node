# OpenClaw Master Plan — North Star + Working Discipline

**Status:** v0 (draft, 2026-05-27). Authored after the May audit revealed that 5 review rounds + 22 commits in 24h produced ~0 production change due to absent work discipline + an undeployed runtime tree.

**Read this first, every session, before any tool use.** If you are about to Edit/Write/MultiEdit a file, the PreToolUse hook will block you unless an active plan scope (`memory-plan/plans/<id>/SCOPE.md`) lists it in an open ```files block. Don't fight the hook. Update the plan's SCOPE.md (with the operator) or stop.

---

## 1. What this document is

Two things in one:

1. **North-star architecture** — the target picture of every service under `~/.openclaw`. The thing you aim at. When code disagrees with this doc, *the code is wrong* unless this doc gets explicitly updated first.
2. **Working discipline** — non-negotiable principles + done-contract. The structure that prevents the "touch X, jump to Y, leave both half-done" pattern.

It is NOT the implementation plan. That's `INVENTORY.md` (the backlog, repurposed from the old framework). The 10-phase REFERENCE_PLAN has been moved to `archive/`.

It is NOT the current-state snapshot. That's `COMPONENT_REGISTRY.md`. This doc says where we're going; the registry says where we are.

It is NOT the per-session work order. That's `SCOPE.md`. This doc says what the system should be; SCOPE.md says what you can touch *today*.

---

## 2. System scope

Everything under `~/.openclaw/` plus the repos that ship code into it. Five service families:

| Family | What it does | Primary repo |
|---|---|---|
| **memory** | The memory pipeline — ingest, extraction, retrieval, injection. Federation when it lands. | `openclaw-nodedev` (this repo) |
| **companion-bridge** | The harness — sits between OpenClaw and the LLM. Rule injection, memory injection, context persistence. | `~/Documents/openclaw infrastructure/companion-bridge/` |
| **gateway** | The agent runner. External npm package `openclaw@*`. We don't modify it; we read its JSONL output. | external |
| **mesh** | Cross-node coordination (kanban, lessons, agent status). Mostly out of memory scope. | `openclaw-nodedev` |
| **mission-control** | Operations UI. Reads daemon state, kanban, etc. | sibling `mission-control/` |

Out of scope: anything outside `~/.openclaw/` or the four repos above.

---

## 3. Target architecture

The picture we're building toward. Current reality is in `COMPONENT_REGISTRY.md`; the deltas between this doc and that one are the backlog.

### 3.1 The user-to-memory loop

```
USER
  │
  ▼  types in OpenClaw or any LLM frontend (Claude Code, OpenWebUI, LibreChat, Continue, etc.)
LLM FRONTEND  (Anthropic, OpenWebUI, LibreChat, Cursor, etc.)
  │
  ▼  every prompt routes through the harness (HTTP)
COMPANION-BRIDGE  :8787
  │ harness.injectRules(prompt)        ← Tier 1/2/3 from harness-rules.json
  │ harness.injectMemory(prompt) ──┐   ← GET /memory/inject (loopback)
  │ contextMgr.wrapPromptWithContext  ← .companion-summary.md, .companion-state.md
  │ shouldRecycleSession recovery     ← context-out survival
  │                                │
  ▼                                │
LLM (cloud or local)               │
  │                                │
  ▼  writes JSONL                  │
~/.claude/projects/.../<sess>.jsonl  ──┐
~/.openclaw/agents/main/sessions/    ──┤
  │                                    │
  ▼                                    │
MEMORY DAEMON  (long-running, launchd-managed)
  │ Component 1: ingest             ◄──┘
  │   polls JSONLs, normalizes, writes session/messages to state.db
  │ Component 2: extraction
  │   end-of-session or hook-triggered LLM extraction of entities/themes/decisions
  │   writes to state.db extraction tables
  │ Component 3: consolidation
  │   periodic (30 min): decay, reinforce, cluster, summarize, promote
  │ Component 4: retrieval pipeline
  │   5 channels: FTS, vec, entity, theme, spreading-activation; RRF fuse
  │ Component 5: injection HTTP server  ◄── companion-bridge calls here
  │   :7893 /memory/inject
  │ Component 6: federation  (lands later)
  │   broadcaster/offerer/acceptor for cross-node context exchange
  │ Component 7: event log  (lands later)
  │   per-node JetStream stream; the substrate consolidation/federation observe
  ▼
SQLite databases (~/.openclaw/)
  state.db          — sessions, messages, FTS, + extraction tables (entities/themes/mentions/decisions)
  knowledge.db      — semantic vectors (BGE-M3, or chosen embedding model)
  graph-cache.db    — concept graph adjacency cache
  local-events/     — JetStream R=1 local event log (per node)
```

### 3.2 Operating constraints (from operator's deployment memory)

- **Consumer hardware.** Must run on a MacBook / mid-range Linux box. No 96-GB-RAM assumptions. LLM model selection is a static env var (`LLM_MODEL`, default qwen3:8b) used by every lane; `bin/check-llm-baseline.mjs` is an install-time RAM advisor whose recommendation nothing consumes at runtime. (Corrected 2026-06-10 per the repair-plan 3.1 audit, `plans/repair/LLM_INFRA.md` — a runtime tiered selector was documented here but never existed; building one is unclaimed future scope.)
- **Multilingual.** Embedding model must handle non-English. BGE-M3 over MiniLM.
- **LLM-frontend-agnostic.** The harness sits between any OpenAI-compatible client and any LLM. Memory injection works for Claude, Kimi, DeepSeek, local Qwen, etc.
- **Health-checked.** Every long-running component reports liveness. Restarts on crash via launchd KeepAlive. A health watcher surfaces degradation.
- **Local-first, federation-second.** Single-node must work fully offline. Federation is an optional capability that requires NATS cluster + explicit trust setup.

---

## 4. Working principles (non-negotiables)

These are the discipline. They are not aspirational — they are gates. If your work violates one, you stop until SCOPE.md updates or the principle changes (and the change goes through this doc first).

### 4.1 Code on disk ≠ shipped

A commit is not a delivery. Delivery requires:
- Code present in `~/.openclaw/workspace/` (or the relevant runtime tree)
- Daemon/service restarted to pick it up
- Observable runtime evidence the new behavior is actually happening

The deploy-gap is the single biggest failure mode of the previous round. *Closing it is non-negotiable.*

### 4.2 One scope per session

Before any Edit/Write tool call, `SCOPE.md` must declare today's scope: goal, files allowed, runtime evidence required, optional deadline. The PreToolUse hook enforces this. If you discover that today's scope was wrong, **stop**, update SCOPE.md with the operator, then continue. No silent expansion.

### 4.3 Drift back into the plan before drift kicks in

Every Edit/Write tool result: ask "is this still on-scope?" If you started doing something the scope doesn't list (refactoring "while you're here", fixing an unrelated bug, adding a helper "because it was bothering me"): stop. Either update SCOPE.md or revert.

**Addendum — capture without acting.** When you observe something out of scope that legitimately deserves attention (a bug, a security issue, a stale doc, a missing test, a dead code path you noticed while looking at something adjacent), do not act on it and do not silently drop it. Write it into `OUT_OF_SCOPE.md` as an **agnostic specification**: describe WHAT was observed and WHY it matters, not HOW to fix it. No prescribed solution, no code excerpts, no implementation prescription — those decisions belong to whoever scopes it later. The entry includes: date observed, file or area, one-line problem statement, severity guess, whoever-touches-it-next pointer if known. `OUT_OF_SCOPE.md` is reviewed at scope-closing checkpoints (end of session, end of feature, plan closure) and items get either promoted into SCOPE.md, escalated into INVENTORY.md, archived as won't-fix, or deferred forward. The doc is **always-writeable** — the PreToolUse hook permits Edit/Write to `OUT_OF_SCOPE.md` regardless of the active scope contract, because capturing drift IS the discipline, not a violation of it.

### 4.4 Finish-before-moving

A change is not finished until the done-contract is met for that change. "I'll come back to it" is a lie that costs the next reviewer hours. If you can't finish today, the unfinished work goes into INVENTORY.md as a tracked item and SCOPE.md gets updated to reflect the partial-finish state.

### 4.5 Reality before aspiration

Before any architectural change: verify the current state by reading the actual files, querying the actual DB, checking the actual process list. Don't trust prior docs. Audit notes (like AUDIT_2026-05-27.md) get re-verified before they're acted on — they decay.

### 4.6 No new daemons / no parallel implementations

If a service has an existing implementation, you EITHER (a) modify it in place OR (b) write a replacement and explicitly retire the old one in the same PR. Never both at once. The May-2026 disaster of building `bin/openclaw-memory-daemon.mjs` next to `workspace-bin/memory-daemon.mjs` is the canonical example of what this principle forbids.

### 4.7 Tests are not done-criteria

Tests passing is necessary but not sufficient. Done requires runtime evidence (see 4.1). Tests verify code correctness; runtime evidence verifies feature correctness.

### 4.8 Document the decision, not the change

Code comments explain WHY when non-obvious. Commit messages explain WHAT changed and WHY this change. Long-lived design decisions go into `DECISIONS.md` (append-only). Don't leave decision rationale in commit messages alone — they get buried.

### 4.9 Audits decay

Any audit (CODE_REVIEW, REVIEW_PASS, STUB_AUDIT, AUDIT, etc.) older than 14 days requires re-verification of any specific claim before that claim is acted on. A grep is cheaper than a wrong fix.

### 4.10 If the framework gets in your way, change the framework first

The previous round saw work happen OUTSIDE the framework's step boundaries (code-review remediation batches that weren't in INVENTORY.md). That's not allowed. If a kind of work doesn't fit the framework, the framework needs an explicit slot for it before that work begins.

---

## 5. The done-contract

For every SCOPE.md entry, "done" means **all four** of:

1. **Code change committed** to this repo (signed-off; no force-push to main).
2. **Runtime deployed** — change present in the runtime tree (`~/.openclaw/workspace/` for memory-daemon code, equivalent for other services).
3. **Service restarted** — daemon picked up the change (`launchctl kickstart -k`, or equivalent).
4. **Runtime evidence** — at least one of:
   - A log line emitted by the new code path (path + timestamp + grep proves it ran)
   - A DB query result that only the new code produces
   - An HTTP probe that only succeeds with the new code
   - A process state visible in `ps`/`launchctl list` that only the new code creates

If any of 1-4 is missing, the work is "in flight" not "done."

Library-only changes (where no daemon ships them) are NOT exempt — they still require evidence the change reached the runtime. A pure `lib/` change with no caller in any deployed binary is dead code and should not be committed.

---

## 6. The forcing function

This is how this doc gets enforced. None of it is voluntary.

### 6.1 Session bootstrap (read-time enforcement)

The repo's `CLAUDE.md` instructs every session to read this doc + `SCOPE.md` before any tool use. The global `~/.claude/CLAUDE.md` is daedalus' default bootstrap and points at the workspace; this doc lives in the repo and supplements that.

### 6.2 PreToolUse hook (write-time enforcement)

`.claude/settings.json` configures a hook (`.claude/hooks/scope-check.sh`) that fires before every `Edit`, `Write`, `MultiEdit`, `NotebookEdit`. The hook scans every `memory-plan/plans/*/SCOPE.md`, keeps those with `Status: active` and unexpired `Expires`, unions their **open** ```files blocks into the allow-list, and decides:

- **No active scope anywhere** → block: set a scope with the operator before editing.
- **Expired** → an expired scope contributes nothing; if none remain, block.
- **File not in any open block** → block: update the relevant plan's SCOPE.md or stop.
- **All clear** → allow.

**Batch lifecycle:** a ```files block may carry a label and the word `closed`
(` ```files <label> closed `) — a shipped batch. Closed blocks are pruned from the allow-list,
so finished work re-locks while its record stays in the file. One open block per in-flight
batch is the discipline.

**Exception:** every plan's own `SCOPE.md` and `OUT_OF_SCOPE.md` are always writeable. This protects the §4.3 capture mechanism (and scope refresh itself) from being blocked by the very enforcement that triggers the need to capture.

The hook is the only mechanism that physically prevents silent drift — and it gates only the edit tools; Bash file writes are a known hole, covered by convention, not enforcement. Bypassing it requires the operator's explicit override (`**Override:** true` on a scope).

### 6.3 Done-contract gate (commit-time enforcement)

(Phase 2 — not in initial implementation.) A pre-commit hook can be added that requires each commit to cite the runtime evidence per §5.4 in the commit message body, in a structured `Runtime-Evidence:` trailer. If absent, the commit is rejected. We'll add this once the workflow is stable.

---

## 7. File map of memory-plan/ (silo layout, since 2026-06-03)

```
canonical/              ← authored ONCE here; sync-canonical.sh copies into every silo
  MASTER_PLAN.md          this file. North star + discipline.
  PROTOCOL.md             the plan-silo operating base (silo anatomy, 9 phases, tick chain)
  FRAMEWORK_CANONICAL.md  the portable theory doc (see its Binding note)
  COWORK_MODEL.md         what this system is
  BLOCK_TEMPLATE.md       the shape a BLOCKED.md must take
  templates/              what new-plan.sh instantiates
plans/<id>/             ← one self-contained silo per plan (legacy, redesign, repair, protocol, …)
  INVENTORY.md            the step list ([ ]/[A]/[x]/[D]) — viewer discovery file
  VERSION                 vX.Y[-pre|-mid] carrier — viewer discovery file
  SCOPE.md                the work contract (per-batch ```files blocks; closed = re-locked)
  OUT_OF_SCOPE.md         drift capture, always-writeable
  DECISIONS.md            append-only architectural ledger
  ROADMAP.md              the plan's blocks and why
  COMPONENT_REGISTRY.md   runtime reality of what the plan touches
  TICK_PROMPT.md + automation.json   the autonomous-chain config
  audits/ · tick-logs/ · BLOCKED.md (only while blocked)
```

Pre-silo history (the old flat `memory-plan/` layout and its `archive/`) lives inside the
`legacy` silo. Archive material is read-only context: anything actionable gets re-extracted
into the live silo docs.

---

## 8. How a session flows under this regime

```
Session starts
  │
  ▼
Bootstrap (CLAUDE.md instruction) loads MASTER_PLAN.md + SCOPE.md + COMPONENT_REGISTRY.md
into context. You read them.
  │
  ▼
You verify SCOPE.md:
  - If empty/stale: tell the operator "scope must be set"; do nothing else until set.
  - If present and current: proceed.
  │
  ▼
Operator (or you, on operator approval) updates SCOPE.md with today's contract:
  - goal
  - files allowed to touch
  - runtime evidence required to declare done
  - optional deadline
  │
  ▼
You work. Every Edit/Write hits the PreToolUse hook. Wrong file → blocked.
  │
  ▼
Before committing: verify §5 done-contract is met.
  - Code committed? (will be, by this commit)
  - Deployed? (verify presence in runtime tree)
  - Restarted? (verify by launchctl list / ps / log line)
  - Evidence? (capture in commit message under Runtime-Evidence: trailer)
  │
  ▼
Commit lands. SCOPE.md `status` flips from `in_progress` → `done`.
  │
  ▼
Either: set next scope (operator decision), or session ends.
SCOPE.md stays. Next session reads it, sees yesterday's state.
```

---

## 9. What we're explicitly NOT doing this round

(Things from the previous round being retired. Listed here so they don't sneak back in.)

- **No more parallel implementations.** `bin/openclaw-memory-daemon.mjs` will either be merged into the workspace daemon or deleted. No "I built a thing next to the existing thing."
- **No more code-review remediation batches outside the inventory.** Every fix has a SCOPE.md entry or it doesn't happen.
- **No more "commit lands therefore done."** §5.4 evidence required.
- **No more new daemons until existing ones are healthy.** Federation goes into the workspace daemon, not a sibling daemon.
- **No more aspirational claims in INVENTORY.md.** A step is "done" only by §5.

---

## 10. Pointers (where to find things)

- Current state of every service: the active plan's `COMPONENT_REGISTRY.md`
- Today's scope: the active plan's `SCOPE.md` (`plans/*/SCOPE.md` with `Status: active`)
- Things observed but not acted on: the plan's `OUT_OF_SCOPE.md`
- Backlog of work: the plan's `INVENTORY.md`
- Architectural decisions: the plan's `DECISIONS.md`
- The forcing function: `.claude/settings.json` (hook config), `.claude/hooks/scope-check.sh` (hook implementation)
- Ground-truth audits live under `plans/<id>/audits/` — audits decay (§4.9): re-verify claims older than 14 days before acting.

---

## 11. Amendments to this doc

This doc evolves. Amendments must:

1. Be discussed with the operator before editing.
2. Land in their own commit with subject `master-plan: <one-line change>`.
3. Be summarized in `DECISIONS.md` if they change a principle or done-criterion.

The operator is the only authority for principle changes. Implementation details under §3 / §7 can be updated by the working agent (you) with operator review.
