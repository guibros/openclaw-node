# OpenClaw Master Plan — North Star + Working Discipline

**Status:** v0 (draft, 2026-05-27). Authored after the May audit revealed that 5 review rounds + 22 commits in 24h produced ~0 production change due to absent work discipline + an undeployed runtime tree.

**Read this first, every session, before any tool use.**

---

## 1. What this document is

Two things in one:

1. **North-star architecture** — the target picture of every service under `~/.openclaw`. The thing you aim at. When code disagrees with this doc, *the code is wrong* unless this doc gets explicitly updated first.
2. **Working discipline** — non-negotiable principles + done-contract. The structure that prevents the "touch X, jump to Y, leave both half-done" pattern.

It is NOT the implementation plan. That's `INVENTORY.md` (the backlog, repurposed from the old framework). The 10-phase REFERENCE_PLAN has been moved to `archive/`.

It is NOT the current-state snapshot. That's `COMPONENT_REGISTRY.md`. This doc says where we're going; the registry says where we are.

It is NOT the per-step work order. That's the plan's `INVENTORY.md` row and its `AUDIT_PRE.md`. This doc says what the system should be; those say what is being built right now.

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

These are the discipline. They are not aspirational — they are gates. If your work violates one, you stop until the operator re-plans it or the principle changes (and the change goes through this doc first).

### 4.1 Code on disk ≠ shipped

A commit is not a delivery. Delivery requires:
- Code present in `~/.openclaw/workspace/` (or the relevant runtime tree)
- Daemon/service restarted to pick it up
- Observable runtime evidence the new behavior is actually happening

The deploy-gap is the single biggest failure mode of the previous round. *Closing it is non-negotiable.*

### 4.2 One change at a time

Know what the change is before you make it: for plan work, the step's `AUDIT_PRE.md` §6 file deltas; for an operator request, the request itself. Then make that change and nothing else. If it turns out to be wrong or to be two changes, **stop** and re-plan with the operator rather than widening it in place.

### 4.3 Drift back into the plan before drift kicks in

After every edit, ask "is this still the change I set out to make?" If you started doing something it doesn't cover (refactoring "while you're here", fixing an unrelated bug, adding a helper "because it was bothering me"): stop. Either re-plan with the operator, or revert.

**Addendum — report without acting.** When you notice something unrelated that deserves attention (a bug, a security issue, a stale doc, a missing test, a dead code path you saw while looking at something adjacent), don't fix it in the same change and don't silently drop it. Say WHAT you saw and WHY it matters — under the step's AUDIT_PRE `## Mid-Implementation Findings`, or in your report to the operator — and leave the how to whoever picks it up.

### 4.4 Finish-before-moving

A change is not finished until the done-contract is met for that change. "I'll come back to it" is a lie that costs the next reviewer hours. If you can't finish today, the unfinished work goes into INVENTORY.md as a tracked item and `VERSION` keeps its `-pre`/`-mid` suffix so the next session resumes at the right phase.

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

For every INVENTORY step, "done" means **all four** of:

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

The repo's `CLAUDE.md` instructs every session to read this doc before any tool use. The global `~/.claude/CLAUDE.md` is daedalus' default bootstrap and points at the workspace; this doc lives in the repo and supplements that.

### 6.2 Write-time enforcement — removed 2026-09-23

A PreToolUse hook (`.claude/hooks/scope-check.sh`) used to refuse any `Edit`/`Write` whose target
was not listed in an active, unexpired `plans/<id>/SCOPE.md`, so every edit in the repo was refused
whenever no unexpired scope existed. The hook, every `SCOPE.md` and every `OUT_OF_SCOPE.md` were
removed at the operator's instruction (protocol DECISIONS D11). Nothing gates edits; §4 is held by
whoever is working.

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
Bootstrap (CLAUDE.md instruction) loads MASTER_PLAN.md + the plan's COMPONENT_REGISTRY.md
+ INVENTORY.md into context. You read them.
  │
  ▼
Agree the change with the operator — an INVENTORY step (its AUDIT_PRE §6 deltas) or an
explicit request — and the runtime evidence that will prove it done.
  │
  ▼
You work on that change only. Unrelated observations are reported, not fixed (§4.3).
  │
  ▼
Before committing: verify §5 done-contract is met.
  - Code committed? (will be, by this commit)
  - Deployed? (verify presence in runtime tree)
  - Restarted? (verify by launchctl list / ps / log line)
  - Evidence? (capture in commit message under Runtime-Evidence: trailer)
  │
  ▼
Commit lands. For a step: the INVENTORY row flips to [x] and VERSION goes clean.
  │
  ▼
Either: pick the next change (operator decision), or session ends.
INVENTORY + VERSION carry the state. Next session reads them, sees yesterday's state.
```

---

## 9. What we're explicitly NOT doing this round

(Things from the previous round being retired. Listed here so they don't sneak back in.)

- **No more parallel implementations.** `bin/openclaw-memory-daemon.mjs` will either be merged into the workspace daemon or deleted. No "I built a thing next to the existing thing."
- **No more code-review remediation batches outside the inventory.** Every fix is an INVENTORY step or an explicit operator request, or it doesn't happen.
- **No more "commit lands therefore done."** §5.4 evidence required.
- **No more new daemons until existing ones are healthy.** Federation goes into the workspace daemon, not a sibling daemon.
- **No more aspirational claims in INVENTORY.md.** A step is "done" only by §5.

---

## 10. Pointers (where to find things)

- Current state of every service: the active plan's `COMPONENT_REGISTRY.md`
- What is being built right now: the plan's first `[ ]`/`[A]` `INVENTORY.md` row + its `audits/` entry
- Backlog of work: the plan's `INVENTORY.md`
- Architectural decisions: the plan's `DECISIONS.md`
- Commit/push validation: `.claude/settings.json` + `.claude/hooks/validate-{commit,push}.sh` (also wired as git hooks via `config/git-hooks`)
- Ground-truth audits live under `plans/<id>/audits/` — audits decay (§4.9): re-verify claims older than 14 days before acting.

---

## 11. Amendments to this doc

This doc evolves. Amendments must:

1. Be discussed with the operator before editing.
2. Land in their own commit with subject `master-plan: <one-line change>`.
3. Be summarized in `DECISIONS.md` if they change a principle or done-criterion.

The operator is the only authority for principle changes. Implementation details under §3 / §7 can be updated by the working agent (you) with operator review.
