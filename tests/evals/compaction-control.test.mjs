import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { armMode, createCompactionObserver, earlyCompactionPolicy, evaluationArms, flushLiveSessions, requestRoutingMetadata, usageTotals, verifyCompactionConfig } from '../../evals/moa-vs-single/compaction-control.mjs';
import { makeReport } from '../../evals/moa-vs-single/report.mjs';

const model = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' };
const policy = { provider: model.provider, model: model.model, thresholdRatio: 0.0625, retainTokens: 16384, maxTokens: 8192 };
const repository = fileURLToPath(new URL('../..', import.meta.url));
async function temp(t) { const dir = await mkdtemp(join(tmpdir(), 'moa-compaction-eval-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('four arms separate Single controls from MoA and change only the exact native compaction policy', () => {
  assert.deepEqual(evaluationArms({ compareCompaction: true }), ['single', 'single-compact', 'moa', 'moa-compact']);
  assert.deepEqual(armMode('single-compact'), { moa: false, compact: true });
  assert.deepEqual(armMode('moa-compact'), { moa: true, compact: true });
  assert.deepEqual(armMode('moa-baseline'), { moa: true, compact: false });
  assert.deepEqual(evaluationArms({ baselineRepository: 'baseline' }), ['single', 'moa-baseline', 'moa']);
  assert.throws(() => evaluationArms({ compareCompaction: true, baselineRepository: 'baseline' }), /mutually exclusive/);
  assert.deepEqual(earlyCompactionPolicy(model), policy);
  assert.deepEqual(model, { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' });
  assert.throws(() => armMode('single-other'), /Unknown/);
  verifyCompactionConfig({ thresholdRatio: 0.8, modelPolicies: [policy] }, policy, model);
  assert.throws(() => verifyCompactionConfig({ modelPolicies: [{ ...policy, maxTokens: 999 }] }, policy, model), /did not mount exactly/);
  assert.throws(() => verifyCompactionConfig({ modelPolicies: [policy] }, null, model), /Control arm/);
  assert.deepEqual(requestRoutingMetadata({ sessionId: 'moa-verifier', tools: [] }), { purpose: null, maxTokens: null });
  const actual = { purpose: 'compaction', maxTokens: 8192, reasoningEffort: 'high' };
  assert.deepEqual(requestRoutingMetadata(actual), { purpose: 'compaction', maxTokens: 8192 });
  assert.deepEqual(actual, { purpose: 'compaction', maxTokens: 8192, reasoningEffort: 'high' });
});

test('native failures, cancellation and missing summary usage remain counted without retaining summary content', () => {
  const observer = createCompactionObserver();
  let seq = 0;
  const event = (type, data) => observer.observe('root', { type, seq: seq++, time: seq * 100, data });
  event('compaction/start', { compactionId: 'success', turn: 1 });
  event('compaction/summary', { compactionId: 'success', summary: 'PRIVATE SUMMARY', rawOutput: 'PRIVATE REASONING', provider: model.provider, model: model.model, maxTokens: 8192, shadowedSeqs: [1,2], shadowedTokenCount: 100 });
  event('compaction/end', { compactionId: 'success', turn: 1 });
  event('compaction/start', { compactionId: 'max-tokens', turn: 1 });
  event('compaction/end', { compactionId: 'max-tokens', turn: 1, error: 'MAX_TOKENS PRIVATE PROVIDER BODY' });
  event('compaction/start', { compactionId: 'cancelled', turn: 1 });
  observer.cancelActive('root');
  event('compaction/end', { compactionId: 'cancelled', turn: 1, error: '[object Object]' });
  event('compaction/prune', { shadowedSeqs: [4], shadowedRange: { start: 4, end: 4 }, shadowedTokenCount: 300 });
  event('compaction/start', { compactionId: 'unfinished', turn: 1 });
  observer.cancelActive('root');
  const requests = [
    { purpose: null, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200 } },
    { purpose: 'compaction', usage: { inputTokens: 10, cacheReadTokens: 20, outputTokens: 8192 } },
    { purpose: 'compaction', usage: { inputTokens: 30, cacheReadTokens: 40, outputTokens: 8192 } },
    { purpose: 'compaction', cancelled: true },
  ];
  const metrics = observer.metrics(requests);
  assert.equal(metrics.started, 4);
  assert.equal(metrics.succeeded, 1);
  assert.equal(metrics.failed, 2, 'a cancellation request must not erase a concurrent true failure');
  assert.equal(metrics.failedAfterCancelRequest, 1);
  assert.equal(metrics.unfinished, 1);
  assert.equal(metrics.unfinishedCancelRequested, 1);
  assert.equal(metrics.pruned, 1);
  assert.equal(metrics.summaryEvents, 1);
  assert.equal(metrics.summaryRequests, 3);
  assert.equal(metrics.summaryRequestsCancelled, 1);
  assert.equal(metrics.outputTokens, 16384);
  assert.equal(metrics.totalTokens, 16484);
  assert.equal(metrics.missingUsageRequests, 1);
  assert.equal(usageTotals(requests).totalTokens, 16834, 'summary usage stays in the unchanged aggregate budget');
  assert.doesNotMatch(JSON.stringify(observer.events), /PRIVATE|MAX_TOKENS|summary"\s*:/);
});

test('flush skips detached and replaced sessions while recording actual live durability failure', async () => {
  const stale = { id: 'gone' }, replaced = { id: 'same' }, current = { id: 'same' }, live = { id: 'live' };
  const calls = [], failures = [];
  const store = { get: id => ({ same: current, live })[id], flush: async session => { calls.push(session); throw new Error('REAL DURABILITY FAILURE'); } };
  await flushLiveSessions(store, [{ session: stale }, { session: replaced }, { session: live }], error => failures.push(error.message));
  assert.deepEqual(calls, [live]);
  assert.deepEqual(failures, ['REAL DURABILITY FAILURE']);
});

test('prepare freezes eight hard runs with four explicit arms, identical model/budget and zero model calls', async t => {
  const dir = await temp(t), runtime = join(dir, 'runtime'), credentials = join(dir, 'credentials.yaml'), output = join(dir, 'output');
  await mkdir(runtime); await writeFile(join(runtime, 'package.json'), '{}'); await writeFile(credentials, '{}');
  const runner = resolve(repository, 'evals/moa-vs-single/run.mjs');
  const common = [runner, '--prepare', '--runtime', runtime, '--credentials', credentials, '--engine', process.execPath, '--cases', 'hard-journal-ledger', '--repetitions', '2', '--max-total-tokens', '1000000', '--max-requests', '80'];
  const prepared = spawnSync(process.execPath, [...common, '--output', output, '--compare-compaction'], { encoding: 'utf8', cwd: repository });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(JSON.parse(prepared.stdout).modelStarted, false);
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.runs.length, 8);
  assert.deepEqual(manifest.arms, ['single', 'single-compact', 'moa', 'moa-compact']);
  assert.equal(manifest.concurrency, 4);
  assert.deepEqual(manifest.model, model);
  assert.deepEqual(manifest.limits, { maxRequests: 80, maxTotalTokens: 1000000 });
  assert.deepEqual(manifest.compactionStudy.policy, policy);
  assert.deepEqual(manifest.runs.slice(0,4).map(r=>r.arm), manifest.arms);
  assert.deepEqual(manifest.runs.slice(4).map(r=>r.arm), [...manifest.arms].reverse());
  const rejectedOutput = join(dir, 'rejected');
  const rejected = spawnSync(process.execPath, [...common, '--output', rejectedOutput, '--compare-compaction', '--baseline-repository', repository], { encoding: 'utf8', cwd: repository });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /mutually exclusive/);
  await assert.rejects(stat(rejectedOutput), { code: 'ENOENT' });
});

for (const arms of [['single','moa'], ['single','moa-baseline','moa'], ['single','single-compact','moa','moa-compact']]) {
  test(`report preserves ${arms.length} arms and only the intended setting-matched comparisons`, async t => {
    const dir = await temp(t);
    const manifest = { model, candidate: { commit: 'candidate', version: 'test' }, limits: { maxRequests: 80, maxTotalTokens: 1000000 }, concurrency: arms.length,
      sources: { 'report.mjs': 'frozen' }, arms, repetitions: 1, cases: [{ id: 'hard-journal-ledger' }], runs: arms.map((arm,i)=>({ id: `run${i}`, caseId: 'hard-journal-ledger', repetition: 1, arm })) };
    if (arms.includes('moa-baseline')) manifest.baseline = { commit: 'baseline', version: 'test' };
    if (arms.includes('single-compact')) manifest.compactionStudy = { policy };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    for (const entry of manifest.runs) {
      await mkdir(join(dir,'runs',entry.id), { recursive: true });
      await writeFile(join(dir,'runs',entry.id,'scored.json'), JSON.stringify({ ...entry, title: 'ledger', category: 'code', grade: { score: 100 }, completed: true, validControl: true,
        responseElapsedMs: 1000, modelRequestCount: 3, agents: [{kind:'root'}], usage: manifest.compactionStudy ?
          {inputTokens:13,outputTokens:8212,cacheReadTokens:34,cacheWriteTokens:0,totalTokens:8259,missingUsageRequests:1} :
          {inputTokens:10,outputTokens:20,cacheReadTokens:30,cacheWriteTokens:0,totalTokens:60,missingUsageRequests:0},
        ...(manifest.compactionStudy ? { compaction: { metrics: { started:2,succeeded:1,failed:1,failedAfterCancelRequest:0,unfinished:0,summaryEvents:1,pruned:2,summaryRequests:2,summaryRequestsCancelled:0,inputTokens:3,cacheReadTokens:4,outputTokens:8192,totalTokens:8199,missingUsageRequests:1 } } } : {}) }));
    }
    const report = await makeReport(join(dir,'manifest.json'));
    const expected = arms.length===4 ? [['single','moa'],['single-compact','moa-compact'],['single','single-compact'],['moa','moa-compact']] : arms.length===3 ? [['single','moa-baseline'],['single','moa'],['moa-baseline','moa']] : [['single','moa']];
    assert.deepEqual(report.comparisons.map(c=>[c.referenceArm,c.candidateArm]), expected);
    assert.ok(report.comparisons.every(c=>c.qualityTies===1));
    if (arms.length===4) assert.ok(report.comparisons.every(c=>c.pairs[0].tokenRatio===null), 'missing summary usage prevents an exact total-cost ratio');
    const metric = report.groups.find(g=>g.category==='all'&&g.arm==='single').compaction;
    if (arms.length===4) { assert.equal(metric.failed,1); assert.equal(metric.outputTokens,8192); assert.equal(metric.missingUsageRequests,1); }
    else { assert.equal(metric.measuredRuns,0); assert.equal(metric.succeeded,null); }
    const markdown = await readFile(join(dir,'report.md'),'utf8');
    if (arms.length===4) assert.match(markdown, /同.*压缩设置|相同压缩设置/);
    assert.match(markdown, /MAX_TOKENS/);
  });
}
