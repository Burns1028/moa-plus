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

async function fixture(mode, testsRequired) {
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
    if (mode === 'ptc' || testsRequired) {
      await ctx.plugin((await load('dsh-subprocess-local')).default);
      await ctx.plugin((await load('dsh-sandbox-local')).default);
    }
    if (mode === 'ptc') await ctx.plugin((await load('dsh-ptc-runtime-node')).default);
    if (testsRequired) {
      await ctx.plugin((await load('dsh-pwsh-sandbox')).default);
      await ctx.plugin(await load('dsh-shell-env'));
      await ctx.plugin(await load('dsh-tool-pwsh'), { promoteOnTimeout: false });
    }
    class ScriptedModel extends LlmAdapter {
      requests = [];
      handler = () => text('candidate');
      async resolveModel(provider, model) { return { provider, id: model, name: model }; }
      async *stream(request) { this.requests.push(request); yield* this.handler(request); }
    }
    const adapter = new ScriptedModel();
    ctx.llm.registerAdapter(['test'], adapter);
    await ctx.plugin(ProjectMode, { completionVerification: true });
    const { agent } = await ctx.agents.create({
      sessionId: 'rc2-first-turn', meta: { cwd: directory }, agentOptions: { provider: 'test', model: 'test' },
      async setup(scope) {
        if (mode === 'ptc') await scope.plugin(await load('dsh-tool-executor-ptc'));
      },
    });
    await ctx.projectMode.setEnabled(agent.id, true, 0, 'enable');
    return { ctx, agent, adapter, directory, createUserMessage, snapshotJsonValue,
      async dispose() { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); throw error; }
}

for (const mode of ['native', 'ptc']) for (const testsRequired of [false, true]) {
  test(`rc2 full plugin first turn completes helpers and persists JSON cache (parent=${mode}, tests=${testsRequired})`, {
    skip: !modules || (testsRequired && process.platform !== 'win32'), timeout: 20000,
  }, async () => {
    const f = await fixture(mode, testsRequired);
    const errors = [], shellResults = [];
    let main = 0, builder = 0, verifier = 0, retry = '';
    f.ctx.on('agent/error', ({ error }) => errors.push(error));
    f.ctx.on('tools/result', (exec, result) => { if (exec.name === 'pwsh') shellResults.push(result); });
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
          if (verifier === 2) return testsRequired
            ? call('pwsh', { command: "Write-Output 'should not run without record protection'", description: 'Run required tests', timeoutMs: 1000 })
            : call('read_candidate');
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
      assert.equal(verifier, 3, JSON.stringify({ main, builder, retry, errors: errors.map(String), requests: f.adapter.requests.map(request => ({ id: request.sessionId, tools: request.tools.map(tool => tool.name) })) }));
      assert.equal(main, testsRequired ? 2 : 1);
      assert.deepEqual(errors, []);
      const completed = f.agent.session.snapshotEvents().some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed');
      assert.equal(completed, !testsRequired);
      if (testsRequired) {
        assert.match(retry, /Outcome verification did not pass/);
        assert.equal(shellResults.length, 1);
        assert.equal(shellResults[0].error?.info?.code, 'READ_ONLY_PATH_UNSUPPORTED');
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
