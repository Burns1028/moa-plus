import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const modules = process.env.MOA_COMPAT_MODULES;
const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const load = (name) => import(pathToFileURL(join(resolve(modules), '@deepseek-ai', name, 'lib/index.js')).href);
const text = body => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: body },
  { type: 'block-end', index: 0, block: { type: 'text', text: body } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const call = (name, args = {}) => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'first-turn-call', name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
];

const completePrompt = 'A preset-owned complete SYSTEM prompt.';
async function fixture(mode, testsRequired, selectedEffort, shellAvailable = testsRequired, { persistent = false, completePreset = false, defaultPwshJobs = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'moa-rc2-first-turn-'));
  const home = join(directory, 'home');
  const profileDirectory = join(home, 'profiles', 'fixture');
  // Use the host's real profile routing, with no runtime node_modules link.
  // Native providers may be supplied through transitive installation peers.
  const pluginDirectory = join(profileDirectory, 'node_modules', '@agents-anywhere', 'project-mode');
  await mkdir(pluginDirectory, { recursive: true });
  await cp(join(repository, 'packages/project-mode/lib'), join(pluginDirectory, 'lib'), { recursive: true });
  await cp(join(repository, 'packages/project-mode/package.json'), join(pluginDirectory, 'package.json'));
  const [{ Context }, kit, { default: AgentLoop }, { LlmAdapter, createUserMessage },
    { default: Policy }, { default: Fs }, { default: WorkingDirectory }, Persistence,
    { default: Jobs }, { default: Storage }, StorageJson, StorageDomain,
    { default: Query }, { default: Subagents }, Spawn, { default: Cache },
    { snapshotJsonValue }, boot] = await Promise.all([
    load('cordis'), load('dsh-agent-loop-testkit'), load('dsh-agent-loop'), load('dsh-llm'),
    load('dsh-sandbox-policy'), load('dsh-fs-sandbox'), load('dsh-working-directory'), load('dsh-session-persistence-jsonl'),
    load('dsh-jobs-local'), load('dsh-storage'), load('dsh-storage-json'), load('dsh-storage-domain'),
    load('dsh-session-query'), load('dsh-subagent'), load('dsh-subagent-spawn-in-process'), load('dsh-session-projection-cache'),
    load('dsh-util-values'), load('dsh-app-boot'),
  ]);
  const installAnchor = join(dirname(resolve(modules)), 'package.json');
  boot.initProfile(profileDirectory, []);
  const resolution = await boot.createRuntimeResolution({ installAnchor,
    profile: boot.loadProfileDirectory('dsh', profileDirectory, installAnchor), home });
  const nativeExecutorEntry = resolution.entries.find(entry => entry.name === '@deepseek-ai/dsh-tool-executor-native');
  assert.equal(nativeExecutorEntry?.scope, 'installation');
  const ctx = new Context();
  try {
    await ctx.plugin(boot.PluginPackages, { resolution });
    // Prove the same bare imports the packaged plugin uses keep the host's
    // core identities and find the official provider under profile routing.
    await writeFile(join(pluginDirectory, 'resolution-probe.mjs'), `
      import * as tools from '@deepseek-ai/dsh-tools';
      import * as cordis from '@deepseek-ai/cordis';
      export { tools, cordis };
      export const nativeExecutor = await import(import.meta.resolve('@deepseek-ai/dsh-tool-executor-native'));
    `);
    const probe = await import(pathToFileURL(join(pluginDirectory, 'resolution-probe.mjs')).href);
    assert.equal(probe.tools, await load('dsh-tools'));
    assert.equal(probe.cordis, await load('cordis'));
    assert.equal(probe.nativeExecutor, await load('dsh-tool-executor-native'));
    const { default: ProjectMode } = await import(pathToFileURL(join(pluginDirectory, 'lib/index.js')).href);
    await kit.mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(Policy, { mode: 'danger-full-access' });
    await ctx.plugin(Fs, { cwd: directory });
    await ctx.plugin(WorkingDirectory);
    await ctx.plugin(Persistence, { root: join(directory, 'sessions'), compression: 'none' });
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(Jobs);
    await ctx.plugin(Storage);
    await ctx.plugin(StorageJson, { root: join(directory, 'storage') });
    await ctx.plugin(StorageDomain, { backend: 'json' });
    await ctx.plugin(Query);
    await ctx.plugin(Subagents);
    await ctx.plugin(Spawn, { providerName: 'spawn' });
    await ctx.plugin(Cache, { writeEveryEvents: 100, writeIntervalMs: 60000 });
    if (mode === 'ptc' || shellAvailable) {
      await ctx.plugin((await load('dsh-subprocess-local')).default);
      await ctx.plugin((await load('dsh-sandbox-local')).default);
    }
    if (mode === 'ptc') await ctx.plugin((await load('dsh-ptc-runtime-node')).default);
    if (shellAvailable) {
      if (persistent) {
        await ctx.plugin((await load('dsh-terminal')).default);
        await ctx.plugin(await load('dsh-terminal-bash'), { backendType: 'shell', shellDialect: 'pwsh' });
        await ctx.plugin(await load('dsh-tool-pwsh-persistent'));
        assert.deepEqual(ctx.terminals.listBackends(), ['shell']);
      } else {
        await ctx.plugin((await load('dsh-pwsh-sandbox')).default);
        await ctx.plugin(await load('dsh-shell-env'));
        if (defaultPwshJobs) {
          await ctx.plugin((await load('dsh-user-approval')).default, { policy: 'ask' });
          await ctx.plugin(await load('dsh-tool-jobs'));
          await ctx.plugin(await load('dsh-tool-pwsh'));
        }
        else await ctx.plugin(await load('dsh-tool-pwsh'), { promoteOnTimeout: false });
      }
    }
    if (completePreset) {
      ctx.baseUrl = pathToFileURL(profileDirectory + '/').href;
      await ctx.plugin((await load('cordis-plugin-loader')).default);
      ctx.loader.builtins['completion-complete-prompt'] = {
        inject: ['systemPrompt'],
        apply(scope) {
          scope.systemPrompt.section({ name: 'preset:complete-system', order: 0, complete: true, text: completePrompt });
          scope.systemPrompt.suppressRuntimeContext();
        },
      };
      await ctx.plugin((await load('dsh-agent-preset-registry')).default, { default: 'completion-complete' });
      await ctx.agentPresets.register({ id: 'completion-complete', plugins: [{ name: 'cordis:completion-complete-prompt' }] });
    }
    class ScriptedModel extends LlmAdapter {
      requests = [];
      handler = () => text('candidate');
      async resolveModel(provider, model) {
        return { provider, id: model, name: model,
          reasoning: { efforts: ['off', 'low', 'high'].map(id => ({ id, name: id })),
            defaultEffort: selectedEffort === undefined ? 'low' : 'high' } };
      }
      async *stream(request) { this.requests.push(request); yield* this.handler(request); }
    }
    const adapter = new ScriptedModel();
    ctx.llm.registerAdapter(['test'], adapter);
    await ctx.plugin(ProjectMode, { completionVerification: true });
    const { agent } = await ctx.agents.create({
      sessionId: 'rc2-first-turn', meta: { cwd: directory },
      agentOptions: { provider: 'test', model: 'initial', reasoningEffort: 'high' },
      async setup(scope) {
        if (completePreset) await ctx.agentPresets.mount(scope);
        if (mode === 'ptc') await scope.plugin(await load('dsh-tool-executor-ptc'));
      },
    });
    // The desktop Session Controller records this selection before the turn;
    // no request header has been written yet, and options still name initial.
    agent.model.select({ provider: 'test', model: 'selected',
      ...(selectedEffort === undefined ? {} : { reasoningEffort: selectedEffort }) });
    await ctx.projectMode.setEnabled(agent.id, true, 0, 'enable');
    return { ctx, agent, adapter, directory, createUserMessage, snapshotJsonValue,
      async dispose() { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); throw error; }
}

