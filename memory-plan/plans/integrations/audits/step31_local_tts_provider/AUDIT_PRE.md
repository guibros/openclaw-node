# AUDIT_PRE — step 3.1 · local TTS provider

## §0 Micro re-orient (2026-09-14)

VERSION v5.4 → v3.1-pre. Block 5's runnable rows are closed; 2.1–2.2 need the macOS binary, so
Block 3 is the next runnable work. Needs pre-screen: the pluggable registry
(`registerTtsProvider`, `getProvider`, `synthesizeWithFallback`) exists ✔ · the route currently
hardcodes `body.provider === "edge" ? "edge" : "google"` ✔ · D5 locked (HTTP only, AGPL, CC-BY-NC
weights) ✔ · Mission Control has its own vitest suite and ten test files to match ✔.

## Intent

Mission Control's only voices are Google and Edge — both cloud, in a node whose every other lane
is local. A `local` provider calls VoiceStudio's OpenAI-compatible `/v1/audio/speech` on loopback
and becomes the preferred one, so speech stays on the machine whenever the app is running and
falls back to the cloud only when it is not.

## Design

- `local.ts` implements `TtsProvider` against `VOICESTUDIO_URL` (default `http://127.0.0.1:3900`).
- A `/health` probe with a short timeout runs first. This is the difference between a 1.5-second
  fallback and a 120-second one: without it, a closed app costs the caller the full synth timeout
  before `synthesizeWithFallback` moves on.
- Request body per the endpoint read in source: `model` (env-overridable, default `omnivoice`),
  `input` capped at 4096, `voice`, `response_format: mp3`, `speed` clamped to the documented
  0.25–4.0, and `instruct` carrying `tone` when present.
- `pitch` has no counterpart in that API and is dropped rather than silently mapped to something
  else.
- The response `Content-Type` is trusted, not assumed: the sidecar degrades mp3 to wav when it has
  no ffmpeg, and a caller told "audio/mpeg" for a wav payload would be lied to.
- Registry gains `local`; the route accepts it and defaults to it, making the order
  local → google → edge through the existing fallback loop.

## Risks

- Defaulting to `local` changes behaviour for every existing caller. That is the point of the
  step, and the fallback loop already covers the app being closed — but the probe has to be fast
  or the change is a regression in latency.
- The real VoiceStudio app cannot run here. The provider contract is provable against a server
  that speaks the same endpoints; the app's actual audio is the operator's probe. Labelled as such
  in the close, not blurred.

## §6 file-delta outline

- `mission-control/src/lib/tts/local.ts` (new), `index.ts` (register), `types.ts` (only if the
  request shape needs it), `app/api/tts/route.ts` (accept + prefer `local`).
- `mission-control/src/lib/__tests__/tts-local.test.ts` (new).
- `openclaw.env.example`: `VOICESTUDIO_URL` and the analytics kill switch from D5.
- Silo: INVENTORY, VERSION, COMPONENT_REGISTRY, AUDIT_POST.
