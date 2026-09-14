# Runbook — codebase-memory-mcp (manual install)

**For:** integrations plan steps 2.1 and 2.2. This runbook is the *procedure*; the steps close only
when the probes at the bottom run on the design box.
**Status:** not yet performed. `COMPONENT_REGISTRY.md` records the binary as UNBUILT.

A code-intelligence engine (tree-sitter across 162 languages, plus Hybrid LSP type resolution)
exposing 14 MCP tools over stdio. Pure C, no language runtime, no hosted service, no API key.

## Why not the one-line installer

Upstream's headline install is `curl … install.sh | bash`, and the binary's own `install` subcommand
"auto-detects installed coding agents and configures their documented MCP entries plus durable
instructions, skills, and **lifecycle hooks** where supported."

**Never run it here (D4).** This node's governance lives in `.claude/settings.json` — a PreToolUse
hook (`.claude/hooks/scope-check.sh`) that refuses writes outside the active `SCOPE.md`. An installer
that writes agent hook configuration is exactly the thing that must not touch that file. Upstream's
table shows it editing `~/.augment/settings.json`, `.gemini/settings.json`, `.cursor/mcp.json` and
peers for other agents; do not give it the chance to reach ours.

Everything below is the same install done by hand, which is also what makes it auditable.

## 1. Fetch and verify

```sh
VER=v0.10.8
BASE="https://github.com/DeusData/codebase-memory-mcp/releases/download/${VER}"
cd ~/Downloads
curl -fLO "${BASE}/codebase-memory-mcp-darwin-arm64.tar.gz"
curl -fLO "${BASE}/checksums.txt"

# Verify BEFORE extracting. Nothing is unpacked until this prints OK.
shasum -a 256 -c checksums.txt --ignore-missing
```

Every release ships `checksums.txt` with SHA-256 hashes. If the check does not print
`codebase-memory-mcp-darwin-arm64.tar.gz: OK`, stop — delete the download and say so. Do not extract
"just to look".

## 2. Unpack to the workspace, not to PATH

```sh
DEST=~/.openclaw/workspace/lib/codebase-memory-mcp
mkdir -p "$DEST"
tar -xzf ~/Downloads/codebase-memory-mcp-darwin-arm64.tar.gz -C "$DEST"
"$DEST/codebase-memory-mcp" --version
```

Kept inside `~/.openclaw/workspace/lib/` rather than `/usr/local/bin` so the node owns its own copy
and a version bump is a directory swap. The executable is self-contained — no adjacent data file is
required.

macOS may refuse the first run as unsigned. Use Finder → right-click → Open once, or
`xattr -d com.apple.quarantine "$DEST/codebase-memory-mcp"` if you are satisfied the checksum
matched. Do not disable Gatekeeper globally.

## 3. No resident daemon

This node's rule is no new always-on processes (MASTER_PLAN §4.6). Two settings, and one trap:

```sh
cd "$DEST"
./codebase-memory-mcp config set auto_index false       # default is already false; set it so it is explicit
./codebase-memory-mcp config set watcher_enabled false  # default is TRUE — this one actually changes behaviour
./codebase-memory-mcp daemon stop
```

**`watcher_enabled` is read once when the background daemon starts.** Reconnecting your MCP client
will *not* restart the daemon, so a change without `daemon stop` leaves the old watcher running with
the old setting. That is why `daemon stop` is part of the procedure and not an afterthought.

(`auto_watch`, default `true`, is the per-session variant. With `watcher_enabled false` the poll
thread never starts at all, which is the stronger statement, so `auto_watch` is left alone.)

## 4. Register in `.mcp.json` — step 2.2

Beside the existing `knowledge` server:

```json
"codebase-memory": {
  "command": "${HOME}/.openclaw/workspace/lib/codebase-memory-mcp/codebase-memory-mcp",
  "env": {
    "CBM_CACHE_DIR": "${HOME}/.openclaw/workspace/.cbm",
    "CBM_ALLOWED_ROOT": "${HOME}/.openclaw/workspace",
    "CBM_MEM_BUDGET_MB": "4096"
  }
}
```

`CBM_ALLOWED_ROOT` is the one that matters: it bounds what the server may index to the workspace.
Add `.codebase-memory/` to `.gitignore` in the same change.

Note on cache roots: all active CBM processes must share one canonical `CBM_CACHE_DIR`. A genuinely
different root is rejected while any CBM process is active, and conflicts are recorded in
`${CBM_CACHE_DIR}/logs/daemon-conflicts.ndjson` — read that file first if a call fails oddly.

## 5. The tools

Indexing: `index_repository`, `list_projects`, `delete_project`, `index_status`.
Querying: `search_graph`, `trace_path` (alias `trace_call_path`), `detect_changes`, `query_graph`,
`get_graph_schema`, `get_code_snippet`, `get_architecture`, `search_code`, `manage_adr`,
`ingest_traces`.

That is 14 enumerated from upstream's two tool tables, while its badge claims 15. Enumerate from the
installed binary rather than from this list when writing the wrapper skill for 2.2 — the binary is
the authority, the README is not.

Every MCP tool also runs as a one-shot CLI command that starts no daemon:
`./codebase-memory-mcp cli trace_path --project openclaw-node --function-name createWorktree --direction inbound`.

## Probes that close the steps

**2.1** — on the design box:

1. `shasum -a 256 -c checksums.txt --ignore-missing` printed OK (capture the line).
2. `./codebase-memory-mcp config get watcher_enabled` prints `false`.
3. After a session ends, `pgrep -fl codebase-memory-mcp` returns nothing.

**2.2** — with the server registered:

1. `index_repository` over this repo.
2. `trace_path` answers "what calls `createWorktree`" naming `bin/mesh-agent.js`, **with zero Read
   tool calls in the transcript** — that last clause is the point of the step. An answer that needed
   file reads proves nothing the grep could not already do.
3. Skill scanner clean on the wrapper skill; `.gitignore` contains `.codebase-memory/`.

## Removing it

`./codebase-memory-mcp uninstall` removes owned agent config entries, skills, hooks, instructions and
the binary, and lists graph indexes before deleting them on confirmation. Since nothing was installed
through its installer here, prefer deleting `$DEST` and the `.mcp.json` entry by hand — symmetry with
how it went in.
