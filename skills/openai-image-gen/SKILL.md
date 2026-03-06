---
name: openai-image-gen
description: "Batch-generate images via OpenAI Images API with random prompt sampler and HTML gallery output. Use when you need to generate AI images, create image batches, or produce an image gallery."
triggers:
  - "generate images with openai"
  - "create AI images"
  - "batch image generation"
  - "openai image gen"
negative_triggers:
  - "edit existing image"
  - "take a screenshot"
  - "stable diffusion"
  - "midjourney"
---

# OpenAI Image Gen

Generate a handful of “random but structured” prompts and render them via OpenAI Images API.

## Setup

- Needs env: `OPENAI_API_KEY`

## Run

From any directory (outputs to `~/Projects/tmp/...` when present; else `./tmp/...`):

```bash
python3 ~/Projects/agent-scripts/skills/openai-image-gen/scripts/gen.py
open ~/Projects/tmp/openai-image-gen-*/index.html
```

Useful flags:

```bash
python3 ~/Projects/agent-scripts/skills/openai-image-gen/scripts/gen.py --count 16 --model gpt-image-1.5
python3 ~/Projects/agent-scripts/skills/openai-image-gen/scripts/gen.py --prompt "ultra-detailed studio photo of a lobster astronaut" --count 4
python3 ~/Projects/agent-scripts/skills/openai-image-gen/scripts/gen.py --size 1536x1024 --quality high --out-dir ./out/images
```

## Output

- `*.png` images
- `prompts.json` (prompt ↔ file mapping)
- `index.html` (thumbnail gallery)
