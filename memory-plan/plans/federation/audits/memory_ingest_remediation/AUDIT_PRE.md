# AUDIT_PRE — memory ingest remediation (deep-review "memory-side warning", root-caused)

**Written:** 2026-07-16T14:54Z, after read-only investigation, before any fix. Cross-plan note:
the memory harness belongs to the (complete) redesign plan; this remediation is hosted here because
it falls out of the federation deep review's truth-reconciliation leg, operator-directed ("go").

## Ground truth established (live, 14:20–14:50Z)

**The memory pipeline is HALF dark — the worse half, graded green:**
- **Retrieval/injection: ALIVE.** Per-session `memory.injected`/`retrieved` events flowing all day
  (latest minutes ago); `:7893` answers (401 unauthenticated = auth enforced; the watcher's
  authorized probe returns a real memory block). The review's ":7893 down since 07-10" is stale.
- **Ingest: DEAD since Jul 14 23:04:49Z.** `state.db` newest message = `2026-07-14T23:04:49Z`
  while transcripts are being written RIGHT NOW (newest `10:47` local today). **New memories have
  not been made for ~40h.** Extraction's newest entity landing: **Jul 11** (`last_seen` max).
- **The watcher graded all of it WORKING** the entire time: `mem.ingest` "state.db readable +
  recent messages" checks COUNT>0, never recency; `mem.extraction` checks entities>0. Presence,
  not freshness — the same unearnable-green class as the federation quorum probe.

## Root cause (a chain of three, each verified)

1. **install.sh `claude_project_path()` strips the leading slash** (`sed 's|^/||; s|[/.]|-|g'`).
   Claude Code's real project-dir encoding KEEPS it: `/Users/moltymac/.openclaw/workspace` →
   `-Users-moltymac--openclaw-workspace` (leading dash). Verified against the actual
   `~/.claude/projects/` dir names. So the rendered registry's two claude-code paths
   (`Users-moltymac--openclaw-workspace/`, `Users-moltymac/`) **match nothing on disk**.
2. **Deploy day re-rendered the registry with those broken paths at Jul 14 19:11:17** (file mtime),
   and the daemon restarted onto it at 19:41:47 (pid 794, still running). Before 19:11 the registry
   covered the real dirs — state.db's biggest ingested sessions are from
   `-Users-moltymac-openclaw-nodedev` (1282/626/512 msgs; this session itself has 101 messages
   ingested pre-break). The rendered breakage dates the darkness exactly.
3. **`_detectActivity()` silently skips nonexistent source dirs** (`if (!existsSync) continue`) —
   no warning, ever. Only the `gateway` source survived (newest session Jul 14 19:17) → no activity
   detected → state machine parked ENDED → no ingest ticks, no extraction, for 39h+. The one log
   symptom: `[nats] skipping extraction — session state is ENDED`.

Also confirmed en route:
- The daemon's scary stderr (ReferenceError healthProbeTimer / mutex aborts) is **stale** — err log
  last written Jul 14 19:14, before the current boot. Current process is quiet.
- The env file carries **two `OPENCLAW_NATS_TOKEN` lines** (line 18 = live, matches the running
  server; line 19 = dead). JS resolution (`match`, first-wins) → live token; **shell sourcing
  (last-wins) → dead token** — and `ai.openclaw.mesh-agent.plist` shell-sources it, which plausibly
  explains "mesh-agent unit has never run since load."
- The `-Users-moltymac-openclaw-nodedev` repo project dir (where the operator's heavy sessions
  live) is in NEITHER the registry template NOR the legacy fallback — it was covered by the
  pre-Jul-14 registry only. The template needs a repo-project source, rendered from REPO_DIR.

## Plan

1. **install.sh** — fix `claude_project_path` (keep the leading dash); add
   `CLAUDE_PROJECT_REPO="$(claude_project_path "$REPO_DIR")"` + template sed rule.
2. **config/transcript-sources.json.template** — add the `claude-code-repo` source.
3. **workspace-bin/memory-daemon.mjs** — `_detectActivity` warns (once per path) when an enabled
   source dir doesn't exist. Silent skip is how 39h of darkness went unnoticed.
4. **lib/node-watch.mjs** — honest `mem.ingest` / `mem.extraction`: pure graders (exported,
   unit-tested with the REAL failure values) — ingest BROKEN when the newest transcript mtime
   leads the newest ingested message by >30min (and BROKEN naming missing enabled source dirs);
   extraction BROKEN when ingest has flowed >6h past the newest entity landing; UNKNOWN where
   unobservable. Never green on presence alone.
5. **Runtime:** correct `~/.openclaw/config/transcript-sources.json` (real dashed paths + repo
   source); dedupe `OPENCLAW_NATS_TOKEN` (drop the dead line); restart memory-daemon + node-watch.
6. **Observe:** daemon detects activity (ENDED→BOOT→ACTIVE in its log), state.db newest message
   jumps to now (this session's rows grow past 101), watcher grades ingest honestly.

## Contract
No inference: the close needs the observed ingest resumption + honest watcher grades. Token
ROTATION (both the NATS token and the MINIMAX key that echoed into transcripts — including once by
me today) is the operator's action, re-flagged in the POST, not silently absorbed.
