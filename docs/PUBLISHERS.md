# OpenClaw Publisher Integrations

This document describes how to connect any LLM frontend to OpenClaw's memory extraction system.
The core mechanism: publish a `mesh.memory.extract_request` event to NATS when a conversation
turn completes or a session ends. The memory daemon subscribes and runs the extraction pipeline.

## Architecture

```
LLM Frontend → Publisher → NATS (mesh.memory.extract_request) → Memory Daemon → Extraction
```

Three tiers of integration, from tightest to loosest:

| Tier | Type | Examples | Setup effort |
|------|------|----------|-------------|
| 1 | Direct hooks | Claude Code, OpenWebUI, LibreChat, Continue | Drop-in config/script |
| 2 | SDK wrappers | OpenAI, Anthropic, Gemini, MiniMax (+ OpenAI-compatible: Kimi, DeepSeek, OpenRouter) | 3 lines of code |
| 3 | Universal fallback | Manual CLI, idle timer | Zero (auto-enabled) |

## Prerequisites

- NATS server running (default `nats://localhost:4222`)
- OpenClaw memory daemon running (`workspace-bin/memory-daemon.mjs`)
- Node.js 18+ (for CLI tools and SDK wrappers)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `OPENCLAW_NODE_ID` | `os.hostname()` | Node identifier for provenance |
| `EXTRACTION_IDLE_THRESHOLD_SEC` | `2700` (45 min) | Idle timer before auto-extraction |

---

## Tier 1 — Direct Hooks

### Claude Code

Claude Code calls `.claude/hooks/pre-compact.sh` before context compaction.
OpenClaw ships a hook that fires an extraction event at this lifecycle point.

**Setup:** The hook at `.claude/hooks/pre-compact.sh` delegates to `hooks/claude-code/pre-compact.sh`
which calls `bin/openclaw-extract-now.mjs`. No manual configuration needed if OpenClaw is installed.

**How it works:**
1. Claude Code triggers the PreCompact hook
2. `pre-compact.sh` runs `node bin/openclaw-extract-now.mjs --triggered-by=claude-code-pre-compact`
3. The CLI connects to NATS, publishes the extraction event, exits
4. The memory daemon receives the event and runs extraction

### OpenWebUI

**Setup:**
1. Copy `hooks/openwebui/openclaw-publisher-plugin.py` to your OpenWebUI plugins directory.
2. Set `OPENCLAW_REPO_PATH` env var to the openclaw-nodedev repo root (auto-detected if in `~/openclaw-nodedev`).
3. Enable the plugin in OpenWebUI settings.

**How it works:** The plugin calls `bin/openclaw-extract-now.mjs` via subprocess (fire-and-forget)
on `on_message_complete` and `on_conversation_end` hooks.

**Limitations:** Requires Node.js available in the OpenWebUI server environment. If OpenWebUI
runs in a container, the extraction CLI must be accessible inside the container or via a
network-mounted volume.

### LibreChat

**Setup:**
1. Import `hooks/librechat/openclaw-trigger.js` in your LibreChat custom endpoint config.
2. Call `onResponse()` in your post-response handler.

```javascript
import { onResponse, shutdown } from './hooks/librechat/openclaw-trigger.js';

// In your endpoint handler:
const response = await model.generate(messages);
await onResponse();  // fire-and-forget extraction event
return response;
```

**How it works:** Uses the shared `publish-helper.mjs` for a lazy NATS connection.
The connection persists across requests for efficiency.

### Continue IDE

**Setup:**
1. Review `hooks/continue/openclaw-config.json` for the configuration template.
2. Add the extraction trigger to your Continue config.

**Limitations:** Continue's plugin API may not directly support post-response hooks.
The config file is a template — actual integration depends on Continue's current plugin capabilities.
As a fallback, the Tier 3 idle timer provides automatic extraction.

---

## Tier 2 — SDK Wrappers

SDK wrappers intercept LLM API calls and fire extraction events after each response.
They work with any application that uses the wrapped SDK — no frontend-specific hooks needed.

### OpenAI (+ Kimi, DeepSeek, OpenRouter)

