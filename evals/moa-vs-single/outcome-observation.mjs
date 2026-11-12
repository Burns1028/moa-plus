/** Read-only native facts. A terminal candidate is never a completion verdict. */
export function observeNativeOutcome(events) {
  const end = events.findLast(event => event.type === 'turn/end');
  const index = events.findLastIndex(event => event.type === 'assistant/message');
  let terminalCandidate = { characters: 0, seq: null };
  if (index >= 0) {
    const event = events[index];
    const content = event.data.message.content;
    const characters = content.filter(block => block.type === 'text').reduce((sum, block) => sum + block.text.length, 0);
    // Closing the current step is normal. Starting another step/turn or doing
    // later tool work means this text was intermediate, not the last candidate.
    const continued = events.slice(index + 1).some(later =>
      later.type === 'step/start' || later.type === 'turn/start' || later.type.startsWith('tool/'));
    const hasText = content.some(block => block.type === 'text' && block.text.trim());
    if (hasText && !content.some(block => block.type === 'tool-call') && !continued)
      terminalCandidate = { characters, seq: event.seq };
  }
  return { endReason: end?.data.reason ?? null, lastTurnEndSeq: end?.seq ?? null, terminalCandidate };
}
