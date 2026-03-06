"use client";

import { useState, useRef, useCallback } from "react";
import { Send, Volume2, VolumeOff } from "lucide-react";

interface ChatInputProps {
  onSend: (text: string) => void;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  disabled?: boolean;
}

export function ChatInput({
  onSend,
  ttsEnabled,
  onToggleTts,
  disabled,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Auto-resize textarea
  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  return (
    <div className="flex items-end gap-2 p-3 border-t border-border bg-card/50">
      <button
        onClick={onToggleTts}
        className={`shrink-0 p-2 rounded-md transition-colors ${
          ttsEnabled
            ? "text-primary hover:bg-primary/10"
            : "text-muted-foreground hover:bg-accent"
        }`}
        title={ttsEnabled ? "Mute TTS" : "Enable TTS"}
      >
        {ttsEnabled ? (
          <Volume2 className="w-4 h-4" />
        ) : (
          <VolumeOff className="w-4 h-4" />
        )}
      </button>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          handleInput();
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      />

      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="shrink-0 p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
}
