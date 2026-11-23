import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run against a disposable, manifest-prepared native runtime, never a personal profile.
const modules = process.env.MOA_COMPAT_MODULES;
const nativeTest = (name, fn) => test(name, { skip: !modules, timeout: 10000 }, fn);
const load = (name, file = 'lib/index.js') => import(pathToFileURL(resolve(modules, '@deepseek-ai', name, file)).href);
const user = text => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
const textResponse = text => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const callResponse = (names, argumentsByName = {}) => [...names.flatMap((name, index) => [
  { type: 'block-start', index, blockType: 'tool-call' },
  { type: 'block-end', index, block: { type: 'tool-call', id: 'call-' + index, name, arguments: JSON.stringify(argumentsByName[name] ?? {}) } },
]), { type: 'finish', reason: { kind: 'tool-calls' } }];
const until = async predicate => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('native observation did not arrive');
};
async function setup(jobOptions = {}) {
  const [{ Context }, { default: AgentLoop }, kit, { LlmAdapter, createUserMessage }, { default: Jobs }] = await Promise.all([
    load('cordis'), load('dsh-agent-loop'), load('dsh-agent-loop-testkit'), load('dsh-llm'), load('dsh-jobs-local'),
  ]);
  const ctx = new Context();
  await kit.mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Jobs, { pumpPollMs: 5, ...jobOptions });
  ctx.jobs.attachController('rc2-execution-test');
  class Adapter extends LlmAdapter {
    requests = [];
    handler = () => textResponse('done');
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream(request) { this.requests.push(request); yield* await this.handler(request); }
  }
  const adapter = new Adapter();
  ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await ctx.agents.create({ sessionId: 'rc2-execution', agentOptions: { provider: 'test', model: 'test' } });
  const results = [], errors = [], activities = [];
  ctx.on('agent/error', event => errors.push(event.error));
  ctx.on('agent/tool-background-result', event => results.push(event));
  ctx.on('agent/tool-activity-started', event => activities.push(event));
  agent.enableToolBackground();
  return { ctx, agent, adapter, results, errors, activities,
    send: text => agent.steer(createUserMessage(user(text))),
    events: type => agent.session.snapshotEvents().filter(event => event.type === type),
    async dispose() { await ctx.fiber.dispose(); },
  };
}
function heldTool(name, execute, extras = {}) {
  return { name, description: name, parameters: { type: 'object' },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute, ...extras };
}

nativeTest('rc2 timer transfer retains admitted schema after step disposal and finalizes one full result', async () => {
  const f = await setup(), gate = Promise.withResolvers();
  let finalized = 0, observed = 0;
  try {
    f.ctx.tools.register(heldTool('held', () => gate.promise, { finalizeContent: (_exec, result) => { finalized++; return result.content; } }));
    f.ctx.on('tools/result', exec => { if (exec.name === 'held') observed++; });
    f.ctx.on('agent/tool-activity-started', event => { void event.requestBackground({ kind: 'after-seconds' }); });
    f.adapter.handler = () => f.adapter.requests.length === 1 ? callResponse(['held']) : textResponse('continued');
    f.send('go'); await f.agent.whenIdle();
    assert.equal(f.events('turn/start').length, 1);
    assert.equal(f.events('tool/result').length, 1);
    assert.ok(f.events('tool/result')[0].data.meta.moaBackground);
    assert.equal(finalized, 0); assert.equal(observed, 0);
    const full = 'complete result '.repeat(5000);
    gate.resolve(full); await until(() => f.results.length === 1);
    assert.equal(f.results[0].result.value, full);
    assert.equal(finalized, 1); assert.equal(observed, 1);
    assert.equal(f.agent.moaHasPendingBackground, false);
    assert.equal(f.errors.length, 0);
  } finally { gate.resolve('cleanup'); await f.dispose(); }
});

