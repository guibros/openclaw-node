import type { TtsProvider, TtsRequest, TtsResponse } from "./types";
import { createGoogleTtsProvider } from "./google";
import { createEdgeTtsProvider } from "./edge";

export type { TtsRequest, TtsResponse, TtsProvider } from "./types";

const providers: Record<string, () => TtsProvider> = {
  google: createGoogleTtsProvider,
  edge: createEdgeTtsProvider,
};

export function getProvider(name: "google" | "edge"): TtsProvider {
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown TTS provider: ${name}`);
  return factory();
}

export interface SynthesisResult extends TtsResponse {
  actualProvider: string;
  fallbackReason?: string;
}

export async function synthesizeWithFallback(
  req: TtsRequest,
  preferred: "google" | "edge" = "google"
): Promise<SynthesisResult> {
  try {
    const result = await getProvider(preferred).synthesize(req);
    return { ...result, actualProvider: preferred };
  } catch (err) {
    const fallback = preferred === "google" ? "edge" : "google";
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `TTS provider "${preferred}" failed, falling back to "${fallback}": ${reason}`
    );
    const result = await getProvider(fallback).synthesize(req);
    return { ...result, actualProvider: fallback, fallbackReason: reason };
  }
}
