# SCOPE — repair plan

**Status:** idle
(Set to idle 2026-09-06: this scope was left `active` after its 2026-08-24 batch shipped and
then expired on 2026-08-26, at which point the hook read it as "no active scope" and blocked
every edit repo-wide — while CLAUDE.md said no scope was active. The record below is preserved.)
**Set at:** 2026-08-24 (operator selection, "Full fix — 4 files", after a fresh-machine install
of `openclaw-node` failed to install ollama, Homebrew, Tailscale, Node, and Python)
**Expires:** 2026-08-26T00:00:00Z
**Goal (2026-08-24 batch — fresh-install dependency bootstrap):** `install.sh` claims in the
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

```files 2026-08-24-bootstrap
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

```files
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
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
