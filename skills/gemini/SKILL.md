---
name: gemini
description: "Gemini CLI for one-shot Q&A, summaries, and generation. Use when you need to call Google Gemini for a specific prompt, get a second-opinion answer, or generate content via the Gemini model."
homepage: https://ai.google.dev/
triggers:
  - "ask gemini"
  - "use gemini"
  - "gemini cli"
  - "google gemini"
negative_triggers:
  - "gemini deep research"
  - "openai"
  - "claude"
  - "chatgpt"
metadata: {"clawdbot":{"emoji":"♊️","requires":{"bins":["gemini"]},"install":[{"id":"brew","kind":"brew","formula":"gemini-cli","bins":["gemini"],"label":"Install Gemini CLI (brew)"}]}}
---

# Gemini CLI

Use Gemini in one-shot mode with a positional prompt (avoid interactive mode).

Quick start
- `gemini "Answer this question..."`
- `gemini --model <name> "Prompt..."`
- `gemini --output-format json "Return JSON"`

Extensions
- List: `gemini --list-extensions`
- Manage: `gemini extensions <command>`

Notes
- If auth is required, run `gemini` once interactively and follow the login flow.
- Avoid `--yolo` for safety.