nativeTest('rc2 message handoff drains foreground siblings and preserves model result order', async () => {
  const f = await setup(), slow = Promise.withResolvers(), sibling = Promise.withResolvers();
  try {
    f.ctx.tools.register(heldTool('slow', () => slow.promise, { isConcurrencySafe: () => true }));
    f.ctx.tools.register(heldTool('sibling', () => sibling.promise, { isConcurrencySafe: () => true }));
    f.adapter.handler = () => f.adapter.requests.length === 1 ? callResponse(['slow', 'sibling']) : textResponse('new turn');
    f.send('go'); await until(() => f.activities.length === 2);
    f.send('new direction');
    await f.activities[0].requestBackground({ kind: 'new-message', messageIds: [f.agent.inbox.nextStep[0].id] });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.adapter.requests.length, 1);
    sibling.resolve('sibling finished'); await f.agent.whenIdle();
    assert.equal(f.events('turn/end')[0].data.reason.kind, 'handoff');
    assert.equal(f.events('turn/start').length, 2);
    assert.deepEqual(f.events('tool/result').map(event => event.data.message.toolCallId), ['call-0', 'call-1']);
    assert.match(JSON.stringify(f.adapter.requests[1]), /new direction/);
    slow.resolve('finished'); await until(() => f.results.length === 1);
    assert.equal(f.errors.length, 0);
  } finally { slow.resolve('cleanup'); sibling.resolve('cleanup'); await f.dispose(); }
});