const scenarios = ['native', 'ptc'].flatMap(mode => [false, true].map(testsRequired => ({ mode, testsRequired, selectedEffort: 'high', attemptShell: testsRequired })));
scenarios.push({ mode: 'native', testsRequired: false, selectedEffort: undefined, attemptShell: false });
scenarios.push({ mode: 'native', testsRequired: false, selectedEffort: 'high', attemptShell: true });
scenarios.push({ mode: 'native', testsRequired: false, selectedEffort: 'high', attemptShell: true, persistent: true });
scenarios.push({ mode: 'native', testsRequired: false, selectedEffort: 'high', attemptShell: true, defaultPwshJobs: true });
scenarios.push({ mode: 'native', testsRequired: false, selectedEffort: 'high', attemptShell: false, completePreset: true });
for (const { mode, testsRequired, selectedEffort, attemptShell, persistent, completePreset, defaultPwshJobs } of scenarios) {
  test(`rc2 full plugin first turn converges and persists JSON cache (parent=${mode}, tests=${testsRequired}, effort=${selectedEffort ?? 'default'}, shell=${persistent ? 'persistent' : defaultPwshJobs ? 'default-jobs' : attemptShell}, completePreset=${!!completePreset})`, {
    skip: !modules || (attemptShell && process.platform !== 'win32'), timeout: 20000,
  }, async () => {
    const f = await fixture(mode, testsRequired, selectedEffort, attemptShell, { persistent, completePreset, defaultPwshJobs });
    const errors = [], shellResults = [], jobEvents = [], approvalEvents = [];
    let main = 0, builder = 0, verifier = 0, retry = '', shellOwner;
    f.ctx.on('agent/error', ({ error }) => errors.push(error));
    f.ctx.on('tools/result', (exec, result) => {
      if (exec.name === 'pwsh') { shellResults.push(result); shellOwner = exec.agent; }
    });
    f.ctx.on('session/event', (_session, event) => {
      if ((event.type === 'job/registered' || event.type === 'job/settled') && event.data.kind === 'pwsh') jobEvents.push(event);
      if (event.type === 'approval/asked') approvalEvents.push(event);
    });
    try {
      f.adapter.handler = request => {
        const id = String(request.sessionId);
        const names = request.tools.map(tool => tool.name);
        if (id.startsWith('moa-builder-')) {
          builder++;
          assert.deepEqual(names, ['submit_rubric']);
          return call('submit_rubric', { rubric: '- Deliver the requested report [human requirement]', tests_required: testsRequired });
        }
        if (id.startsWith('moa-verifier-')) {
          verifier++;
          assert.ok(names.includes('read_rubric') && names.includes('read_candidate') && names.includes('submit_verdict'));
          assert.ok(!names.includes('run_code'));
          if (verifier === 1) return call('read_rubric');
          if (verifier === 2) return attemptShell
            ? call('pwsh', { command: "Write-Output 'should not run without record protection'",
              ...(persistent ? {} : { description: 'Run required tests', timeoutMs: 1000 }) })
            : call('read_candidate');
          if (attemptShell) {
            // A model that treats this backend error as a retryable command
            // failure would next seek wider access, then keep retrying. The
            // native capability boundary must prevent this model step itself.
            if (verifier > 3) f.agent.cancel({ kind: 'user' });
            return call('pwsh', { command: "Write-Output 'retry must not run'", description: 'Retry with wider access',
              timeoutMs: 1000, sandbox_permissions: 'danger-full-access', justification: 'Retry the failed verification command' });
          }
          return call('submit_verdict', { status: 'Pass', issues: [] });
        }
        main++;
        if (mode === 'ptc') assert.ok(names.includes('run_code'));
        else assert.ok(!names.includes('run_code'));
        if (main > 1) {
          retry = JSON.stringify(request.messages);
          f.agent.cancel({ kind: 'user' });
        }
        return text('The requested completed report');
      };
      f.agent.followup(f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Deliver a report' }] }));
      await f.agent.whenIdle();
      assert.equal(builder, 1);
      if (defaultPwshJobs) {
        assert.ok(jobEvents.some(event => event.type === 'job/registered'), 'the real jobs controller must admit the PowerShell producer');
        assert.ok(jobEvents.some(event => event.type === 'job/settled'), 'the real jobs controller must settle the PowerShell producer');
      }
      assert.equal(verifier, attemptShell ? 2 : 3, JSON.stringify({ main, builder, retry, errors: errors.map(String),
        jobs: jobEvents.map(event => ({ type: event.type, data: event.data })),
        shellResults: shellResults.map(result => ({ isError: result.isError, code: result.error?.info?.code ?? null, error: result.error })),
        requests: f.adapter.requests.map(request => ({ id: request.sessionId, tools: request.tools.map(tool => tool.name) })) }));
      assert.equal(main, 1);
      if (attemptShell) {
        assert.equal(errors.length, 1);
        assert.match(String(errors[0]), /MoA\+ Outcome Verifier cannot run pwsh:.*Readonly path policy is unsupported/);
      } else assert.deepEqual(errors, []);
      for (const request of f.adapter.requests) {
        assert.equal(request.model, 'selected');
        assert.equal(request.reasoningEffort, String(request.sessionId).startsWith('moa-builder-') ? 'off' : selectedEffort ?? 'low');
      }
      const builderRequest = f.adapter.requests.find(request => String(request.sessionId).startsWith('moa-builder-'));
      const builderText = builderRequest.messages.filter(message => message.source.kind === 'user').at(-1).content
        .filter(block => block.type === 'text').map(block => block.text).join('\n');
      const builderInput = JSON.parse(builderText.slice(builderText.lastIndexOf('\n') + 1));
      const parentRequest = f.adapter.requests.find(request => request.sessionId === f.agent.id);
      const context = parentRequest.messages.filter(message => message.source.kind === 'runtime-context').at(-1)?.source;
      const task = context?.sections?.find(section => section.name === 'project-mode:task');
      assert.ok(task, 'the actual native runtime context must retain the original human task');
      assert.match(task.text, /^Existing unfinished task:/);
      assert.match(task.text, /not a new human message/);
      const taskInput = JSON.parse(task.text.slice(task.text.lastIndexOf('\n') + 1));
      assert.deepEqual(taskInput, builderInput);
      assert.deepEqual(taskInput.requirements, ['Deliver a report']);
      assert.deepEqual(taskInput.sources, {});
      assert.deepEqual(taskInput.sourceVersions, []);
      if (completePreset) {
        const system = parentRequest.messages.filter(message => message.role === 'system').flatMap(message => message.content)
          .filter(block => block.type === 'text').map(block => block.text).join('\n');
        assert.equal(system, completePrompt);
        const role = context.sections.find(section => section.name === 'project-mode:role');
        assert.match(role?.text ?? '', /You are the MoA\+ coordinator/);
        const allText = parentRequest.messages.flatMap(message => message.content).filter(block => block.type === 'text')
          .map(block => block.text).join('\n');
        assert.equal(allText.split('You are the MoA+ coordinator').length - 1, 1);
      }
      const completed = f.agent.session.snapshotEvents().some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed');
      assert.equal(completed, !attemptShell);
      if (attemptShell) {
        assert.equal(retry, '');
        const end = f.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end');
        assert.equal(end.data.reason.kind, 'error');
        assert.match(end.data.reason.error.message, /Readonly path policy is unsupported/);
        assert.equal(shellResults.length, 1);
        assert.equal(shellResults[0].error?.info?.code, 'READ_ONLY_PATH_UNSUPPORTED');
        assert.equal(shellResults[0].error?.info?.name, 'ReadOnlyPathUnsupportedError');
        if (persistent) assert.deepEqual(f.ctx.terminals.list(shellOwner), []);
        if (defaultPwshJobs) {
          assert.equal(jobEvents.filter(event => event.type === 'job/registered').length, 1);
          assert.equal(jobEvents.filter(event => event.type === 'job/settled' && event.data.status === 'failed').length, 1);
          assert.deepEqual(f.ctx.jobs.list(shellOwner.id), []);
          assert.deepEqual(approvalEvents, []);
        }
      }
      // Explicit cache writes propagate serialization failures. This covers the
      // real first-turn path that an import/toggle-only smoke test cannot see.
      await f.ctx.sessionProjectionCache.write(f.agent.session);
      const rows = f.ctx.sessionProjections.checkpoint(f.agent.session);
      assert.deepEqual(f.snapshotJsonValue(rows), rows);
      assert.equal(rows['project-mode-results'].ver, 5);
      const cache = join(f.directory, 'storage/session_projcache/sessions');
      const files = await readdir(cache);
      assert.ok(files.some(file => file.endsWith('.json')));
      const stored = await Promise.all(files.filter(file => file.endsWith('.json')).map(file => readFile(join(cache, file), 'utf8')));
      assert.ok(stored.some(body => body.includes('project-mode-results')));
    } finally { await f.dispose(); }
  });
}

for (const failedRole of ['builder', 'verifier']) {
  test(`rc2 native ${failedRole} failure ends the parent turn without a self-repair retry`, {
    skip: !modules, timeout: 20000,
  }, async () => {
    const f = await fixture('native', false, 'high');
    let parentRequests = 0;
    try {
      f.adapter.handler = request => {
        const id = String(request.sessionId);
        if (id.startsWith(`moa-${failedRole}-`)) throw new Error(`fixture-${failedRole}-infrastructure-failure`);
        if (id.startsWith('moa-builder-')) return call('submit_rubric', {
          rubric: '- Deliver the requested report [human requirement]', tests_required: false,
        });
        if (id.startsWith('moa-verifier-')) throw new Error('unexpected Verifier request after failed Builder');
        if (++parentRequests > 1) f.agent.cancel({ kind: 'user' });
        return text('The requested completed report');
      };
      f.agent.followup(f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Deliver a report' }] }));
      await f.agent.whenIdle();
      assert.equal(parentRequests, 1);
      const events = f.agent.session.snapshotEvents();
      const ends = events.filter(event => event.type === 'turn/end');
      assert.equal(ends.length, 1);
      assert.equal(ends[0].data.reason.kind, 'error');
      assert.match(ends[0].data.reason.error.message, new RegExp(`fixture-${failedRole}-infrastructure-failure`));
      assert.doesNotMatch(JSON.stringify(events), /Outcome verification blocked/);
    } finally { await f.dispose(); }
  });
}
