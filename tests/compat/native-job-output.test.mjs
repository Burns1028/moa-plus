import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createJobFixture, repository } from './fixtures/job-output.mjs';

const targets = [{ name: 'SDK', modules: resolve(repository, 'node_modules') }];
if (process.env.MOA_COMPAT_MODULES && resolve(process.env.MOA_COMPAT_MODULES) !== targets[0].modules)
  targets.push({ name: 'prepared runtime', modules: resolve(process.env.MOA_COMPAT_MODULES) });
const content = result => result.content.map(block => block.text ?? '').join('');

for (const target of targets) {
  const nativeTest = (name, run) => test(`${target.name}: ${name}`, { timeout: 10000 }, async t => {
    const f = await createJobFixture(target.modules);
    try { await run(f, t); } finally { await f.dispose(); }
  });

  nativeTest('model sees actual wait duration and empty consuming-cursor progress', async f => {
    const job = f.start();
    job.handle.append('数据\n');
    job.handle.append('observer only', { channel: 'log' });
    job.handle.updateProgress('collecting');
    const first = await f.read(job.id);
    assert.equal(first.isError, false);
    assert.equal(first.value.text, '数据\n');
    assert.equal(first.value.observation.waitOutcome, 'not-requested');
    assert.equal(first.value.observation.waitedMs, 0);
    assert.equal(first.value.observation.noNewOutput, false);
    assert.equal(first.value.observation.outputTotalBytes, Buffer.byteLength('数据\nobserver only'));
    assert.match(content(first), /数据\n\[job observation: elapsed_ms=\d+ waited_ms=0 wait=not-requested/);
    assert.match(content(first), /\[status: running, collecting\]$/);
    assert.doesNotMatch(content(first), /observer only/);
    const second = await f.read(job.id, { wait: true, timeout_ms: 20 });
    assert.equal(second.value.text, '');
    assert.equal(second.value.observation.waitOutcome, 'timeout');
    assert.equal(second.value.observation.noNewOutput, true);
    assert.ok(second.value.observation.waitedMs >= 10);
    assert.ok(second.value.observation.jobElapsedMs >= second.value.observation.waitedMs);
    assert.match(content(second), /\(no new output\)\n\[job observation:.*wait=timeout.*no_new_output=true\]/);
    assert.equal(f.ctx.jobs.get(job.id, f.agent.id).status, 'running');
  });

  nativeTest('terminal status and one-time result remain unchanged for completed/failed/killed jobs', async f => {
    for (const status of ['completed', 'failed', 'killed']) {
      const job = f.start();
      job.handle.append('stdout');
      job.handle.append('stderr', { channel: 'stderr' });
      await job.settle({ status, result: 'one-time result', detail: 'producer detail' });
      const first = await f.read(job.id, { wait: true, timeout_ms: 20 });
      assert.equal(first.value.job.status, status);
      assert.equal(first.value.text, 'stdout\n[stderr]\nstderr\none-time result');
      assert.equal(first.value.observation.waitOutcome, 'settled');
      assert.equal(first.value.observation.jobElapsedMs, first.value.job.finishedAt - first.value.job.startedAt);
      assert.match(content(first), new RegExp(`\\[status: ${status}, producer detail\\]$`));
      const second = await f.read(job.id);
      assert.equal(second.value.text, '');
      assert.equal(second.value.observation.noNewOutput, true);
    }
  });

  nativeTest('uses the wait projection even when the job settles before its single read', async f => {
    const job = f.start();
    const wait = f.ctx.jobs.wait.bind(f.ctx.jobs), read = f.ctx.jobs.read.bind(f.ctx.jobs);
    let reads = 0;
    f.ctx.jobs.read = (...args) => { reads++; return read(...args); };
    f.ctx.jobs.wait = async (...args) => {
      const timedOut = await wait(...args);
      assert.equal(timedOut.status, 'running');
      job.done.resolve({ status: 'completed', result: 'arrived after timeout' });
      await wait(job.id, 1000, f.agent.id);
      return timedOut;
    };
    const result = await f.read(job.id, { wait: true, timeout_ms: 10 });
    assert.equal(result.value.job.status, 'completed');
    assert.equal(result.value.observation.waitOutcome, 'timeout');
    assert.equal(result.value.text, 'arrived after timeout');
    assert.equal(reads, 1);
  });

  nativeTest('keeps native default and capped wait arguments without adding another wait', async f => {
    const job = f.start();
    const seen = [];
    f.ctx.jobs.wait = async (...args) => { seen.push(args); return f.ctx.jobs.get(args[0], args[2]); };
    await f.read(job.id);
    assert.equal(seen.length, 0);
    await f.read(job.id, { wait: true });
    await f.read(job.id, { wait: true, timeout_ms: 900000 });
    assert.deepEqual(seen.map(args => args[1]), [30000, 600000]);
    assert.ok(seen.every(args => args[0] === job.id && args[2] === f.agent.id));
  });

  nativeTest('preserves caller permission, timeout arguments and Stop without consuming output', async f => {
    const job = f.start();
    job.handle.append('unconsumed');
    const wait = f.ctx.jobs.wait.bind(f.ctx.jobs);
    const seen = [];
    f.ctx.jobs.wait = (...args) => { seen.push(args); return wait(...args); };
    const denied = await f.read(job.id, {}, { agent: f.outsider });
    assert.equal(denied.isError, true);
    const stop = new AbortController();
    const pending = f.read(job.id, { wait: true, timeout_ms: 25000 }, { signal: stop.signal });
    setTimeout(() => stop.abort(), 5);
    const aborted = await pending;
    assert.equal(aborted.isError, true);
    assert.match(content(aborted), /wait aborted/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][1], 25000);
    assert.equal(seen[0][2], f.agent.id);
    const final = await f.read(job.id);
    assert.equal(final.value.text, 'unconsumed');
    assert.equal(final.value.job.status, 'running');
  });

  nativeTest('optional observations preserve legacy rendering and tight UTF-8 output caps', async f => {
    const text = '重要输出🙂\n'.repeat(4);
    const legacyJob = { id: 'legacy', kind: 'fixture', label: 'legacy', status: 'running', startedAt: 1 };
    const legacy = f.tool.output.render({}, { text: 'legacy text', job: legacyJob });
    assert.deepEqual(legacy, [{ type: 'text', text: 'legacy text\n[status: running]' }]);
    for (const cap of [8, 39, 100, 180, 500]) {
      const job = f.start({ outputLimitBytes: cap });
      job.handle.append(text);
      const result = await f.read(job.id);
      assert.equal(result.value.text, text);
      assert.ok(Buffer.byteLength(content(result)) <= cap);
      const oldValue = { text, job: result.value.job };
      const exec = f.execution({ job_id: job.id });
      const oldContent = f.tool.output.render({}, oldValue);
      const oldFinal = f.tool.finalizeContent(exec, { value: oldValue, content: oldContent }) ?? oldContent;
      if (Buffer.byteLength(content({ content: f.tool.output.render({}, result.value) })) > cap)
        assert.deepEqual(result.content, oldFinal, 'new metadata cannot displace original output/status');
      else assert.match(content(result), /job observation:/);
    }
  });

  nativeTest('native user steering is reported as interruption while external Stop still fails', async (f, t) => {
    if (f.profile !== 'rc2') { t.skip('rc.3 has no successful user-steer release'); return; }
    const job = f.start();
    const pending = f.read(job.id, { wait: true, timeout_ms: 1000 });
    // inject uses the real inbox/inserted event without waking an idle model.
    f.agent.inject({ id: 'steering-input', source: { kind: 'user' }, content: [{ type: 'text', text: 'new direction' }] });
    const result = await pending;
    assert.equal(result.isError, false);
    assert.equal(result.value.observation.waitOutcome, 'interrupted');
    assert.equal(result.value.job.status, 'running');
    assert.match(content(result), /wait=interrupted/);
    // The fixture does not run a model. Remove the queued steer before dispose.
    f.agent.inbox.remove('steering-input');
  });

  nativeTest('held completion output is counted after notice merging and still delivered once', async (f, t) => {
    if (f.profile !== 'rc2') { t.skip('rc.3 has no held inline-completion branch'); return; }
    const job = f.start();
    job.handle.append('held output');
    const settled = Promise.withResolvers();
    const off = f.ctx.jobs.events.subscribe({ owner: f.agent.id }, event => {
      if (event.type === 'settled' && event.job.id === job.id) settled.resolve();
    });
    job.done.resolve({ status: 'completed', result: 'held result' });
    await settled.promise;
    off();
    assert.ok(f.agent.inbox.nextStep.some(message => message.source.kind === 'tool-jobs'));
    const result = await f.read(job.id);
    assert.equal(result.value.text, 'held output\nheld result');
    assert.equal(result.value.observation.noNewOutput, false);
    assert.equal(f.agent.inbox.nextStep.filter(message => message.source.kind === 'tool-jobs').length, 0);
    assert.equal((await f.read(job.id)).value.text, '');
  });
}
