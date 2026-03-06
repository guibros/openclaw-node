function extractSignals({ recentSessionTranscript, todayLog, memorySnippet, userSnippet }) {
  const signals = [];
  const corpus = [
    String(recentSessionTranscript || ''),
    String(todayLog || ''),
    String(memorySnippet || ''),
    String(userSnippet || ''),
  ].join('\n');
  const lower = corpus.toLowerCase();

  const errorHit = /\[error|error:|exception|fail|failed|iserror":true/.test(lower);
  if (errorHit) signals.push('log_error');
  if (lower.includes('memory.md missing')) signals.push('memory_missing');
  if (lower.includes('user.md missing')) signals.push('user_missing');
  if (lower.includes('key missing')) signals.push('integration_key_missing');
  if (lower.includes('no session logs found') || lower.includes('no jsonl files')) signals.push('session_logs_missing');
  if (lower.includes('pgrep') || lower.includes('ps aux')) signals.push('windows_shell_incompatible');
  if (lower.includes('path.resolve(__dirname, \'../../')) signals.push('path_outside_workspace');

  // Protocol-specific drift signals
  if (lower.includes('prompt') && !lower.includes('evolutionevent')) signals.push('protocol_drift');

  return Array.from(new Set(signals));
}

module.exports = { extractSignals };

