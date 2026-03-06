"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, ChevronDown } from "lucide-react";
import { ChatBubble } from "@/components/live/chat-bubble";
import { AudioSpectrum } from "@/components/live/audio-spectrum";
import { ChatInput } from "@/components/live/chat-input";
import { useSpeechPipeline } from "@/lib/speech/use-speech-pipeline";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
}

type TtsProvider = "google" | "edge";

const PROVIDER_LABELS: Record<TtsProvider, string> = {
  google: "Gemini",
  edge: "Edge",
};

export default function LivePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content:
        "Live Chat ready. TTS is active — agent responses will be spoken aloud. Type a message to test.",
      timestamp: new Date(),
    },
  ]);
  const [provider, setProvider] = useState<TtsProvider>("edge");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [providerOpen, setProviderOpen] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [tone, setTone] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  const { speak, stop, isSpeaking, isLoading, analyser } = useSpeechPipeline({
    provider,
    tone: tone || undefined,
    enabled: ttsEnabled,
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, agentTyping]);

  const addMessage = useCallback(
    (role: "user" | "agent", content: string): ChatMessage => {
      const msg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, msg]);
      return msg;
    },
    []
  );

  const handleSend = useCallback(
    async (text: string) => {
      addMessage("user", text);

      // Simulate agent response (placeholder — replace with real agent API later)
      setAgentTyping(true);

      // Mock delay
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));

      const agentResponse = generateMockResponse(text);
      addMessage("agent", agentResponse);
      setAgentTyping(false);

      // Speak the response if TTS is enabled
      if (ttsEnabled) {
        speak(agentResponse);
      }
    },
    [addMessage, ttsEnabled, speak]
  );

  const handleToggleTts = useCallback(() => {
    if (ttsEnabled) {
      stop();
    }
    setTtsEnabled((prev) => !prev);
  }, [ttsEnabled, stop]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Live Chat</h1>
          {(isSpeaking || isLoading) && (
            <span className="ml-2 text-xs text-primary animate-pulse">
              {isLoading ? "synthesizing..." : "speaking..."}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
        {/* Tone directive (Gemini only) */}
        {provider === "google" && (
          <input
            type="text"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="Tone: e.g. asmr whisper deep"
            className="px-2.5 py-1.5 text-xs rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground/50 w-48 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        )}

        {/* Provider selector */}
        <div className="relative">
          <button
            onClick={() => setProviderOpen((p) => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            TTS: {PROVIDER_LABELS[provider]}
            <ChevronDown className="w-3 h-3" />
          </button>
          {providerOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setProviderOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-md shadow-lg py-1 min-w-[120px]">
                {(["google", "edge"] as TtsProvider[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setProvider(p);
                      setProviderOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                      p === provider
                        ? "text-primary font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {PROVIDER_LABELS[p]}
                    {p === "google" && (
                      <span className="ml-1 text-muted-foreground/50">
                        (Flash)
                      </span>
                    )}
                    {p === "edge" && (
                      <span className="ml-1 text-muted-foreground/50">
                        (free)
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      {/* Audio spectrum */}
      <div className="border-b border-border bg-background/50">
        <AudioSpectrum
          analyser={analyser}
          isSpeaking={isSpeaking}
          height={48}
          barCount={32}
        />
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            timestamp={msg.timestamp}
          />
        ))}
        {agentTyping && (
          <ChatBubble
            role="agent"
            content=""
            timestamp={new Date()}
            streaming
          />
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        ttsEnabled={ttsEnabled}
        onToggleTts={handleToggleTts}
        disabled={agentTyping}
      />
    </div>
  );
}

// Placeholder mock responses — replace with real agent integration
function generateMockResponse(input: string): string {
  const lower = input.toLowerCase();

  if (lower.includes("status") || lower.includes("how are")) {
    return "All systems nominal. Mission Control is running, pipeline tasks are queued for Month 1 kickoff on March 2nd. No blockers detected.";
  }
  if (lower.includes("task") || lower.includes("what")) {
    return "Current active pipeline: Arcane Rapture — 478 tasks across 12 months. Phase 0 (Foundation & Infrastructure) starts March 2nd with smart contracts, Unity scaffold, and lore bible.";
  }
  if (lower.includes("hello") || lower.includes("hey") || lower.includes("hi")) {
    return "Hey. What do you need?";
  }
  if (lower.includes("test")) {
    return "TTS test successful. You should be hearing this through your selected provider. If not, check the browser console for errors.";
  }

  return `Received: "${input}". This is a placeholder response — real agent integration will pipe through the OpenClaw API. For now, the TTS pipeline is what we're testing.`;
}
