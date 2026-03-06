import type { TtsProvider, TtsRequest, TtsResponse } from "./types";

const GEMINI_TTS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent";

// Wrap raw PCM (16-bit mono 24kHz) in a WAV header so browsers can decode it
function pcmToWav(pcm: Buffer): Buffer {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);         // chunk size
  header.writeUInt16LE(1, 20);          // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export function createGoogleTtsProvider(): TtsProvider {
  return {
    name: "google",
    async synthesize(req: TtsRequest): Promise<TtsResponse> {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not configured");
      }

      const response = await fetch(GEMINI_TTS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: req.tone ? `Say in ${req.tone}: ${req.text}` : req.text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: req.voice || "Kore",
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini TTS error ${response.status}: ${err}`);
      }

      const data = await response.json();
      const pcmBase64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!pcmBase64) {
        throw new Error("Gemini TTS returned no audio data");
      }

      const pcm = Buffer.from(pcmBase64, "base64");
      const wav = pcmToWav(pcm);
      return { audio: wav, contentType: "audio/wav" };
    },
  };
}
