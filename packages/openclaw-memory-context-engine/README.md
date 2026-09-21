# @openclaw-node/memory-context-engine

An OpenClaw **context-engine plugin** that puts the openclaw-node memory daemon
in the gateway's `plugins.slots.contextEngine` slot. Every turn, `assemble()`
posts the latest user prompt to the daemon's loopback inject server
(`POST http://127.0.0.1:7893/memory/inject`) and returns the daemon's
`[memory: recent relevant context] … [end memory]` block as the system-prompt
addition. This replaces the companion-bridge proxy as the path memory takes into
the gateway.

What stays in the daemon: retrieval (the six-channel pipeline), the token
budget, `@memory` directives, reconsolidation write-back, and **extraction** —
the daemon already tails `~/.openclaw/agents/*/sessions/*.jsonl` and flushes on
idle / session end / pre-compaction size, so this plugin records nothing.
Compaction is delegated to OpenClaw's native compactor.

## Install

Requirements: OpenClaw ≥ 2026.5.27, the memory daemon running with its inject
server (`~/.openclaw/config/memory-injection-token` present).

```bash
# from a clone of openclaw-node
openclaw plugins install ./packages/openclaw-memory-context-engine
openclaw config set plugins.slots.contextEngine openclaw-node-memory
openclaw config get plugins.slots.contextEngine     # → openclaw-node-memory
```

Verify on the next turn: the gateway's system prompt carries the memory block,
and the daemon's `memory.injected` events (Mission Control → watcher) show
`frontend: "openclaw-context-engine"`.

## Configuration (`plugins.entries.openclaw-node-memory.config`)

| Key | Default | Meaning |
|---|---|---|
| `injectUrl` | `http://127.0.0.1:7893` | Must be loopback; the client refuses anything else. |
| `tokenPath` | `~/.openclaw/config/memory-injection-token` | Re-read on every request. |
| `autoRecall` | `true` | Inject on every turn. |
| `maxInjectedChars` | `6000` | Longer blocks are cut on a line boundary. |
| `timeoutMs` | `4000` | On timeout the turn proceeds without memory. |
| `bypassSessionPatterns` | `[]` | e.g. `agent:*:cron:**` — no recall for matching session keys. |

## Tools

- `memory_recall {query}` — on-demand recall (same block the auto path injects).
- `memory_status` — inject-server health and token presence.

## Failure behaviour

Daemon down, token missing, timeout, or block over budget → the turn runs
without memory and one warning is logged per distinct reason (not per turn).
