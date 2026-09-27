# SCOPE — repair plan

**Status:** active
**Set at:** 2026-09-26 (operator approval via AskUserQuestion, "Repair silo batch", after a read-only audit of the live `~/.openclaw/state.db`: 20 decisions left of the 337 counted in July, 14 live entities against 1,107 archived, 0 entity aliases, no automated backup anywhere)
**Expires:** 2026-09-30T00:00:00Z
**Goal (2026-09-26 batch — consolidation archives, it does not destroy):** `pruneStale` hard-deletes
every decision whose salience decays below 0.05 (since 01b7bbb, 2026-09-06), contradicting the
module's own "archive (don't hard delete)" contract. Entity decay anchors on `last_recalled` alone once
an entity has ever been recalled, so later mentions never reset its clock. Archival deletes the entity's
mention rows and cascades its aliases away, so a re-mention through an alias mints a fresh entity. No
per-row trail survives a cycle. Fix: decisions move to `decisions_archived` and are resurrected on
re-mention. Entity and decision decay anchor on the latest of recall and sighting. Archival carries every
live column plus the entity's mentions and aliases, and resurrection (by canonical name or by archived
alias) restores them under the original id. Archives are no longer purged (operator, same session:
"Stop purging archives"). `CONSOLIDATE_PRUNE=0` disables the prune step. Idle-theme deletion, the one
hard delete left, runs only once a `VACUUM INTO` backup no older than 24 h exists under
`~/.openclaw/backups/consolidation/` (rotated). Per-row prune records reach the scheduler log and the
`memory.decayed` event. Verification: `npm test` green. Runtime evidence (deploy, the first cycle's
per-row log and backup file on the node) is the operator's step, so nothing closes on the commit alone
(MASTER_PLAN §4.1).

```files 2026-09-26-consolidation-archive
lib/consolidation.mjs
lib/memory-archive.mjs
lib/extraction-store.mjs
lib/sqlite-store.mjs
lib/memory-watcher.mjs
bin/consolidate.mjs
bin/consolidation-scheduler.mjs
packages/event-schemas/src/memory/decayed.ts
test/*
memory-plan/plans/repair/DECISIONS.md
```

## Record — earlier batches (closed)

**2026-08-24 batch — fresh-install dependency bootstrap.** Set at 2026-08-24 (operator selection,
"Full fix — 4 files", after a fresh-machine install of `openclaw-node` failed to install ollama,
Homebrew, Tailscale, Node, and Python); expired 2026-08-26. The scope was left `active` after the batch
shipped, then expired, at which point the hook read it as "no active scope" and blocked every edit
repo-wide — while CLAUDE.md said no scope was active. Set to idle 2026-09-06.
Goal: `install.sh` claims in the
README that Node.js, Python 3, Git, SQLite3, build tools, nats-server and ollama are
"auto-installed". On macOS only nats-server and ollama actually are; Git/SQLite3/curl hit empty
`if [ "$OS" = "linux" ]` branches and no-op silently, build tools are never checked at all, and
Node/Python `exit 1`. On Linux, `apt-get update` runs only inside the node-missing branch, so a
box that already ships Node 22 installs against stale lists and dies mid-run under `set -e`.
Separately, the README's recommended entrypoint `npx openclaw-node-harness` cannot bootstrap
Node, because npx requires Node — and `engines: >=22` contradicts the documented "Node.js 18+"
baseline. Fix: add a dependency-free `scripts/install/prereqs.sh` bootstrap (Homebrew +
Tailscale included), wire it into `install.sh`, repair the macOS/Linux branches in
`system-deps.sh`, and correct the README's false claims and entrypoint ordering. Verification is
`bash scripts/install/prereqs.sh --check` plus `bash install.sh --dry-run`.

**Prior goal (v7.8, idle):** ALL ACTIVE BLOCKS COMPLETE at v7.8 (Blocks 1–7, 49/49 steps, every Proof runtime-captured; suite 1550/0). Remaining scope: Block P (parked security R34–R38, operator-held — the 'working prototype' precondition is now met). Next action is an operator decision: open Block P, commission captured OUT_OF_SCOPE items, or close the plan. (2026-06-11: one labeled hotfix ran under this scope — hydration-mismatch skeleton widths, see git log — scope returned to idle.)

```files 2026-08-24-bootstrap closed
bootstrap.sh
scripts/install/prereqs.sh
scripts/install/system-deps.sh
scripts/install/llm-setup.sh
install.sh
README.md
```

**Addendum 2026-08-24 (operator: "second wave for the llm model, with confirmation"):**
wave 1 (bootstrap.sh) installs binaries only and runs `install.sh --skip-llm`; wave 2
(`scripts/install/llm-setup.sh`) prompts before downloading the RAM-tiered Qwen3 model
(5-18 GB) plus the Xenova/bge-m3 embedder (~2 GB). Prompt reads `/dev/tty`, since under
`curl | bash` stdin is the script itself. No tty means SKIP, never hang.

```files 2026-06-blocks-1-7 closed
services/launchd/*
test/*
packages/event-schemas/*
workspace-bin/memory-daemon.mjs
lib/pre-compression-flush.mjs
lib/memory-inject-server.mjs
bin/consolidate.mjs
bin/memory-promoter.mjs
lib/memory-budget.mjs
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Batch lifecycle:** label each batch's block (` ```files <label> `) and append `closed` to the
  fence when it ships — closed blocks are pruned from the allow-list.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
