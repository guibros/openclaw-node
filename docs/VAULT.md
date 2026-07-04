# The fused Obsidian vault

Since 2026-07-04 (operator decision) there is **one** vault: the machine's memory pipeline
lives inside the operator's real Obsidian vault instead of a hidden sibling directory.

```
<real vault>  (workspace/projects/arcane-vault — .obsidian, plugins, your notes)
├── 00-meta … 21-legal          ← operator sync domains (obsidian-sync push routes)
├── nodes/<nodeId>/…            ← per-node pushed files (recaps, lessons, state, …)
│   └── memory/                 ← THE MEMORY PIPELINE (this doc's subject)
│       ├── concepts/  sessions/  decisions/  themes/  daily/
└── (everything is browsable, graph-viewable, linkable in the Obsidian app)
```

## How the pipeline finds it

`getVaultPath()` in [lib/obsidian-vault.mjs](../lib/obsidian-vault.mjs) — one resolution used by
the writers, the graph parser, the link checker, and the node-watch `obs.*` probes
(Mission Control's `config.ts` mirrors it):

1. explicit `opts.vaultPath` (tests always use this — tmp vaults, never the live one)
2. `OBSIDIAN_VAULT_PATH` env override
3. **`memoryVaultPath` in `~/.openclaw/config/obsidian-sync.json`** — the fusion knob;
   workspace-relative (like the file's other paths) or absolute
4. legacy default `~/.openclaw/obsidian-local/` (fresh nodes before the operator points it
   at a real vault; the template ships the key empty)

The value is cached per process — restart the memory daemon and node-watch after changing it.

## What this buys

The vault is simultaneously the **retrieval substrate** (graph parser → graph-cache.db →
spreading activation = retrieval channel 5 → `:7893 /memory/inject`) and a **first-class
Obsidian experience**: machine-written concept/session/decision notes appear in your graph
view next to your own notes, wikilinks cross the boundary, and the operator sync keeps
pushing project docs into the same tree.

Migration record (this node): 157 notes moved from `obsidian-local` (now
`obsidian-local.pre-fusion-backup`), graph rebuilt identical (157 nodes / 1104 edges),
channel 5 verified live from the fused path (152 nodes activated from one seed).
