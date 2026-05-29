# Block 3 Validation — LLM vs Regex Extraction Comparison

**Generated:** 2026-05-22T20:12:21.270Z
**Sessions evaluated:** 3
**LLM extraction available:** no (Ollama unavailable)

---

## Aggregate Metrics

| Metric | Regex | LLM |
|--------|-------|-----|
| Sessions processed | 3 | — |
| Avg facts/entities per session | 28 | — |
| Avg MEMORY.md chars | 1869 | — |
| Categories/types | agent_action, reference, preference, finding, decision | — |

---

## Per-Session Comparison

### Session 1: `d6607f55-28af-4b85-99c8-f091457c646a`

- **Start time:** 2026-03-29T20:48:56.734Z
- **Message count:** 557

#### Regex Extraction

- Facts extracted: 22
- Categories: agent_action, reference, preference, finding
- MEMORY.md length: 1717 chars

<details><summary>Regex MEMORY.md output</summary>

```markdown
# Memory

## Recent
- [assistant] Let me check if it's actually working:
- [assistant] http://localhost:3000/mesh`.
- [assistant] let me add that restart button you asked for. While you check the page, I'll build it:
- [assistant] I will kill the process and let launchd restart it (or for dev mode, just clear the .ne
- [assistant] /Library/LaunchAgents/ai.openclaw.mission-control.plist
- [user] /private/tmp/claude-501/-Users-moltymac-openclaw/d6607f55-28af-4b85-99c8-f091457c646a/tasks/b3grogizm.output
- [user] /private/tmp/claude-501/-Users-moltymac-openclaw/d6607f55-28af-4b85-99c8-f091457c646a/tasks/bf1tfmsba.output
- [user] /private/tmp/claude-501/-Users-moltymac-openclaw/d6607f55-28af-4b85-99c8-f091457c646a/tasks/bzmn8nvr0.output
- [user] /private/tmp/claude-501/-Users-moltymac-openclaw/d6607f55-28af-4b85-99c8-f091457c646a/tasks/bl0fu61wk.output
- [user] /private/tmp/claude-501/-Users-moltymac-openclaw/d6607f55-28af-4b85-99c8-f091457c646a/tasks/b3xvloxpp.output
- [user] /private/tmp/claude-501/-Users-moltymac-openclaw/d6607f55-28af-4b85-99c8-f091457c646a/tasks/bkoa3uknb.output
- [user] /private/tmp/claude-501/-Users-moltymac-openclaw/d6607f55-28af-4b85-99c8-f091457c646a/tasks/bdjtzy3do.output
- [user] /private/tmp/claude-501/-Users-moltymac-openclaw/d6607f55-28af-4b85-99c8-f091457c646a/tasks/bbvm410yd.output
- [assistant] don't have the latest code. Let me check what's actually deployed:
- [assistant] Let me check what's actually deployed:
- [assistant] The issue is the deployed UI components don't have the latest code. Let me check what's actua
- [assistant] Let me force-copy and verify:
- [assistant] I'll add a simple `InfoTooltip` component inline:
- [assistant] Let me commit them:
```
</details>

#### LLM Extraction

*LLM extraction unavailable — Ollama not running or health check failed.*

#### Manual Scoring

| Criterion | Regex (0-2) | LLM (0-2) | Notes |
|-----------|-------------|-----------|-------|
| Semantic coherence | | | |
| Signal-to-noise ratio | | | |
| Coverage of key topics | | | |
| Actionable information | | | |
| Fragment quality | | | |

---

### Session 2: `04baed44-7eda-4fbb-9085-0a2de6086e8d`

- **Start time:** 2026-03-05T02:37:30.076Z
- **Message count:** 340

#### Regex Extraction

- Facts extracted: 30
- Categories: agent_action, preference, decision, reference
- MEMORY.md length: 1713 chars

<details><summary>Regex MEMORY.md output</summary>

```markdown
# Memory

## Recent
- [assistant] Let me go back to the simple flat grid approach with in-cell bars using full-width nega
- [assistant] Let me simplify — go back to a per-day map for in-cell rendering, which is what we need
- [assistant] always match. Let me bring back the `metaBars` memo and restructure.
- [assistant] Let me get the full month view section to replace:
- [user] dont have anything written on it. Could you put its name on the beginning
- [user] always false when opening from calendar
- [user] dont necessarly go with an absolute positionning, u can just go full width in the day
- [user] don't appear in calendar after toggling "Show in calendar" checkbox. Root cause: check
- [user] don't pass these props.
- [user] Please continue the conversation from where we left off without asking the user any fur
- [user] switching to per-row wrapper approach.
- [user] /mission-control/src/app/calendar/page.tsx
- [user] /mission-control/src/components/board/unified-task-dialog.tsx
- [user] /mission-control/src/app/burndown/page.tsx
- [user] /mission-control/src/app/api/tasks
- [user] /mission-control/src/lib/sync/tasks.ts
- [user] /mission-control/src/lib/hooks.ts
- [user] /mission-control/src/lib/db/schema.ts
- [user] /app/roadmap/page.tsx
- [user] /app/burndown/page.tsx
- [user] /Users/moltymac/.claude/projects/-Users-moltymac--openclaw-workspace/04baed44-7eda-4fbb-9085-0a2de6086e8d.jsonl
- [user] Let me chronologically analyze the conversation:
- [assistant] Let me verify the last edit compiles cleanly.
- [assistant] Let me read the current calendar code and fix all three:
- [user] /Users/moltymac/.openclaw/workspace/memory/2026-03-05.md
- [assistant] Let me read the roadmap code.
```
</details>

#### LLM Extraction

*LLM extraction unavailable — Ollama not running or health check failed.*

#### Manual Scoring

| Criterion | Regex (0-2) | LLM (0-2) | Notes |
|-----------|-------------|-----------|-------|
| Semantic coherence | | | |
| Signal-to-noise ratio | | | |
| Coverage of key topics | | | |
| Actionable information | | | |
| Fragment quality | | | |

---

### Session 3: `aba1553c-016a-44b9-81f6-a1259f1ca9db`

- **Start time:** 2026-03-19T04:19:37.857Z
- **Message count:** 336

#### Regex Extraction

- Facts extracted: 32
- Categories: agent_action, preference, reference
- MEMORY.md length: 2178 chars

<details><summary>Regex MEMORY.md output</summary>

```markdown
# Memory

## Recent
- [assistant] Let me restart the local agent first.
- [assistant] let me check if the calos agent will pick up the new code next time it restarts natural
- [assistant] Let me try a different approach — use NATS to trigger a restart via a custom subject, o
- [assistant] Let me check if the calos agent is responsive by submitting a test.
- [assistant] Let me watch for both nodes to claim, join, and complete.
- [assistant] Let me wait and check the agent logs.
- [assistant] Let me check if the agents are actually polling and whether they can see/claim this tas
- [assistant] Let me restart it.
- [assistant] Let me kill the old one.
- [assistant] Let me check its logs to see if it picks up the task.
- [assistant] Let me clean up the leftover test data.
- [assistant] Let me check if calos agent is polling.
- [assistant] Let me check the session status and calos agent status.
- [assistant] let me check if there's a NATS-based way to trigger a restart, or if the calos agent ju
- [assistant] Let me check which commit calos is running.
- [assistant] Let me also check what other sessions might be stuck.
- [assistant] Let me check if the deploy-listener has a restart mechanism.
- [assistant] Let me check the deploy result more carefully and also check if there's a way to trigge
- [assistant] Let me try a different approach: use the deploy with `--force` or trigger a redeploy th
- [assistant] Let me also check how the deploy-listener handles force.
- [assistant] Let me create a tiny commit to force a real deploy with service restarts.
- [assistant] Let me abort the session calos is stuck in and clean up ALL remaining stale sessions.
- [assistant] Let me do a thorough KV cleanup of ALL non-live sessions.
- [assistant] Let me check if the sessions are stored with different key patterns.
- [assistant] Let me write a proper cleanup that aborts ALL non-live sessions.
- [assistant] Let me use a different approach with the `list` method from the daemon's collabStore.
- [assistant] Let me wait for calos to detect the aborts, then resubmit with a fresh task.
- [assistant] Let me check the result.
- [assistant] Let me get the detailed result.
```
</details>

#### LLM Extraction

*LLM extraction unavailable — Ollama not running or health check failed.*

#### Manual Scoring

| Criterion | Regex (0-2) | LLM (0-2) | Notes |
|-----------|-------------|-----------|-------|
| Semantic coherence | | | |
| Signal-to-noise ratio | | | |
| Coverage of key topics | | | |
| Actionable information | | | |
| Fragment quality | | | |

---

## Go/No-Go Decision Checklist

Answer each question after scoring all sessions above.

- [ ] LLM extraction produced higher average scores than regex across sessions
- [ ] LLM extraction produced fewer low-quality fragments (noise)
- [ ] LLM-generated MEMORY.md is more semantically organized (sections vs flat bullets)
- [ ] LLM extraction captured decisions and themes that regex missed
- [ ] No sessions where LLM extraction was significantly worse than regex

**Decision:** _[ GO / NO-GO / ITERATE ]_

**Notes:** _[operator assessment here]_
