import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyPatch } from 'diff';

export const repository = fileURLToPath(new URL('../../../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Load an exact audited implementation in an owned temporary directory. Never
// patch the source modules (in particular, a supplied Desktop runtime).
export async function loadJobOutput(modules) {
  const source = await readFile(join(modules, '@deepseek-ai/dsh-tool-jobs/lib/index.js'), 'utf8');
  const digest = sha256(source);
  for (const profile of ['rc3', 'rc2']) {
    const directory = join(repository, 'compat', profile);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    const entries = manifest.filter(entry => entry.package === '@deepseek-ai/dsh-tool-jobs');
    const entry = entries.find(entry => [entry.files[0].before, entry.files[0].after].includes(digest));
    if (!entry) continue;
    const finalSource = digest === entry.files[0].after ? source : applyPatch(source,
      (await readFile(join(directory, entry.runtimePatch), 'utf8')).replaceAll('\r\n', '\n'));
    assert.equal(typeof finalSource, 'string', `${profile}: exact patch must apply`);
    assert.equal(sha256(finalSource), entry.files[0].after);
    const require = createRequire(join(modules, '__job_output_fixture__.cjs'));
    const temp = await mkdtemp(join(tmpdir(), 'native-job-output-'));
    const file = join(temp, 'index.mjs');
    // Resolve each real native peer from the same supplied runtime. This only
    // rewrites import locations, not tool code or peer behavior.
    const importable = finalSource.replace(/from "(@deepseek-ai\/[^"\n]+)"/g,
      (_match, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
    await writeFile(file, importable);
    return { profile, source: finalSource, previousSource: source,
      plugin: await import(pathToFileURL(file).href),
      async dispose() { await rm(temp, { recursive: true, force: true }); } };
  }
  throw new Error(`Unrecognized dsh-tool-jobs fixture bytes: ${digest}`);
}

export async function createJobFixture(modules, config = {}) {
  const load = name => import(pathToFileURL(resolve(modules, '@deepseek-ai', name, 'lib/index.js')).href);
  const [{ Context }, { default: AgentLoop }, kit, { default: Jobs }, implementation] = await Promise.all([
    load('cordis'), load('dsh-agent-loop'), load('dsh-agent-loop-testkit'), load('dsh-jobs-local'), loadJobOutput(modules),
  ]);
  const ctx = new Context();
  await kit.mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Jobs, { pumpPollMs: 5 });
  await ctx.plugin(implementation.plugin, { completionDelivery: 'quiet', ...config });
  const { agent } = await ctx.agents.create({ sessionId: 'native-job-output-owner' });
  const { agent: outsider } = await ctx.agents.create({ sessionId: 'native-job-output-outsider' });
  const tool = ctx.tools.get('job_output', agent);
  assert.ok(tool);
  let call = 0;
  function start(options = {}) {
    const done = Promise.withResolvers();
    let handle;
    const id = ctx.jobs.start({ kind: 'fixture', label: 'controlled native job', owner: agent.id,
      ...options, run(job) { handle = job; return { done: done.promise, cancel: () => done.resolve({ status: 'killed' }) }; } });
    return { id, handle, done,
      async settle(outcome = { status: 'completed' }) { done.resolve(outcome); await ctx.jobs.wait(id, 1000, agent.id); } };
  }
  const execution = (args, options = {}) => ({ name: 'job_output', arguments: args,
    callId: `native-job-output-${++call}`, agent, signal: new AbortController().signal, ...options });
  async function read(id, args = {}, options = {}) {
    // Actual native tool execution performs schema validation, rendering and
    // finalizeContent, so assertions target the content a model receives.
    const exec = execution({ job_id: id, ...args }, options);
    if (implementation.profile === 'rc2') {
      const batch = await ctx.tools.execute({ agent: exec.agent, signal: exec.signal,
        calls: [{ type: 'tool-call', id: exec.callId, name: exec.name, arguments: JSON.stringify(exec.arguments) }] });
      assert.equal(batch.results.length, 1);
      return batch.results[0].result;
    }
    return ctx.tools.execute(exec);
  }
  return { ctx, agent, outsider, tool, start, read, execution, profile: implementation.profile,
    async dispose() { await ctx.fiber.dispose(); await implementation.dispose(); } };
}
