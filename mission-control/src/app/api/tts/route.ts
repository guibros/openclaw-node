import { NextRequest, NextResponse } from "next/server";
import { synthesizeWithFallback, DEFAULT_TTS_PROVIDER, listTtsProviders } from "@/lib/tts";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.text || typeof body.text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const text = body.text.slice(0, 4000);
    // Unknown names fall to the default rather than erroring: the fallback
    // loop behind this already covers a provider that cannot answer.
    const provider = listTtsProviders().includes(body.provider) ? body.provider : DEFAULT_TTS_PROVIDER;

    const result = await synthesizeWithFallback(
      {
        text,
        voice: body.voice,
        rate: body.rate,
        pitch: body.pitch,
        tone: body.tone,
      },
      provider
    );

    // Convert Buffer to Uint8Array for NextResponse compatibility
    const audioBytes = new Uint8Array(result.audio);
    const headers: Record<string, string> = {
      "Content-Type": result.contentType,
      "Content-Length": String(result.audio.length),
      "X-TTS-Requested": provider,
      "X-TTS-Provider": result.actualProvider,
    };
    if (result.fallbackReason) {
      headers["X-TTS-Fallback-Reason"] = result.fallbackReason.slice(0, 200);
    }
    return new NextResponse(audioBytes, { status: 200, headers });
  } catch (err) {
    console.error("POST /api/tts error:", err);
    return NextResponse.json(
      { error: "TTS synthesis failed" },
      { status: 500 }
    );
  }
}
