#!/usr/bin/env bash
# memory-plan-pretty-stream.sh — reads claude `--output-format stream-json`
# events on stdin and emits human-readable timestamped lines on stdout.
#
# Used by memory-plan-tick.sh to give live visibility into what the headless
# claude is actually doing (tool calls, assistant text, results) instead of
# waiting for one giant text dump at the end.
#
# Each input line is one JSON event. Output is one pretty line per event.
# Unparseable lines pass through untouched (so error text from claude is
# still visible, e.g. auth failures).
#
# Usage:
#   claude --output-format stream-json --verbose ... | memory-plan-pretty-stream.sh

set -u

# jq filter. --unbuffered ensures each input line flushes immediately so
# `tail -F` sees events in real time.
exec jq --unbuffered -r '
  def shorten(n): if (. | length) > n then .[0:n] + "…" else . end;
  def hms: (now | strftime("%H:%M:%S"));
  def asline(tag; body): "\(hms)  \(tag)  \(body)";

  # Pretty-print a tool-call input object: key=value, value shortened.
  def tool_args:
    if . == null then ""
    else (to_entries
          | map("\(.key)=\(.value | tostring | gsub("\n"; "\\n") | shorten(60))")
          | join("  "))
    end;

  if .type == "system" then
    asline("[2msys   [0m"; "\(.subtype // "?")\(if .model then "  model=\(.model)" else "" end)\(if .session_id then "  session=\(.session_id | .[0:8])" else "" end)")

  elif .type == "assistant" then
    (.message.content // [])[]? | (
      if .type == "text" then
        asline("[36masst  [0m"; (.text | gsub("\n"; " ") | shorten(180)))
      elif .type == "tool_use" then
        asline("[35mtool  [0m"; "\(.name)(\(.input | tool_args))")
      elif .type == "thinking" then
        asline("[2mthink [0m"; ((.thinking // "") | gsub("\n"; " ") | shorten(180)))
      else empty end
    )

  elif .type == "user" then
    if (.message.content | type) == "array" then
      .message.content[]? | (
        if .type == "tool_result" then
          asline("[33mres   [0m";
            (if (.content | type) == "string" then .content
             elif (.content | type) == "array" then ((.content | map(.text // "" ) | join(" ")))
             else (.content | tostring) end)
            | gsub("\n"; " ") | shorten(180)
            + (if .is_error then "  [31m[ERROR][0m" else "" end))
        else empty end
      )
    else empty end

  elif .type == "stream_event" then
    # Partial-message chunks. Only print the deltas of real text content.
    if .event.type == "content_block_start" and .event.content_block.type == "tool_use" then
      asline("[35mtool  [0m"; "\(.event.content_block.name)(…)")
    elif .event.type == "content_block_delta" and .event.delta.type == "text_delta" then
      # Skip — too noisy. Full text arrives in the "assistant" message above.
      empty
    else empty end

  elif .type == "result" then
    asline("[32mEND   [0m";
      "\(.subtype // "?")  cost=$\(.total_cost_usd // 0 | . * 10000 | floor / 10000)  dur=\((.duration_ms // 0) / 1000 | floor)s  turns=\(.num_turns // "?")")

  else
    asline("[2m?     [0m"; (.type // "unknown"))
  end
' 2>/dev/null
