import type { TtsProvider, TtsRequest, TtsResponse } from "./types";

// VoiceStudio (AGPL) runs as a separate desktop app and is called over HTTP
// only — never vendored (D5). Its OpenAI-compatible speech endpoint is on
// loopback, where the sidecar grants full capability without a key.
// Read at call time, not at module load: the sidecar's address is operator
// configuration that can change between a restart of the app and a restart of
// Mission Control, and a module-scope capture would pin whatever was set the
// first time this file happened to be imported.
function baseUrl(): string {
  return (process.env.VOICESTUDIO_URL || "http://127.0.0.1:3900").replace(/\/+$/, "");
}
const HEALTH_TIMEOUT_MS = () => Number(process.env.VOICESTUDIO_HEALTH_TIMEOUT_MS) || 1500;
const SYNTH_TIMEOUT_MS = () => Number(process.env.VOICESTUDIO_TIMEOUT_MS) || 120_000;

// Documented bounds of the endpoint's own request model.
const MAX_INPUT_CHARS = 4096;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

/**
 * Fail in ~1.5s when the app is closed instead of burning the synth timeout.
 * synthesizeWithFallback only reaches the cloud providers after this throws, so
 * how fast it throws is how long a listener waits on a machine with no sidecar.
 */
async function assertReachable(base: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS()) });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    throw new Error(`VoiceStudio unreachable at ${base}: ${cause || (err as Error).message}`);
  }
  // 503 while models load is not ready — falling back beats a 2-minute wait.
  if (!res.ok) throw new Error(`VoiceStudio at ${base} not ready (health ${res.status})`);
}

export function createLocalTtsProvider(): TtsProvider {
  return {
    name: "local",
    async synthesize(req: TtsRequest): Promise<TtsResponse> {
      const base = baseUrl();
      await assertReachable(base);

      const body: Record<string, unknown> = {
        model: process.env.VOICESTUDIO_MODEL || "omnivoice",
        input: req.text.slice(0, MAX_INPUT_CHARS),
        voice: req.voice || "default",
        response_format: "mp3",
        speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, req.rate ?? 1)),
      };
      // `tone` is this node's word for the engine's `instruct` directive.
      // `pitch` has no counterpart here and is dropped rather than mapped onto
      // something that means something else.
      if (req.tone) body.instruct = req.tone;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.VOICESTUDIO_API_KEY) {
        headers.Authorization = `Bearer ${process.env.VOICESTUDIO_API_KEY}`;
      }

      const res = await fetch(`${base}/v1/audio/speech`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SYNTH_TIMEOUT_MS()),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`VoiceStudio speech ${res.status}: ${detail.slice(0, 200)}`);
      }

      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length === 0) throw new Error("VoiceStudio returned no audio");

      // The sidecar silently serves wav when it has no ffmpeg to make mp3, so
      // the header it sends is the truth and the requested format is not.
      return { audio, contentType: res.headers.get("content-type") || "audio/mpeg" };
    },
  };
}
