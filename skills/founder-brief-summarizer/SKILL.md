---
name: founder-brief-summarizer
description: "Produce founder-grade strategic takes on links, posts, threads, docs, and screenshots with signal/risk/action framing. Use when user asks for an opinion, a take, or a summary of shared links, articles, or social posts."
triggers:
  - "what do you think of this"
  - "give me your take on"
  - "summarize this article"
  - "break down this thread"
negative_triggers:
  - "write a blog post"
  - "do deep research on this topic"
  - "translate this document"
---

# Founder Brief Summarizer

Deliver fast, high-signal analysis in the user's style.

## Output format

Use this structure unless user asks otherwise:
1. **Core claim** (1-2 lines)
2. **What is true / useful**
3. **What is weak / missing**
4. **So what for us** (project-specific implication)
5. **Recommended next move** (1-3 concrete actions)

## Workflow

1. Try direct fetch/extract first.
2. If blocked (login wall/paywall/script wall):
   - Request screenshot or pasted text immediately.
   - Do not stall with repeated failing fetch attempts.
3. Separate facts from interpretation.
4. Give an opinion, not a neutral recap.
5. Keep concise by default; expand only on request.

## Quality bar

- Avoid hype language.
- Flag uncertainty explicitly.
- Tie advice to active priorities (quality, novelty, speed, security).

## Scripts

- `scripts/brief_template.sh "<topic-or-link>"`
  - Generates a consistent founder-brief scaffold for rapid analysis.

## References

- Use `references/response-templates.md` for short and long variants.
- Use `references/validation-cases.md` for trigger/behavior smoke tests.
