import type { TtsProvider, TtsRequest, TtsResponse } from "./types";

export function createEdgeTtsProvider(): TtsProvider {
  return {
    name: "edge",
    async synthesize(req: TtsRequest): Promise<TtsResponse> {
      // Dynamic import — @andresaya/edge-tts is server-side only (uses Node WebSocket)
      const { EdgeTTS } = await import("@andresaya/edge-tts");

      const client = new EdgeTTS();

      // rate: convert multiplier (1.0 = normal) to percentage offset
      const rate = req.rate ? Math.round((req.rate - 1) * 100) : 0;
      // pitch: pass through as Hz offset
      const pitch = req.pitch ?? 0;

      await client.synthesize(
        req.text,
        req.voice || "en-GB-SoniaNeural",
        { rate, pitch }
      );

      const audio = client.toBuffer();
      if (!audio || audio.length === 0) {
        throw new Error("Edge TTS returned no audio data");
      }

      return { audio, contentType: "audio/mp3" };
    },
  };
}
