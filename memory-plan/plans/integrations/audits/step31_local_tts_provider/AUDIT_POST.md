# AUDIT_POST — step 3.1 · Mission Control `local` TTS provider

**Closed:** 2026-09-14, Montreal
**Version carrier:** `v3.1`
**Branch:** `claude/hermes-essential-skills-ch3s0o`

## What shipped

`mission-control/src/lib/tts/local.ts` implements `TtsProvider` against VoiceStudio's
OpenAI-compatible speech endpoint on loopback. It is registered **first** in the provider record
and `DEFAULT_TTS_PROVIDER` is now `"local"`, so the fallback order is local → google → edge: a node
whose every other lane is local no longer sends its text to a cloud voice by default.

The route stopped hard-coding a two-name whitelist. `listTtsProviders().includes(body.provider)`
means a provider registered later through the existing `registerTtsProvider` seam is reachable from
the API without editing the route again, and an unknown name falls to the default rather than
erroring — the fallback loop behind it already covers a provider that cannot answer.

## Two design points worth recording

**Config is read per call, not at module load.** The first draft captured
`const BASE = process.env.VOICESTUDIO_URL || …` at module scope. Two tests caught it: they re-point
the env var at a dead port after importing the module and still reached the live test server,
because the cached module held the old value. Moving the read inside `synthesize()` is the better
fix rather than resetting the module registry in the test — the sidecar's address is operator
configuration that can change between a restart of the app and a restart of Mission Control, and a
module-scope capture pins whatever was set the first time the file happened to be imported. The
two timeouts moved with it for the same reason.

**A 1.5 s health probe precedes every synthesis.** Without it, a closed desktop app costs the
listener the 120 s synth timeout before the first fallback is even tried. `assertReachable` also
treats a non-200 `/health` (503 while the engine loads its weights) as unavailable, because waiting
two minutes for a model that is still loading is worse than a cloud voice now.

`pitch` is dropped rather than mapped: the endpoint has no counterpart for it, and `tone` →
`instruct` is a real correspondence where `pitch` → anything would be an invention. The response's
own `Content-Type` is trusted over the requested `mp3`, because the sidecar silently serves wav
when it has no ffmpeg.

## Evidence

### `code:` — 13 tests, all green

`npx vitest run src/lib/__tests__/tts-local.test.ts` → **13 passed (13)**. The suite runs a real
`http.Server` speaking `/health` and `/v1/audio/speech`, so every assertion about the request is
about bytes that crossed a socket: registry order `["local","google","edge"]` and
`DEFAULT_TTS_PROVIDER === "local"`; the documented body (`model`, `input`, `voice`,
`response_format`, `speed`, `instruct`); speed clamped to [0.25, 4]; `pitch` dropped; input capped
at 4096 chars; the bearer sent only when `VOICESTUDIO_API_KEY` is set; the response content type
trusted; and four failure modes — refused connection (under 3 s), health 503, an endpoint error
carrying its status and body, and an empty 200 body refused instead of handed back as silence.

`npx tsc --noEmit` → exit 0.

Full Mission Control suite: **11 files / 138 tests passed**, up from 10 / 125 — no regression.
(`hyperagent-read.test.ts` failed first on a missing `better-sqlite3` native binding, an artifact of
this container's `npm ci --ignore-scripts`: `new Database(':memory:')` failed identically in plain
`node -e`, independent of this diff. `npm rebuild better-sqlite3` fixed it and the file passes.)

### `runtime:` — four probes against a live `next dev` on 127.0.0.1:3000

Mission Control requires its session token on every `/api` method, so each call carries
`Authorization: Bearer $(cat ~/.openclaw/config/mc-session-token)`.

| Probe | Request | Result |
|---|---|---|
| A — sidecar up | `{"text":"four nodes are up","voice":"narrator","rate":1.1,"tone":"calm"}` | `200`, `x-tts-provider: local`, `content-type: audio/mpeg`, 522 bytes, **no** fallback header. The sidecar logged exactly `{"model":"omnivoice","input":"four nodes are up","voice":"narrator","response_format":"mp3","speed":1.1,"instruct":"calm"}` |
| B — sidecar down | same text, no provider named | `500` in **252 ms**. Log: `local` failed `ECONNREFUSED` → tried `google` → tried `edge` → `All TTS providers failed`. The fast-fail budget holds with room to spare |
| C — cloud preferred, cloud broken | `{"provider":"google"}` with the sidecar up | `200` in 24 ms, `x-tts-requested: google`, `x-tts-provider: local`, **`x-tts-fallback-reason: GEMINI_API_KEY not configured`** |
| D — unknown name | `{"provider":"elevenlabs"}` | `200`, `x-tts-requested: local` — the unknown name fell to the default instead of erroring |

**What probe B does and does not prove.** It proves the header-free failure path and the elapsed
budget (252 ms ≪ 2 s), not a successful cloud fallback: this container has no `GOOGLE_API_KEY` and
no egress to Edge's endpoint, so all three providers legitimately failed. Probe C proves the
`X-TTS-Fallback-Reason` wiring on the same code path with the roles swapped — a failing preferred
provider, a working successor, the reason string carried through to the header. The exact
combination the INVENTORY row names (local down, a cloud voice answering) needs real cloud
credentials and is the operator's probe on the design box.

**The sidecar in probes A/C is a stand-in**, not VoiceStudio: a small `http.Server` speaking the two
endpoints read from VoiceStudio's source, returning an ID3 header plus frame-sync bytes. It pins the
client contract — URL, method, body, headers, content-type handling — and proves the route and the
fallback chain. Whether the real app produces good audio from these arguments is a separate
question that needs the app; VoiceStudio's row in `COMPONENT_REGISTRY.md` stays UNKNOWN until the
operator probes it.

### Configuration

`openclaw.env.example` gains a VoiceStudio block under `── Misc ──`: `VOICESTUDIO_URL`,
`VOICESTUDIO_MODEL`, `VOICESTUDIO_API_KEY` and the two timeouts commented out (the defaults are
correct for a local install, and leaving them unset costs nothing because the provider falls back in
~1.5 s when the app is closed), plus `OMNIVOICE_ANALYTICS_DISABLED=1` uncommented. D5 is restated in
the comment: HTTP only, never vendored, AGPL app, CC-BY-NC default weights so generated audio is
non-commercial.

## Cleanup

`next dev` generates `mission-control/AGENTS.md` and `mission-control/CLAUDE.md` on boot. Both were
deleted before the commit — they are build output, and a second CLAUDE.md in a subdirectory would
quietly compete with the repo's own bootstrap file.

## Left open

- The real-app probe above (operator, design box): install VoiceStudio, open it, repeat probes A
  and B, and listen to the bytes.
- Probe B's true form — local closed, a cloud voice answering with the reason header — needs
  `GOOGLE_API_KEY` or Edge egress.
- 3.2 gives VoiceStudio a report-only row in `openclaw-stack status`, which is what makes "is it
  open?" answerable without a curl.
