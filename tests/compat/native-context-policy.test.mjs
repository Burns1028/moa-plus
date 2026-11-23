import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A complete, matching prepared runtime supplies the backend and its peers.
// The repository's rc3 SDK does not install compaction-basic or the pruner.
// Only the scripted adapter below is registered: zero remote model calls.
const modules = process.env.MOA_COMPAT_MODULES;
const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const load = name => import(pathToFileURL(join(resolve(modules), '@deepseek-ai', name, 'lib/index.js')).href);
const nativeTest = (name, fn) => test(name, { skip: !modules, timeout: 15000 }, fn);
const policy = { thresholdRatio: 0.0625, retainTokens: 16384, maxTokens: 8192 };
const text = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('');
const response = body => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: body },
  { type: 'block-end', index: 0, block: { type: 'text', text: body } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const call = () => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'context-policy-call', name: 'large_result', arguments: '{}' } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
];

async function fixture({ memory = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'moa-context-policy-'));
  const [{ Context }, kit, { default: Loop }, { LlmAdapter, createUserMessage },
    { default: Meter }, { default: Compactor }, { default: Pruner }] = await Promise.all([
    load('cordis'), load('dsh-agent-loop-testkit'), load('dsh-agent-loop'), load('dsh-llm'),
    load('dsh-token-meter'), load('dsh-compaction-basic'), load('dsh-compaction-tool-result-pruner'),
  ]);
  const ctx = new Context();
  try {
    await kit.mountAgentLoopTestDependencies(ctx);
    if (memory) {
      // Match rc2-completion's native profile routing, including peer identities.
      const profile = join(directory, 'home/profiles/fixture');
      const plugin = join(profile, 'node_modules/dsh-plugin-project-mode');
      await mkdir(plugin, { recursive: true });
      await cp(join(repository, 'packages/project-mode/lib'), join(plugin, 'lib'), { recursive: true });
      await cp(join(repository, 'packages/project-mode/package.json'), join(plugin, 'package.json'));
      const boot = await load('dsh-app-boot');
      const installAnchor = join(dirname(resolve(modules)), 'package.json');
      boot.initProfile(profile, []);
      const resolution = await boot.createRuntimeResolution({ installAnchor,
        profile: boot.loadProfileDirectory('dsh', profile, installAnchor), home: join(directory, 'home') });
      await ctx.plugin(boot.PluginPackages, { resolution });
      for (const [name, config] of [
        ['dsh-sandbox-policy', { mode: 'danger-full-access' }], ['dsh-fs-sandbox', { cwd: directory }],
        ['dsh-working-directory'], ['dsh-session-persistence-jsonl', { root: join(directory, 'sessions'), compression: 'none' }],
        ['dsh-jobs-local'], ['dsh-storage'], ['dsh-storage-json', { root: join(directory, 'storage') }],
        ['dsh-storage-domain', { backend: 'json' }], ['dsh-session-query'], ['dsh-subagent'],
        ['dsh-subagent-spawn-in-process', { providerName: 'spawn' }],
      ]) {
        const module = await load(name);
        await ctx.plugin(module.default ?? module, config);
      }
      const { default: ProjectMode } = await import(pathToFileURL(join(plugin, 'lib/index.js')).href);
      await ctx.plugin(ProjectMode, { completionVerification: false });
    }
    await ctx.plugin(Loop, { agents: [] });
    await ctx.plugin(Meter);
    await ctx.plugin(Pruner);
    await ctx.plugin(Compactor, { modelPolicies: [{ provider: 'scripted', model: 'test', ...policy }] });
    class Adapter extends LlmAdapter {
      requests = [];
      handle = () => response('done');
      summarize = () => response('CHECKPOINT: previous evidence retained; continue the current request.');
      async resolveModel(provider, model) {
        return { provider, id: model, name: model, context: { contextWindow: 1048576 }, defaultMaxTokens: 256000,
          reasoning: { efforts: [{ id: 'high', name: 'high' }], defaultEffort: 'high' } };
      }
      async *stream(request) {
        this.requests.push(request);
        yield* await (request.purpose === 'compaction' ? this.summarize(request) : this.handle(request));
      }
    }
    const adapter = new Adapter();
    ctx.llm.registerAdapter(['scripted'], adapter);
    const errors = [];
    ctx.on('agent/error', event => errors.push(event.error));
    const { agent } = await ctx.agents.create({ sessionId: 'native-context-policy', meta: { cwd: directory },
      agentOptions: { provider: 'scripted', model: 'test', reasoningEffort: 'high' } });
    let paths;
    if (memory) paths = (await ctx.projectMode.setEnabled(agent.id, true, 0, 'enable')).paths;
    const user = body => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: body }] });
    return { ctx, agent, adapter, errors, paths, user,
      events: type => agent.session.snapshotEvents().filter(event => event.type === type),
      normalRequests: () => adapter.requests.filter(request => request.purpose !== 'compaction'),
      async seed() {
        // A real initial turn admits several independently compactable nodes.
        // No durable request header exists until that first request is routed.
        for (let index = 0; index < 6; index++) agent.steer(user(`OLD-${index}:` + 'h'.repeat(60000)));
        await agent.whenIdle();
        assert.deepEqual(errors, []);
        assert.equal(adapter.requests.filter(request => request.purpose === 'compaction').length, 0);
        const pressure = ctx.tokenMeter.measure(agent.session).totalTokens;
        assert.ok(pressure > 65536 && pressure < 727040,
          `Seed pressure ${pressure} must exceed this policy's 64k threshold but remain below the default threshold`);
      },
      async dispose() { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

nativeTest('native 64k policy summarizes real pressure, preserves audit and latest input, and prunes a paired tool result', async () => {
  const f = await fixture();
  try {
    await f.seed();
    const original = JSON.stringify(f.agent.session.snapshotEvents());
    const originalCount = f.agent.session.snapshotEvents().length;
    const priorRequests = f.normalRequests().length;
    const largeResult = 'TOOL_HEAD\n' + 'r'.repeat(280000) + '\nTOOL_TAIL';
    f.ctx.tools.register({ name: 'large_result', description: 'scripted large result', parameters: { type: 'object' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => largeResult });
    f.adapter.handle = () => f.normalRequests().length === priorRequests + 1 ? call() : response('finished');
    f.agent.steer(f.user('LATEST HUMAN REQUIREMENT'));
    await f.agent.whenIdle();
    assert.deepEqual(f.errors, []);
    assert.equal(f.events('compaction/summary').length, 1);
    assert.equal(f.events('compaction/prune').length, 1);
    assert.equal(JSON.stringify(f.agent.session.snapshotEvents().slice(0, originalCount)), original);
    const summaryRequest = f.adapter.requests.find(request => request.purpose === 'compaction');
    assert.equal(summaryRequest.maxTokens, policy.maxTokens);
    assert.equal(summaryRequest.provider, 'scripted');
    assert.equal(summaryRequest.model, 'test');
    assert.ok(!summaryRequest.messages.some(message => text(message).includes('LATEST HUMAN REQUIREMENT')));
    const next = f.normalRequests()[priorRequests].messages;
    const checkpoint = next.findIndex(message => message.source?.kind === 'compact-checkpoint');
    const latest = next.findIndex(message => text(message) === 'LATEST HUMAN REQUIREMENT');
    assert.ok(checkpoint >= 0 && latest > checkpoint);
    const results = f.events('tool/result');
    assert.equal(results.length, 2);
    assert.equal(text(results[0].data.message), largeResult);
    assert.ok(text(results[1].data.message).includes('tool result middle pruned'));
    assert.ok(text(results[1].data.message).startsWith('TOOL_HEAD'));
    assert.ok(text(results[1].data.message).endsWith('TOOL_TAIL'));
    assert.deepEqual(results[1].sourceEventSeqs, [results[0].seq]);
    const replay = f.normalRequests().at(-1).messages;
    const toolCalls = replay.flatMap(message => message.content.filter(block => block.type === 'tool-call'));
    const toolResults = replay.filter(message => message.role === 'tool');
    assert.equal(toolCalls.length, 1);
    assert.equal(toolResults.length, 1);
    assert.equal(toolCalls[0].id, toolResults[0].toolCallId);
    assert.equal(f.events('turn/end').at(-1).data.reason.kind, 'completed');
  } finally { await f.dispose(); }
});

nativeTest('native compaction refreshes the complete current MoA notes without accumulating snapshots', async () => {
  const f = await fixture({ memory: true });
  try {
    await writeFile(f.paths.notes, 'NOTES BEFORE COMPACTION');
    await f.seed();
    const originalNotes = f.events('user/message').find(event => event.data.source.kind === 'moa-notes');
    await writeFile(f.paths.notes, 'NOTES AFTER COMPACTION');
    f.agent.steer(f.user('LATEST WITH NOTES'));
    await f.agent.whenIdle();
    assert.deepEqual(f.errors, []);
    assert.equal(f.events('compaction/summary').length, 1);
    assert.ok(f.events('compaction/summary')[0].data.shadowedSeqs.includes(originalNotes.seq));
    const request = f.normalRequests().at(-1);
    const notes = request.messages.filter(message => message.source?.kind === 'moa-notes');
    assert.equal(notes.length, 1);
    assert.match(text(notes[0]), /NOTES AFTER COMPACTION/);
    assert.doesNotMatch(text(notes[0]), /NOTES BEFORE COMPACTION/);
    assert.match(text(f.agent.session.eventAt(originalNotes.seq).data), /NOTES BEFORE COMPACTION/);
    assert.equal(f.events('turn/end').at(-1).data.reason.kind, 'completed');
  } finally { await f.dispose(); }
});

nativeTest('a failed native summary closes its failed bracket without a successful replacement', async () => {
  const f = await fixture();
  try {
    await f.seed();
    const before = [...f.agent.session.surface.nodes];
    f.adapter.summarize = () => { throw new Error('SCRIPTED SUMMARY FAILURE'); };
    f.agent.steer(f.user('CONTINUE AFTER SUMMARY FAILURE'));
    await f.agent.whenIdle();
    assert.equal(f.events('compaction/start').length, 1);
    assert.equal(f.events('compaction/summary').length, 0);
    assert.equal(f.events('compaction/end').length, 1);
    assert.match(JSON.stringify(f.events('compaction/end')[0].data.error), /SCRIPTED SUMMARY FAILURE/);
    assert.ok(before.every(seq => f.agent.session.surface.nodes.includes(seq)));
    assert.ok(!f.agent.session.deriveMessages().some(message => message.source?.kind === 'compact-checkpoint'));
    // Native pressure failure is recoverable: continuing the task is not proof
    // that compaction succeeded. Only the failed bracket was written.
    assert.equal(f.events('turn/end').at(-1).data.reason.kind, 'completed');
  } finally { await f.dispose(); }
});

nativeTest('cancelling a native summary writes failure and never a successful checkpoint', async () => {
  const f = await fixture();
  const entered = Promise.withResolvers();
  try {
    await f.seed();
    const before = [...f.agent.session.surface.nodes];
    const priorRequests = f.normalRequests().length;
    f.adapter.summarize = async request => {
      entered.resolve();
      await new Promise((_, reject) => {
        if (request.signal.aborted) reject(request.signal.reason);
        else request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    };
    f.agent.steer(f.user('CANCEL DURING SUMMARY'));
    await entered.promise;
    f.agent.cancel({ kind: 'user' });
    await f.agent.whenIdle();
    assert.equal(f.events('compaction/start').length, 1);
    assert.equal(f.events('compaction/summary').length, 0);
    assert.equal(f.events('compaction/end').length, 1);
    assert.ok(f.events('compaction/end')[0].data.error);
    assert.ok(before.every(seq => f.agent.session.surface.nodes.includes(seq)));
    assert.ok(!f.agent.session.deriveMessages().some(message => message.source?.kind === 'compact-checkpoint'));
    assert.notEqual(f.events('turn/end').at(-1).data.reason.kind, 'completed');
    assert.equal(f.normalRequests().length, priorRequests);
  } finally { f.agent.cancel({ kind: 'user' }); await f.dispose(); }
});
