# AUDIT_PRE — Step 0.1: Symlink runtime lib/ → repo lib/

## §0 Re-orient (micro)

- **Where am I:** Block 0 (L0 deploy gap + NATS), step 1/4, 1/36 overall (first executable step of the whole redesign).
- **Last step changed:** nothing in the pipeline yet — prior work built the discipline/plan/tooling layer only.
- **This step contributes:** makes runtime `lib/` read directly from the repo, so every later fix actually reaches the running daemon (the Block-0 goal: repo↔runtime synced).
- **Block serves the north star via:** MASTER_PLAN §4.1 "Code on disk ≠ shipped" — closing the deploy gap is the non-negotiable prerequisite that makes all of L1–L6 observable.
- **Still the right next step?** Yes. INVENTORY first `[ ]` row; no prerequisite ahead of it.

## 1. Intent

Eliminate `lib/` drift between repo (`~/openclaw-nodedev/lib`, 41 .mjs, current) and runtime (`~/.openclaw/workspace/lib`, 31 .mjs, May 23) by replacing the runtime directory with a symlink to the repo directory. After this, there is one source of truth for `lib/` code and the gap cannot reopen.

Scope is `lib/` only. The daemon binary swap + restart is step 0.2; NATS is 0.3–0.4.

## 2. Design decisions

- **Symlink, not deploy-script** (AUDIT Decision 0c): repo IS runtime; zero ongoing sync needed.
- **node_modules: Option A — move the box** (operator-approved, to be logged in DECISIONS). The daemon's inject server dynamically imports `lib/mcp-knowledge/core.mjs`, which needs 580 MB of compiled native deps (better-sqlite3 + BGE-M3 stack) present ONLY in the runtime copy. Move them into repo `lib/mcp-knowledge/node_modules` (same-FS instant rename; already gitignored) before flipping the symlink, so retrieval keeps working.
- **No restart in 0.1.** The running daemon (PID 869) has its modules cached in memory; swapping the directory underneath it does not disturb it. Restart is deferred to 0.2 so we never run the old binary against the new lib. "Still boots" here = running daemon undisturbed + new wiring proven correct by a live retrieval.

## 3. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Symlink yanks node_modules → retrieval breaks | High if naive | Move the box first (step 1 before step 3) |
| Dynamic import fires in the move↔link gap | Low | Same-FS renames are sub-second; gap is ms; KeepAlive respawns if it ever hiccups |
| Old daemon binary + new lib incompatibility | Medium | We do NOT restart in 0.1; running process keeps in-memory modules; new-bin+new-lib happens together in 0.2 |
| Can't roll back | Low | Runtime `lib` renamed to `lib.bak-2026-05-28` (intact snapshot); rollback = rm symlink, mv backup back |
| Newer repo core.mjs (30K, May 26) incompatible with moved deps | Low | Same package-lock.json in both; deps unchanged; verify with a live retrieval |

## 4. File-delta outline

**Filesystem (Bash, not gated):**
- `mv ~/.openclaw/workspace/lib/mcp-knowledge/node_modules ~/openclaw-nodedev/lib/mcp-knowledge/node_modules`
- `mv ~/.openclaw/workspace/lib ~/.openclaw/workspace/lib.bak-2026-05-28`
- `ln -s ~/openclaw-nodedev/lib ~/.openclaw/workspace/lib`

**Repo paperwork (gated, in SCOPE):**
- `redesign/audits/step01_lib_symlink/AUDIT_PRE.md` (this), `AUDIT_POST.md`
- `redesign/INVENTORY.md` — flip 0.1 `[ ]` → `[x]`
- `COMPONENT_REGISTRY.md` — Family 8 (deploy gap) + 1.1 lib status toward synced
- `DECISIONS.md` — log node_modules Option A + 0.1 close
