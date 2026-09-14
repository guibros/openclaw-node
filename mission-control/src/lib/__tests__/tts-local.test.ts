import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

/**
 * tts-local.test.ts — integrations plan step 3.1.
 *
 * Mission Control's only voices were Google and Edge, both cloud, in a node
 * whose every other lane is local. The `local` provider calls VoiceStudio's
 * OpenAI-compatible endpoint on loopback and is now preferred.
 *
 * The server below is a real http.Server speaking the endpoints read from
 * VoiceStudio's source, so what is asserted about the request is what actually
 * crossed a socket. Whether the real app produces good audio is a separate
 * question that needs the app; this pins the client contract.
 */

let server: http.Server;
let base: string;
let lastRequest: { url: string; body: Record<string, unknown>; auth?: string };
let health: { status: number };
let speech: { status: number; contentType?: string; payload: Buffer | string };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      if (req.url === "/health") {
        res.writeHead(health.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: health.status === 200 }));
        return;
      }
      lastRequest = {
        url: req.url ?? "",
        body: raw ? JSON.parse(raw) : {},
        auth: req.headers.authorization,
      };
      res.writeHead(speech.status, { "Content-Type": speech.contentType ?? "audio/mpeg" });
      res.end(speech.payload);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.VOICESTUDIO_URL = base;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.VOICESTUDIO_URL;
  delete process.env.VOICESTUDIO_API_KEY;
});

beforeEach(() => {
  health = { status: 200 };
  speech = { status: 200, payload: Buffer.from("ID3fake-mp3-bytes") };
  delete process.env.VOICESTUDIO_API_KEY;
});

// The provider reads VOICESTUDIO_URL per call, so the failure-mode tests below
// can re-point it at a dead port without resetting the module registry.
const loadProvider = async () => (await import("../tts/local")).createLocalTtsProvider();

describe("registry", () => {
  it("lists local and prefers it, with the cloud providers behind it", async () => {
    const { listTtsProviders, DEFAULT_TTS_PROVIDER } = await import("../tts");
    expect(listTtsProviders()).toContain("local");
    expect(DEFAULT_TTS_PROVIDER).toBe("local");
    // Order matters: the fallback loop walks the rest in registration order.
    expect(listTtsProviders()).toEqual(["local", "google", "edge"]);
  });
});

describe("local provider request", () => {
  it("sends the documented body and returns the audio", async () => {
    const provider = await loadProvider();
    const out = await provider.synthesize({ text: "four nodes are up", voice: "narrator", rate: 1.25, tone: "calm" });

    expect(lastRequest.url).toBe("/v1/audio/speech");
    expect(lastRequest.body).toMatchObject({
      model: "omnivoice",
      input: "four nodes are up",
      voice: "narrator",
      response_format: "mp3",
      speed: 1.25,
      instruct: "calm",
    });
    expect(out.audio.length).toBeGreaterThan(0);
    expect(out.contentType).toBe("audio/mpeg");
  });

  it("clamps speed to the range the endpoint accepts", async () => {
    const provider = await loadProvider();
    await provider.synthesize({ text: "x", rate: 99 });
    expect(lastRequest.body.speed).toBe(4);
    await provider.synthesize({ text: "x", rate: 0.01 });
    expect(lastRequest.body.speed).toBe(0.25);
  });

  it("drops pitch rather than mapping it onto something else", async () => {
    const provider = await loadProvider();
    await provider.synthesize({ text: "x", pitch: -4 });
    expect(lastRequest.body).not.toHaveProperty("pitch");
    expect(lastRequest.body).not.toHaveProperty("instruct");
  });

  it("caps input at the documented 4096 characters", async () => {
    const provider = await loadProvider();
    await provider.synthesize({ text: "a".repeat(5000) });
    expect((lastRequest.body.input as string).length).toBe(4096);
  });

  it("sends a bearer token only when one is configured", async () => {
    const provider = await loadProvider();
    await provider.synthesize({ text: "x" });
    expect(lastRequest.auth).toBeUndefined();

    process.env.VOICESTUDIO_API_KEY = "shared-secret";
    await provider.synthesize({ text: "x" });
    expect(lastRequest.auth).toBe("Bearer shared-secret");
  });

  it("trusts the response content type, because mp3 degrades to wav without ffmpeg", async () => {
    speech = { status: 200, contentType: "audio/wav", payload: Buffer.from("RIFFfake-wav") };
    const provider = await loadProvider();
    const out = await provider.synthesize({ text: "x" });
    expect(out.contentType).toBe("audio/wav");
  });
});

describe("local provider failure modes", () => {
  it("fails fast when the app is closed, so the caller is not held for the synth timeout", async () => {
    process.env.VOICESTUDIO_URL = "http://127.0.0.1:1";
    const provider = (await import("../tts/local")).createLocalTtsProvider();
    const started = Date.now();
    await expect(provider.synthesize({ text: "x" })).rejects.toThrow(/unreachable/);
    expect(Date.now() - started).toBeLessThan(3000);
    process.env.VOICESTUDIO_URL = base;
  });

  it("treats a not-ready sidecar as unavailable rather than waiting on it", async () => {
    health = { status: 503 };
    const provider = await loadProvider();
    await expect(provider.synthesize({ text: "x" })).rejects.toThrow(/not ready \(health 503\)/);
  });

  it("surfaces an endpoint error with its status and body", async () => {
    speech = { status: 400, payload: JSON.stringify({ error: "unknown engine" }) };
    const provider = await loadProvider();
    await expect(provider.synthesize({ text: "x" })).rejects.toThrow(/speech 400.*unknown engine/);
  });

  it("refuses an empty body instead of handing back silence", async () => {
    speech = { status: 200, payload: Buffer.alloc(0) };
    const provider = await loadProvider();
    await expect(provider.synthesize({ text: "x" })).rejects.toThrow(/no audio/);
  });
});

describe("synthesizeWithFallback", () => {
  it("answers from local when it works", async () => {
    const { synthesizeWithFallback } = await import("../tts");
    const result = await synthesizeWithFallback({ text: "hello" });
    expect(result.actualProvider).toBe("local");
    expect(result.fallbackReason).toBeUndefined();
  });

  it("moves to another provider when local cannot answer, carrying local's reason", async () => {
    // A registered stand-in rather than a real cloud voice: whether google or
    // edge can answer depends on credentials and egress, and a test that asserts
    // "everything fails" passes for the wrong reason on a machine with neither.
    // The claim under test is that local's failure REASON survives onto whichever
    // provider does answer — true on a networked runner (edge answers) and on an
    // isolated one (the stand-in answers).
    vi.resetModules();
    const { synthesizeWithFallback, registerTtsProvider } = await import("../tts");
    registerTtsProvider("test-stand-in", () => ({
      name: "test-stand-in",
      synthesize: async () => ({ audio: Buffer.from("stand-in audio"), contentType: "audio/mpeg" }),
    }));

    process.env.VOICESTUDIO_URL = "http://127.0.0.1:1";
    const result = await synthesizeWithFallback({ text: "hello" });
    process.env.VOICESTUDIO_URL = base;

    expect(result.actualProvider).not.toBe("local");
    expect(result.fallbackReason).toMatch(/VoiceStudio unreachable at http:\/\/127\.0\.0\.1:1/);
    expect(result.audio.length).toBeGreaterThan(0);
  });
});