nativeTest('rc2 joined stop waits for resource exit and parks input until explicit resume', async () => {
  const f = await setup(), cleanup = Promise.withResolvers();
  let cancelled = false, joined = false;
  try {
    f.ctx.tools.register(heldTool('held', async (_args, exec) => {
      await new Promise(resolve => exec.signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
      await cleanup.promise; return 'exited';
    }));
    f.ctx.on('agent/tool-activity-started', event => { void event.requestBackground({ kind: 'after-seconds' }); });
    f.adapter.handler = () => f.adapter.requests.length === 1 ? callResponse(['held']) : textResponse('done');
    f.send('go'); await f.agent.whenIdle();
    const stop = f.agent.cancelAndJoin({ kind: 'parent' }).then(() => { joined = true; });
    await until(() => cancelled); f.send('parked');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(joined, false); assert.equal(f.agent.moaAborting, true);
    cleanup.resolve(); await stop;
    assert.equal(f.agent.moaAborting, false); assert.equal(f.adapter.requests.length, 2);
    assert.equal(f.agent.inbox.nextStep.length, 1);
    f.send('resume'); await f.agent.whenIdle();
    assert.match(JSON.stringify(f.adapter.requests.at(-1)), /parked/);
    assert.equal(f.results.length, 1); assert.equal(f.errors.length, 0);
  } finally { cleanup.resolve(); await f.dispose(); }
});

nativeTest('rc2 native capacity refusal keeps the same invocation foreground', async () => {
  const f = await setup({ maxConcurrentJobsPerOwner: 1 });
  const occupied = Promise.withResolvers(), tool = Promise.withResolvers();
  let calls = 0;
  try {
    f.ctx.jobs.start({ kind: 'held-native', label: 'occupied capacity', owner: f.agent.id,
      run: () => ({ cancel: () => occupied.resolve({ status: 'killed' }), done: occupied.promise }) });
    f.ctx.tools.register(heldTool('held', () => { calls++; return tool.promise; }));
    f.adapter.handler = () => f.adapter.requests.length === 1 ? callResponse(['held']) : textResponse('done');
    f.send('go'); await until(() => f.activities.length === 1);
    assert.deepEqual(await f.activities[0].requestBackground({ kind: 'after-seconds' }), { kind: 'foreground', reason: 'unavailable' });
    assert.equal(f.events('tool/result').length, 0);
    tool.resolve('original foreground'); await f.agent.whenIdle();
    assert.equal(calls, 1); assert.equal(f.results.length, 0);
    assert.equal(f.events('tool/result')[0].data.meta?.moaBackground, undefined);
    assert.match(JSON.stringify(f.events('tool/result')[0]), /original foreground/);
    assert.equal(f.errors.length, 0);
  } finally { occupied.resolve({ status: 'completed' }); tool.resolve('cleanup'); await f.dispose(); }
});

nativeTest('rc2 hard continuation admits replacement only after old cleanup', async () => {
  const f = await setup(), cleanup = Promise.withResolvers();
  let cancelled = false;
  try {
    f.ctx.tools.register(heldTool('held', async (_args, exec) => {
      await new Promise(resolve => exec.signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
      await cleanup.promise; return 'cleaned';
    }));
    f.ctx.on('agent/tool-activity-started', event => { void event.requestBackground({ kind: 'after-seconds' }); });
    f.adapter.handler = () => f.adapter.requests.length === 1 ? callResponse(['held']) : textResponse('done');
    f.send('go'); await f.agent.whenIdle();
    const { createUserMessage } = await load('dsh-llm');
    const stopped = f.agent.cancelAndJoin({ kind: 'parent' }, { continuation: createUserMessage(user('replacement')) });
    await until(() => cancelled); f.send('later');
    assert.equal(f.adapter.requests.length, 2);
    cleanup.resolve(); await stopped; await f.agent.whenIdle();
    const request = JSON.stringify(f.adapter.requests.at(-1));
    assert.ok(request.indexOf('replacement') < request.indexOf('later'));
    assert.equal(f.results.length, 1); assert.equal(f.errors.length, 0);
  } finally { cleanup.resolve(); await f.dispose(); }
});

async function mountControlledPwsh(f) {
  const body = Promise.withResolvers(), exited = Promise.withResolvers();
  const result = { exitCode: 7, signal: null, timedOut: false, aborted: false, timeoutMs: 5,
    stdout: { text: 'complete native PowerShell output', truncated: false }, stderr: { text: '', truncated: false } };
  let starts = 0, cancels = 0;
  const proc = {
    status: 'running', exitCode: null, signal: null,
    observed: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
    done: body.promise.then(() => { proc.status = result.aborted ? 'killed' : 'completed'; proc.exitCode = result.exitCode; }),
    result: async () => { await body.promise; return result; },
    kill: () => { cancels++; result.aborted = true; body.resolve(); },
    managed: { terminate: () => { cancels++; result.aborted = true; body.resolve(); }, waitForExit: () => exited.promise },
  };
  f.ctx.provide('workingDirectory', { ensure: async () => process.cwd() });
  f.ctx.provide('shellEnv', { collect: () => ({}) });
  f.ctx.provide('shell', {
    supportsManagedExecution: true,
    resolve: request => ({ timeoutMs: 5, workdir: process.cwd(), ...request }),
    execute: async () => { starts++; return proc; },
  });
  await f.ctx.plugin(await load('dsh-tool-pwsh'), { promoteOnTimeout: true });
  f.adapter.handler = () => f.adapter.requests.length === 1
    ? callResponse(['pwsh'], { pwsh: { description: 'Run controlled native producer', command: 'controlled native command', timeoutMs: 5 } })
    : textResponse('continued');
  return { body, exited, get starts() { return starts; }, get cancels() { return cancels; } };
}

nativeTest('rc2 PowerShell promotion adopts one producer and returns its canonical completed DTO', async () => {
  const f = await setup(); let p;
  try {
    p = await mountControlledPwsh(f); f.send('go'); await f.agent.whenIdle();
    const jobs = f.ctx.jobs.list(f.agent.id);
    assert.equal(jobs.length, 1); assert.equal(jobs[0].kind, 'pwsh');
    assert.equal(jobs[0].completionNotice, 'producer');
    assert.equal(p.starts, 1); assert.equal(f.results.length, 0);
    p.body.resolve(); p.exited.resolve(true); await until(() => f.results.length === 1);
    assert.equal(f.results[0].result.value.kind, 'foreground');
    assert.equal(f.results[0].result.value.exitCode, 7);
    assert.equal(f.results[0].result.value.stdout.text, 'complete native PowerShell output');
    assert.equal(f.errors.length, 0);
  } finally { p?.body.resolve(); p?.exited.resolve(true); await f.dispose(); }
});

nativeTest('rc2 PowerShell joined cancellation waits beyond the producer body for managed exit', async () => {
  const f = await setup(); let p;
  try {
    p = await mountControlledPwsh(f); f.send('go'); await f.agent.whenIdle();
    let stopped = false;
    const joining = f.agent.cancelAndJoin({ kind: 'parent' }).then(() => { stopped = true; });
    await until(() => p.cancels > 0); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(stopped, false); assert.equal(f.agent.moaAborting, true);
    p.exited.resolve(true); await joining;
    assert.equal(f.agent.moaAborting, false); assert.equal(p.starts, 1);
    assert.equal(f.results.length, 1); assert.equal(f.errors.length, 0);
  } finally { p?.body.resolve(); p?.exited.resolve(true); await f.dispose(); }
});

async function mountPersistent(f, options = {}) {
  let wrapper = '', spawns = 0;
  const snapshot = () => {
    const start = /__DSH_PERSISTENT_PWSH_START_[^']+__/.exec(wrapper)?.[0];
    const end = /__DSH_PERSISTENT_PWSH_END_[^']+:/.exec(wrapper)?.[0];
    return options.partial ? 'partial output only' : `${start}\nactual output\n${end}${options.exitCode ?? 0}\n`;
  };
  const status = { kind: 'running' };
  f.ctx.provide('workingDirectory', { ensure: async () => process.cwd() });
  f.ctx.provide('terminals', {
    spawn: async () => { spawns++; return { sessionId: 'native-terminal' }; },
    list: () => spawns ? [{ sessionId: 'native-terminal', status }] : [],
    startSend: (_owner, _id, request) => {
      wrapper = request.text;
      return { done: Promise.resolve({ viewport: snapshot(), truncated: false, sessionStatus: status, waitReason: options.partial ? 'stdin_read' : 'prompt' }), readOutput: () => ({ delta: snapshot(), truncated: false }) };
    },
    read: () => ({ text: snapshot(), lineEnd: 3, totalLines: 3, truncated: false }),
    kill: async () => { spawns = 0; return true; },
  });
  if (options.readOnly) f.ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access', readOnlyPaths: ['/owned/notes.md'] }) });
  await f.ctx.plugin(await load('dsh-tool-pwsh-persistent'));
  f.adapter.handler = () => f.adapter.requests.length === 1 ? callResponse(['pwsh'], { pwsh: { command: 'controlled native command' } }) : textResponse('done');
  return { get spawns() { return spawns; } };
}

nativeTest('rc2 persistent PowerShell keeps string wire output and publishes nonce-confirmed exit metadata', async () => {
  const f = await setup();
  try {
    await mountPersistent(f, { exitCode: 3 });
    const observed = []; f.ctx.on('tools/result', (exec, result) => { if (exec.name === 'pwsh') observed.push(result); });
    f.send('go'); await f.agent.whenIdle();
    assert.equal(observed.length, 1); assert.equal(typeof observed[0].value, 'string');
    assert.match(observed[0].value, /actual output/);
    assert.deepEqual(observed[0].meta.nativeShell, { kind: 'pwsh', completed: true, exitCode: 3, signal: null, timedOut: false, aborted: false });
    assert.equal(f.errors.length, 0);
  } finally { await f.dispose(); }
});

nativeTest('rc2 persistent PowerShell partial input never grants a successful exit', async () => {
  const f = await setup();
  try {
    await mountPersistent(f, { partial: true });
    const observed = []; f.ctx.on('tools/result', (exec, result) => { if (exec.name === 'pwsh') observed.push(result); });
    f.send('go'); await f.agent.whenIdle();
    assert.equal(observed[0].meta.nativeShell.completed, false);
    assert.equal(observed[0].meta.nativeShell.exitCode, undefined);
  } finally { await f.dispose(); }
});

nativeTest('rc2 persistent PowerShell refuses protected Worker records before terminal spawn', async () => {
  const f = await setup();
  try {
    const terminals = await mountPersistent(f, { readOnly: true });
    f.send('go'); await f.agent.whenIdle();
    assert.equal(terminals.spawns, 0);
    assert.match(JSON.stringify(f.events('tool/result')), /READ_ONLY_PATH_UNSUPPORTED|cannot enforce the session/);
    assert.equal(f.events('tool/result')[0].data.message.isError, true);
  } finally { await f.dispose(); }
});