```javascript
import OpenAI from 'openai';
import { createNatsPublisher } from 'openclaw-nodedev/lib/publishers/publish-helper.mjs';
import { wrapOpenAI } from 'openclaw-nodedev/lib/publishers/openai-wrapper.mjs';

const publisher = createNatsPublisher();
const client = wrapOpenAI(new OpenAI(), publisher);

// Works for OpenAI, Kimi, DeepSeek, OpenRouter (all OpenAI-compatible)
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});
// ^ Extraction event automatically published after response

// On shutdown:
await publisher.close();
```

### Anthropic

```javascript
import Anthropic from '@anthropic-ai/sdk';
import { createNatsPublisher } from 'openclaw-nodedev/lib/publishers/publish-helper.mjs';
import { wrapAnthropic } from 'openclaw-nodedev/lib/publishers/anthropic-wrapper.mjs';

const publisher = createNatsPublisher();
const client = wrapAnthropic(new Anthropic(), publisher);

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
});
// ^ Extraction event automatically published

await publisher.close();
```

### Google Gemini

```javascript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createNatsPublisher } from 'openclaw-nodedev/lib/publishers/publish-helper.mjs';
import { wrapGemini } from 'openclaw-nodedev/lib/publishers/gemini-wrapper.mjs';

const publisher = createNatsPublisher();
const genAI = new GoogleGenerativeAI(API_KEY);
const model = wrapGemini(genAI.getGenerativeModel({ model: 'gemini-pro' }), publisher);

const result = await model.generateContent('Hello');
// ^ Extraction event automatically published

await publisher.close();
```

### MiniMax

```javascript
import { createNatsPublisher } from 'openclaw-nodedev/lib/publishers/publish-helper.mjs';
import { wrapMiniMax } from 'openclaw-nodedev/lib/publishers/minimax-wrapper.mjs';

const publisher = createNatsPublisher();
const client = wrapMiniMax(minimaxClient, publisher);

const response = await client.chat.completions.create({ /* ... */ });
// ^ Extraction event automatically published

await publisher.close();
```

---

## Tier 3 — Universal Fallback

These mechanisms work with **any** LLM frontend, including closed-source applications
that don't support hooks or plugins.

### Manual CLI

Run extraction on demand:

```bash
node bin/openclaw-extract-now.mjs
node bin/openclaw-extract-now.mjs --triggered-by=my-app
```

### Idle Timer (Automatic)

The memory daemon includes a 45-minute idle timer (from Step 4.7). If no extraction event
arrives within the threshold, the daemon self-triggers extraction. This provides baseline
coverage for any frontend, including closed-source apps where no hook integration is possible.

Configure the threshold:
```bash
export EXTRACTION_IDLE_THRESHOLD_SEC=2700  # default: 45 minutes
```

---

## Closed-App Limitations

Some LLM frontends don't expose lifecycle hooks:

| Frontend | Hook support | Recommended tier |
|----------|-------------|-----------------|
| Claude Code | PreCompact hook | Tier 1 (direct) |
| OpenWebUI | Plugin API | Tier 1 (plugin) |
| LibreChat | Custom endpoints | Tier 1 (JS import) |
| Continue | Plugin API | Tier 1 (config) |
| ChatGPT (web) | None | Tier 3 (idle timer) |
| Claude.ai (web) | None | Tier 3 (idle timer) |
| Cursor | Limited | Tier 3 (idle timer) |
| Copilot | None | Tier 3 (idle timer) |

For closed apps, the idle timer is the primary mechanism. Consider running
`node bin/openclaw-extract-now.mjs` from a cron job or keyboard shortcut for
more timely extraction.

---

## Troubleshooting

**"failed to publish: Connection refused"**
- NATS server is not running. Start it: `nats-server` or via the launchd service.

**Extraction events published but nothing happens**
- Verify the memory daemon is running: `pgrep -f memory-daemon`
- Check daemon logs for extraction trigger messages.

**SDK wrapper doesn't fire events**
- Ensure the publisher was created before wrapping: `const publisher = createNatsPublisher()`.
- The publisher silently swallows errors — check NATS connectivity directly with `nats pub test "hello"`.

**Python plugin can't find the repo**
- Set `OPENCLAW_REPO_PATH=/path/to/openclaw-nodedev` in your environment.
