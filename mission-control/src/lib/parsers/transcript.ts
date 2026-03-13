import fs from "fs";
import path from "path";

/**
 * Represents a single activity event extracted from the JSONL transcript.
 */
export interface TranscriptEvent {
  timestamp: string;
  type: "file_write" | "file_edit" | "file_read" | "bash_command" | "bash_result" | "message";
  tool: string;
  detail: string;       // human-readable summary
  filePath?: string;     // for file operations
  command?: string;      // for bash commands
  success?: boolean;     // for bash results (exit code 0 = true)
}

/**
 * Transcript source directories — scans ALL frontend transcript stores.
 */
const TRANSCRIPT_DIRS = [
  // Claude Code workspace sessions
  path.join(process.env.HOME || "/Users/moltymac", ".claude/projects/-Users-moltymac--openclaw-workspace"),
  // OpenClaw Gateway sessions (Discord, Telegram, etc.)
  path.join(process.env.HOME || "/Users/moltymac", ".openclaw/agents/main/sessions"),
];

/**
 * Find the most recently modified .jsonl transcript across all frontend sources.
 */
export function findLatestTranscript(): string | null {
  let latest = "";
  let latestMtime = 0;

  for (const dir of TRANSCRIPT_DIRS) {
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latest = fullPath;
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return latest || null;
}

/**
 * Read the tail of a JSONL file efficiently.
 * Reads the last `bytes` of the file and parses complete JSON lines.
 */
function tailJsonl(filePath: string, bytes: number = 200_000): object[] {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - bytes);
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(Math.min(bytes, stat.size));
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);

  const text = buf.toString("utf-8");
  const lines = text.split("\n");

  // Skip first line if we started mid-file (it's likely truncated)
  const startIdx = start > 0 ? 1 : 0;
  const results: object[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      results.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  return results;
}

/**
 * Extract activity events from the most recent transcript.
 * Returns the last `limit` events, most recent first.
 */
export function getRecentTranscriptActivity(limit: number = 50): TranscriptEvent[] {
  const transcriptPath = findLatestTranscript();
  if (!transcriptPath) return [];

  // Read last ~200KB of the transcript
  const entries = tailJsonl(transcriptPath, 300_000);
  const events: TranscriptEvent[] = [];

  for (const entry of entries) {
    const obj = entry as Record<string, unknown>;
    const timestamp = obj.timestamp as string;
    const type = obj.type as string;

    if (!timestamp) continue;

    // Handle both Claude Code (type: "assistant") and OpenClaw Gateway (type: "message" with role: "assistant")
    const msg = obj.message as Record<string, unknown> | undefined;
    const isAssistant =
      type === "assistant" ||
      (type === "message" && msg?.role === "assistant");

    if (isAssistant) {
      if (!msg) continue;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === "tool_use") {
          const toolName = block.name as string;
          const input = (block.input || {}) as Record<string, unknown>;

          switch (toolName) {
            case "Write": {
              const fp = input.file_path as string;
              const shortPath = fp ? shortenPath(fp) : "unknown";
              events.push({
                timestamp,
                type: "file_write",
                tool: "Write",
                detail: `Wrote ${shortPath}`,
                filePath: fp,
              });
              break;
            }
            case "Edit": {
              const fp = input.file_path as string;
              const shortPath = fp ? shortenPath(fp) : "unknown";
              events.push({
                timestamp,
                type: "file_edit",
                tool: "Edit",
                detail: `Edited ${shortPath}`,
                filePath: fp,
              });
              break;
            }
            case "Read": {
              const fp = input.file_path as string;
              const shortPath = fp ? shortenPath(fp) : "unknown";
              events.push({
                timestamp,
                type: "file_read",
                tool: "Read",
                detail: `Read ${shortPath}`,
                filePath: fp,
              });
              break;
            }
            case "Bash": {
              const cmd = (input.command as string) || "";
              const desc = (input.description as string) || "";
              const shortCmd = desc || cmd.slice(0, 80);
              events.push({
                timestamp,
                type: "bash_command",
                tool: "Bash",
                detail: shortCmd,
                command: cmd,
              });
              break;
            }
            // Skip TodoWrite, Glob, Grep, etc. — too noisy
          }
        }
      }
    }
  }

  // Return most recent first, limited
  return events.slice(-limit).reverse();
}

/**
 * Shorten a file path for display by removing the workspace prefix.
 */
function shortenPath(fp: string): string {
  const prefixes = [
    "/Users/moltymac/.openclaw/workspace/",
    "/Users/moltymac/",
  ];
  for (const prefix of prefixes) {
    if (fp.startsWith(prefix)) {
      return fp.slice(prefix.length);
    }
  }
  return fp.split("/").slice(-2).join("/");
}
