import test from 'node:test';
import assert from 'node:assert/strict';
import { observeNativeOutcome } from './outcome-observation.mjs';

const event = (type, seq, data = {}) => ({ type, seq, time: seq, data });
const assistant = (seq, text, extra = []) => event('assistant/message', seq, {
  turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }, ...extra] },
});
const start = event('turn/start', 0, { turn: 1 });
const step = event('step/start', 1, { turn: 1, step: 1 });
const finish = event('step/end', 3, { turn: 1, step: 1 });
const tool = { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' };

test('final text survives ordinary step/end and records the actual last turn/end', () => {
  const result = observeNativeOutcome([start, step, assistant(2, 'done'), finish, event('turn/end', 4, { turn: 1, reason: { kind: 'completed' } })]);
  assert.deepEqual(result, { endReason: { kind: 'completed' }, lastTurnEndSeq: 4, terminalCandidate: { characters: 4, seq: 2 } });
  assert.equal(Object.hasOwn(result, 'completed'), false);
});

test('text in a tool-call message is commentary', () => {
  assert.deepEqual(observeNativeOutcome([start, step, assistant(2, 'Reading now', [tool])]).terminalCandidate, { characters: 0, seq: null });
});

test('a later native step or tool event makes earlier text intermediate', () => {
  for (const later of [event('step/start', 4, { turn: 1, step: 2 }), event('tool/call', 4), event('tool/result', 4), event('tool/ptc-dispatch', 4), event('turn/start', 4, { turn: 2 })])
    assert.deepEqual(observeNativeOutcome([start, step, assistant(2, 'Candidate'), finish, later]).terminalCandidate, { characters: 0, seq: null });
});

test('only the last assistant message can be the candidate', () => {
  assert.deepEqual(observeNativeOutcome([start, step, assistant(2, 'Earlier'), finish, event('step/start', 4), assistant(5, 'Checking', [tool])]).terminalCandidate, { characters: 0, seq: null });
});

test('a candidate can exist on an aborted turn without implying completion', () => {
  const reason = { kind: 'aborted', cause: { kind: 'user' } };
  const result = observeNativeOutcome([start, step, assistant(2, 'A final candidate'), finish, event('turn/end', 4, { turn: 1, reason })]);
  assert.deepEqual(result.endReason, reason);
  assert.deepEqual(result.terminalCandidate, { characters: 17, seq: 2 });
  assert.equal(Object.hasOwn(result, 'completed'), false);
});

test('earlier tools do not invalidate a later candidate; missing text/end stays absent', () => {
  assert.deepEqual(observeNativeOutcome([start, step, event('tool/result', 2), assistant(3, 'ready')]).terminalCandidate, { characters: 5, seq: 3 });
  assert.deepEqual(observeNativeOutcome([start, step, assistant(2, '')]), { endReason: null, lastTurnEndSeq: null, terminalCandidate: { characters: 0, seq: null } });
  assert.deepEqual(observeNativeOutcome([start, step, assistant(2, ' \n ')]).terminalCandidate, { characters: 0, seq: null });
});
