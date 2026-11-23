import assert from 'node:assert/strict';

const armModes = {
  single: { moa: false, compact: false },
  'single-compact': { moa: false, compact: true },
  'moa-baseline': { moa: true, compact: false },
  moa: { moa: true, compact: false },
  'moa-compact': { moa: true, compact: true },
};
export function evaluationArms({ compareCompaction = false, baselineRepository } = {}) {
  assert.ok(!(compareCompaction && baselineRepository), '--compare-compaction and --baseline-repository are mutually exclusive');
  return compareCompaction ? ['single', 'single-compact', 'moa', 'moa-compact'] :
    baselineRepository ? ['single', 'moa-baseline', 'moa'] : ['single', 'moa'];
}
export function armMode(arm) {
  assert.ok(Object.hasOwn(armModes, arm), 'Unknown evaluation arm');
  return { ...armModes[arm] };
}
export const earlyCompactionPolicy = model => ({ provider: model.provider, model: model.model,
  thresholdRatio: 0.0625, retainTokens: 16384, maxTokens: 8192 });
export const requestRoutingMetadata = options => ({ purpose: options.purpose ?? null, maxTokens: options.maxTokens ?? null });

export function verifyCompactionConfig(config, policy, model) {
  assert.ok(config && Array.isArray(config.modelPolicies), 'Native compaction-basic config is unavailable');
  const matched = config.modelPolicies.filter(row => row.provider === model.provider && row.model === model.model);
  if (policy) assert.deepEqual(matched, [policy], 'Early native compaction policy did not mount exactly');
  else assert.equal(matched.length, 0, 'Control arm unexpectedly has an exact-model compaction override');
  return JSON.parse(JSON.stringify(config));
}

export function usageTotals(requests) {
  const measured = requests.filter(row => row.usage);
  const sum = key => measured.reduce((total, row) => total + (row.usage[key] ?? 0), 0);
  return { inputTokens: sum('inputTokens'), cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'), outputTokens: sum('outputTokens'),
    totalTokens: measured.reduce((total, row) => total + (row.usage.totalTokens ??
      (row.usage.inputTokens ?? 0) + (row.usage.outputTokens ?? 0) + (row.usage.cacheReadTokens ?? 0) + (row.usage.cacheWriteTokens ?? 0)), 0),
    measuredRequests: measured.length, missingUsageRequests: requests.length - measured.length };
}

/** Capture only native lifecycle/price metadata: never summary, rawOutput, or message content. */
export function createCompactionObserver() {
  const events = [], active = new Map();
  const key = (sessionId, id) => JSON.stringify([sessionId, id]);
  return {
    events,
    cancelActive(sessionId) {
      for (const start of active.values()) if (sessionId === undefined || start.sessionId === sessionId) start.cancelRequested = true;
    },
    observe(sessionId, event) {
      if (!['compaction/start', 'compaction/end', 'compaction/summary', 'compaction/prune'].includes(event.type)) return;
      const d = event.data;
      const meta = { sessionId, seq: event.seq, type: event.type, time: event.time,
        ...(d.compactionId === undefined ? {} : { compactionId: d.compactionId }),
        ...(d.turn === undefined ? {} : { turn: d.turn }),
        ...(d.shadowedRange === undefined ? {} : { shadowedRange: { start: d.shadowedRange.start, end: d.shadowedRange.end } }),
        ...(d.shadowedSeqs === undefined ? {} : { shadowedCount: d.shadowedSeqs.length }),
        ...(d.shadowedTokenCount === undefined ? {} : { shadowedTokenCount: d.shadowedTokenCount }),
        ...(d.provider === undefined ? {} : { provider: d.provider }),
        ...(d.model === undefined ? {} : { model: d.model }),
        ...(d.maxTokens === undefined ? {} : { maxTokens: d.maxTokens }),
        ...(event.type === 'compaction/end' ? { errorPresent: d.error !== undefined } : {}) };
      if (event.type === 'compaction/start') active.set(key(sessionId, d.compactionId), meta);
      if (event.type === 'compaction/end') {
        const start = active.get(key(sessionId, d.compactionId));
        meta.cancelRequested = start?.cancelRequested === true;
        active.delete(key(sessionId, d.compactionId));
      }
      events.push(meta);
    },
    metrics(requests) {
      const ends = events.filter(e => e.type === 'compaction/end');
      const summaries = requests.filter(row => row.purpose === 'compaction');
      return { started: events.filter(e => e.type === 'compaction/start').length,
        succeeded: ends.filter(e => !e.errorPresent).length,
        failed: ends.filter(e => e.errorPresent).length,
        failedAfterCancelRequest: ends.filter(e => e.errorPresent && e.cancelRequested).length,
        unfinished: active.size,
        unfinishedCancelRequested: [...active.values()].filter(e => e.cancelRequested).length,
        summaryEvents: events.filter(e => e.type === 'compaction/summary').length,
        pruned: events.filter(e => e.type === 'compaction/prune').length,
        summaryRequests: summaries.length,
        summaryRequestsCancelled: summaries.filter(row => row.cancelled === true).length,
        ...usageTotals(summaries) };
    },
  };
}

/** The native store rejects stale or same-ID replacement objects; don't hide live flush failures. */
export async function flushLiveSessions(sessions, agents, onFailure) {
  for (const agent of agents) {
    if (sessions.get(agent.session.id) !== agent.session) continue;
    try { await sessions.flush(agent.session); } catch (error) { onFailure(error); }
  }
}
