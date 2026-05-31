# AUDIT_PRE — Step 4.4: Session-end synthesis trigger

**Version:** v4.3 → v4.4 · **Date:** 2026-05-31

## §0 Re-orient

- Where am I: Block 4 (Synthesis = the Karpathy wiki), step 4/9, 23/36 overall.
- Last step changed: 4.3 wired session-note generation into `runFlush`; operator verified `generateSessionNote` produces dated notes with `[[wikilinks]]`.
- This step contributes: makes synthesis fire reliably on session end — the D2 trigger that ensures MEMORY.md + concept notes + session notes update after every session.
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy LLM-Wiki synthesis layer) + §4 (readable output is the acceptance test).
- Still the right next step? Yes — 4.1-4.3 built the synthesis pipeline; 4.4 installs the session-end trigger; 4.5 installs the 30-min interval. Correct order.

## 1. Intent

Ensure synthesis (MEMORY.md generation + concept notes + session notes + `memory.synthesized` event) fires on ALL session-end transitions in the daemon, visible in the watcher.

## 2. Design

### Current state

The daemon's IDLE → ENDED handler (line ~959-991 of `memory-daemon.mjs`) already calls `runFlush` with LLM client + extraction store, and emits `memory.synthesized` with trigger `'session_end'`. This was wired as part of steps 4.1-4.3.

### Gap: ACTIVE → ENDED (session switch)

The ACTIVE → ENDED handler (line ~889-901) runs only "quick cleanup" (recap + clawvault observe). It does NOT run synthesis. When a session is preempted by a new session, the old session's data is never synthesized.

### Code change

1. Add synthesis to the ACTIVE → ENDED handler: find the old session's JSONL by session ID, run `runFlush`, emit `memory.synthesized` with trigger `'session_end'`.
2. Add explicit session-end synthesis log lines at both handlers (currently IDLE → ENDED only logs when `added > 0 || merged > 0`, making synthesis invisible in logs).
3. Add `findJsonlBySessionId(sources, sessionId)` helper — searches transcript source dirs for `<sessionId>.jsonl`.

### Carry-forward from 4.3

- Frontmatter `concepts:` format (inline wikilinks in YAML arrays) — cosmetic, not blocking. Deferred.

## 3. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| ACTIVE → ENDED synthesis delays new session boot | Medium — LLM extraction takes 10-30s | Acceptable: session switches are rare; data loss worse than delay |
| LLM (Ollama) unavailable at session end | Low — falls back to regex path | Existing graceful degradation in `runFlush` |
| `findCurrentJsonl` returns wrong JSONL during session switch | High — would synthesize wrong session | Use new `findJsonlBySessionId` to find old session specifically |

## 4. File-delta outline

| File | Change |
|---|---|
| `workspace-bin/memory-daemon.mjs` | Add `findJsonlBySessionId`; add synthesis to ACTIVE → ENDED handler; add explicit synthesis logging at both IDLE → ENDED and ACTIVE → ENDED |
