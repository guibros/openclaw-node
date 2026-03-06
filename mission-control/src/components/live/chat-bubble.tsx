"use client";

import { format } from "date-fns";

interface ChatBubbleProps {
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  streaming?: boolean;
}

export function ChatBubble({
  role,
  content,
  timestamp,
  streaming,
}: ChatBubbleProps) {
  const isAgent = role === "agent";

  return (
    <div
      className={`flex ${isAgent ? "justify-start" : "justify-end"} mb-3`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
          isAgent
            ? "bg-card border border-border text-foreground"
            : "bg-primary text-primary-foreground"
        }`}
      >
        {isAgent && (
          <div className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
            Daedalus
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap break-words">
          {content}
          {streaming && (
            <span className="inline-block w-[2px] h-4 bg-current ml-0.5 align-text-bottom animate-pulse" />
          )}
        </div>
        <div
          className={`text-[10px] mt-1.5 ${
            isAgent ? "text-muted-foreground" : "text-primary-foreground/60"
          }`}
        >
          {format(timestamp, "HH:mm")}
        </div>
      </div>
    </div>
  );
}
