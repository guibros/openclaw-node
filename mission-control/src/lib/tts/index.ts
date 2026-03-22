import type { TtsProvider, TtsRequest, TtsResponse } from "./types";
import { createGoogleTtsProvider } from "./google";
import { createEdgeTtsProvider } from "./edge";

export type { TtsRequest, TtsResponse, TtsProvider } from "./types";

// ── Pluggable TTS Provider Registry ──
// Built-in providers are registered by default. External code can register
// additional providers via registerTtsProvider() without modifying this file.

const providers: Record<string, () => TtsProvider> = {
  google: createGoogleTtsProvider,
  edge: createEdgeTtsProvider,
};

/** Register a custom TTS provider factory (e.g. "elevenlabs", "openai-tts"). */
export function registerTtsProvider(name: string, factory: () => TtsProvider): void {
  providers[name] = factory;
}

/** List all registered TTS provider names. */
export function listTtsProviders(): string[] {
  return Object.keys(providers);
}

export function getProvider(name: string): TtsProvider {
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown TTS provider: ${name}. Available: ${Object.keys(providers).join(", ")}`);
  return factory();
}

export interface SynthesisResult extends TtsResponse {
  actualProvider: string;
  fallbackReason?: string;
}

export async function synthesizeWithFallback(
  req: TtsRequest,
  preferred: string = "google"
): Promise<SynthesisResult> {
  try {
    const result = await getProvider(preferred).synthesize(req);
    return { ...result, actualProvider: preferred };
  } catch (err) {
    // Find first available fallback that isn't the preferred provider
    const fallbackNames = Object.keys(providers).filter((n) => n !== preferred);
    const reason = err instanceof Error ? err.message : String(err);

    for (const fallback of fallbackNames) {
      try {
        console.warn(
          `TTS provider "${preferred}" failed, trying "${fallback}": ${reason}`
        );
        const result = await getProvider(fallback).synthesize(req);
        return { ...result, actualProvider: fallback, fallbackReason: reason };
      } catch {
        // try next fallback
      }
    }

    throw new Error(`All TTS providers failed. Last error: ${reason}`);
  }
}
