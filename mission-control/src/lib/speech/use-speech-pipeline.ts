"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UseSpeechPipelineOptions {
  provider: "google" | "edge";
  voice?: string;
  tone?: string;
  enabled?: boolean;
}

interface SpeechPipelineReturn {
  speak: (text: string) => Promise<void>;
  stop: () => void;
  isSpeaking: boolean;
  isLoading: boolean;
  analyser: AnalyserNode | null;
}

export function useSpeechPipeline(
  options: UseSpeechPipelineOptions
): SpeechPipelineReturn {
  const { provider, voice, tone, enabled = true } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const queueRef = useRef<AudioBuffer[]>([]);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Lazily create AudioContext + AnalyserNode on first use
  const ensureAudioContext = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;

    const node = ctx.createAnalyser();
    node.fftSize = 128;
    node.smoothingTimeConstant = 0.8;
    analyserRef.current = node;
    setAnalyser(node);

    return ctx;
  }, []);

  // Play next buffer from queue
  const playNext = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || queueRef.current.length === 0) {
      playingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    playingRef.current = true;
    setIsSpeaking(true);

    const buffer = queueRef.current.shift()!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Connect: source → destination + analyser
    source.connect(ctx.destination);
    if (analyserRef.current) {
      source.connect(analyserRef.current);
    }

    currentSourceRef.current = source;

    source.onended = () => {
      currentSourceRef.current = null;
      playNext();
    };

    source.start(0);
  }, []);

  // Fetch TTS audio and queue for playback
  const speak = useCallback(
    async (text: string) => {
      if (!enabled || !text.trim()) return;

      const ctx = ensureAudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      setIsLoading(true);

      try {
        const controller = new AbortController();
        abortRef.current = controller;

        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, provider, voice, tone }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`TTS API error: ${res.status}`);
        }

        // Log fallback events
        const requested = res.headers.get("X-TTS-Requested");
        const actual = res.headers.get("X-TTS-Provider");
        const fallbackReason = res.headers.get("X-TTS-Fallback-Reason");
        if (actual && requested && actual !== requested) {
          console.warn(
            `[TTS] Requested "${requested}" but served by "${actual}" — ${fallbackReason || "unknown reason"}`
          );
        }

        const arrayBuf = await res.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);

        queueRef.current.push(audioBuffer);

        // Start playback if not already playing
        if (!playingRef.current) {
          playNext();
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Speech pipeline error:", err);
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [provider, voice, tone, enabled, ensureAudioContext, playNext]
  );

  // Stop current playback and clear queue
  const stop = useCallback(() => {
    // Abort in-flight TTS request
    abortRef.current?.abort();
    abortRef.current = null;

    // Stop current audio source
    try {
      currentSourceRef.current?.stop();
    } catch {
      // Already stopped
    }
    currentSourceRef.current = null;

    // Clear queue
    queueRef.current = [];
    playingRef.current = false;
    setIsSpeaking(false);
    setIsLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      try {
        currentSourceRef.current?.stop();
      } catch {
        // noop
      }
      audioCtxRef.current?.close();
    };
  }, []);

  return { speak, stop, isSpeaking, isLoading, analyser };
}
