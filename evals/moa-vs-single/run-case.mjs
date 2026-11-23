// One real native DSH run. Raw sessions stay in the explicitly supplied output directory.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cases } from './suite.mjs';
import { observeNativeOutcome } from './outcome-observation.mjs';
import { armMode, createCompactionObserver, earlyCompactionPolicy, flushLiveSessions, requestRoutingMetadata, verifyCompactionConfig } from './compaction-control.mjs';

const [manifestPath, runId, bootOnly] = process.argv.slice(2);
assert.ok(manifestPath && runId, 'Use run.mjs to prepare and dispatch evaluation runs');
const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
const entry = manifest.runs.find(row => row.id === runId);
assert.ok(entry, 'Run must exist in the frozen plan');
const { moa, compact } = armMode(entry.arm);
assert.ok(!compact || manifest.compactionStudy, 'Early compaction arms require a frozen compaction study');
assert.ok(!manifest.compactionStudy || !manifest.baseline, 'Compaction and baseline-repository comparisons are mutually exclusive');
const hash = value => createHash('sha256').update(value).digest('hex');
async function verifyBuild(directory, expected, label) {
  assert.ok(directory && expected, `${label} repository and fingerprint are required`);
  const actual = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
    hostSha256: hash(await readFile(join(directory, 'packages/project-mode/lib/index.js'))),
    clientSha256: hash(await readFile(join(directory, 'packages/project-mode/lib/client.js'))),
    version: JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).version };
  assert.deepEqual(actual, expected, `${label} build changed after the plan was frozen`);
}
await verifyBuild(manifest.local.repository, manifest.candidate, 'Candidate');
if (manifest.baseline) await verifyBuild(manifest.local.baselineRepository, manifest.baseline, 'Baseline');
const task = cases.find(row => row.id === entry.caseId);
assert.ok(task);
const directory = join(dirname(resolve(manifestPath)), 'runs', runId);
await mkdir(directory, { recursive: false });
const project = join(directory, 'project');
const home = join(directory, 'home');
const profileDirectory = join(home, 'profiles', 'evaluation');
await mkdir(project, { recursive: true });
for (const [name, content] of Object.entries(task.files)) {
  const destination = resolve(project, name);
  assert.ok(destination.startsWith(project + '/') || destination.startsWith(project + '\\'), 'Fixture paths stay in project');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8', stdio: 'pipe' });
git('init');
git('config', 'user.name', 'Agent Evaluation');
git('config', 'user.email', 'agent-evaluation@example.invalid');
git('add', '.');
git('commit', '--allow-empty', '-m', 'Frozen evaluation input');
const runtime = manifest.local.runtime;
process.env.DSH_HOME = home;
process.env.DSH_AGENTS_HOME = join(directory, 'agents-home');
process.env.DSH_TELEMETRY_DISABLED = '1';
await mkdir(process.env.DSH_AGENTS_HOME, { recursive: true });
process.chdir(project);
const load = name => import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai', name, 'lib/index.js')).href);
const boot = await load('dsh-app-boot');
const { runProfile } = await import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js')).href);
const { createUserMessage } = await load('dsh-llm');
const compactPolicy = compact ? earlyCompactionPolicy(manifest.model) : null;
if (manifest.compactionStudy) assert.deepEqual(manifest.compactionStudy.policy, earlyCompactionPolicy(manifest.model), 'Compaction study policy changed');
const pluginRepository = entry.arm === 'moa-baseline' ? manifest.local.baselineRepository : manifest.local.repository;
const pluginBuild = entry.arm === 'moa-baseline' ? manifest.baseline : manifest.candidate;
boot.initProfile(profileDirectory, ['@deepseek-ai/dsh-base', ...(moa ? ['dsh-plugin-project-mode'] : [])]);
if (moa) {
  const plugin = join(profileDirectory, 'node_modules/dsh-plugin-project-mode');
  await mkdir(plugin, { recursive: true });
  for (const part of ['lib', 'assets', 'package.json', 'cordis.patch.yml']) {
    await cp(join(pluginRepository, 'packages/project-mode', part), join(plugin, part), { recursive: true });
  }
  assert.equal(hash(await readFile(join(plugin, 'lib/index.js'))), pluginBuild.hostSha256, 'Copied plugin Host differs from its frozen build');
  assert.equal(hash(await readFile(join(plugin, 'lib/client.js'))), pluginBuild.clientSha256, 'Copied plugin Client differs from its frozen build');
}
await stat(manifest.local.credentials); // Reference only: native provider resolves secrets.
const patches = [
  { id: 'credentials', config: { path: manifest.local.credentials, watch: false } },
  { id: 'deepseek-account', disabled: true }, { id: 'llm-deepseek-account', disabled: true },
  { id: 'agent-default-model', config: manifest.model },
  ...(compact ? [{ id: 'compaction-basic', config: { modelPolicies: [compactPolicy] } }] : []),
  { id: 'fs-sandbox', config: { cwd: project } },
  { id: 'sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: project } },
  { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
  { id: 'storage-json', config: { root: join(home, 'storages') } },
  { id: 'session-log-deepseek', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
  { id: 'session-title-llm', disabled: true }, { id: 'hmr', disabled: true },
  ...(moa ? [{ id: 'project-mode', config: {} }] :
    ['tool-subagent', 'tool-subagent-fork', 'tool-subagent-control', 'tool-workflow'].map(id => ({ id, disabled: true }))),
];
await writeFile(join(profileDirectory, 'cordis.patch.yml'), JSON.stringify(patches, null, 2));

const started = Date.now();
const requests = [], agents = [], tools = [], errors = [], textMessages = [];
const compactionObserver = createCompactionObserver();
const result = { id: runId, caseId: entry.caseId, arm: entry.arm, repetition: entry.repetition,
  startedAt: new Date().toISOString(), runtime: process.versions, model: manifest.model, ...(moa ? { pluginBuild } : {}),
  completed: false, stopReason: null, project, requests, tools, agents, errors,
  compaction: { requestedPolicy: compactPolicy, events: compactionObserver.events } };
let ctx, shutdown, root, submittedAt, firstTextAt, timer;
let stopPromise;
const textOf = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('');
const errorText = error => String(error?.message ?? error).slice(0, 2000);
const aggregateUsage = () => {
  const measured = requests.filter(row => row.usage);
  const sum = key => measured.reduce((total, row) => total + (row.usage[key] ?? 0), 0);
  return { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    reasoningTokens: measured.some(row => row.usage.reasoningTokens != null) ? sum('reasoningTokens') : null,
    reasoningMeasuredRequests: measured.filter(row => row.usage.reasoningTokens != null).length,
    totalTokens: measured.reduce((total, row) => total + (row.usage.totalTokens ??
      row.usage.inputTokens + row.usage.outputTokens + (row.usage.cacheReadTokens ?? 0) + (row.usage.cacheWriteTokens ?? 0)), 0),
    measuredRequests: measured.length, missingUsageRequests: requests.length - measured.length };
};
let rejectStop;
const stopped = new Promise((_, reject) => { rejectStop = reject; });
// Install the rejection handler before a budget/timeout can trigger.
stopped.catch(() => {});
function stop(reason) {
  if (stopPromise) return stopPromise;
  result.stopReason = reason;
  stopPromise = (async () => {
    compactionObserver.cancelActive();
    root?.cancel({ kind: 'user' });
    if (root && ctx.subagents) await ctx.subagents.drainDescendants([root]);
    if (root) await root.whenIdle();
  })();
  stopPromise.catch(error => errors.push({ phase: 'stop', message: errorText(error) }));
  rejectStop(new Error(reason));
  return stopPromise;
}
try {
  const profile = boot.loadProfileDirectory('dsh', profileDirectory, join(runtime, 'package.json'));
  ({ ctx, shutdown } = await runProfile({ profile: 'evaluation', patchFiles: [], args: [],
    environment: boot.loadLayeredEnv('dsh', project),
    resolvedProfile: { profile, installAnchor: join(runtime, 'package.json') } }));
  if (moa) assert.equal(ctx.projectMode.config.completionVerification, 'on-demand');
  result.compaction.resolvedConfig = verifyCompactionConfig(ctx.compaction?.config, compactPolicy, manifest.model);
  ctx.on('agent/created', ({ agent }) => agents.push(agent));
  ctx.on('agent/error', ({ agent, error }) => errors.push({ agentId: agent?.id, message: errorText(error) }));
  ctx.on('session/event', (session, event) => {
    compactionObserver.observe(session.id, event);
    if (event.type === 'tool/call') tools.push({ agentId: session.id, name: event.data.name, time: event.time });
    if (event.type === 'assistant/message' && session.id === root?.id) {
      const text = textOf(event.data.message);
      if (text) { firstTextAt ??= Date.now(); textMessages.push({ time: event.time, characters: text.length }); }
    }
  });
  ctx.on('llm/stream', (options, next) => {
    if (requests.length >= manifest.limits.maxRequests || aggregateUsage().totalTokens >= manifest.limits.maxTotalTokens) {
      void stop('aggregate-budget-exceeded');
      throw new Error('Evaluation aggregate request/token budget reached');
    }
    const notes = (options.messages ?? []).filter(message => message.role === 'user' && message.source?.kind === 'moa-notes');
    const request = { sessionId: options.sessionId, provider: options.provider, model: options.model,
      ...requestRoutingMetadata(options),
      reasoningEffort: options.reasoningEffort, startedAt: Date.now(), toolNames: (options.tools ?? []).map(tool => tool.name),
      notesSnapshotCount: notes.length, notesSnapshotCharacters: notes.reduce((sum, message) => sum + textOf(message).length, 0) };
    requests.push(request);
    const upstream = next();
    return (async function* () {
      try {
        for await (const chunk of upstream) {
          if (chunk.type === 'usage') {
            request.usage = chunk.usage;
            if (aggregateUsage().totalTokens > manifest.limits.maxTotalTokens) void stop('aggregate-budget-exceeded');
          }
          if (chunk.type === 'text-delta' && options.purpose !== 'compaction' && options.sessionId === root?.id && chunk.text.trim()) firstTextAt ??= Date.now();
          yield chunk;
        }
      } catch (error) { request.error = errorText(error); throw error; }
      finally {
        request.elapsedMs = Date.now() - request.startedAt;
        request.cancelled = options.signal?.aborted === true;
        if (request.purpose === 'compaction' && request.cancelled) compactionObserver.cancelActive(options.sessionId);
      }
    })();
  });
  ({ agent: root } = await ctx.agents.create({ sessionId: `eval-${randomUUID()}`,
    meta: { cwd: project }, agentOptions: manifest.model }));
  result.rootId = root.id;
  if (moa) await ctx.projectMode.setEnabled(root.id, true, 0, `eval-enable-${runId}`);
  result.visibleToolNames = ctx.tools.definitions(root).map(tool => tool.name).sort();
  if (bootOnly === '--boot-only') {
    result.bootOnly = true;
  } else {
    submittedAt = Date.now();
    timer = setTimeout(() => { void stop('timeout'); }, task.timeoutSeconds * 1000);
    root.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: task.prompt }] }));
    await Promise.race([stopped, (async () => {
      while (true) {
        await root.whenIdle();
        const seq = root.session.seq;
        const waiting = ctx.subagents ? await ctx.subagents.waitForChildren(root) : false;
        if (!waiting && root.status === 'idle' && root.session.seq === seq) break;
      }
    })()]);
    const ends = root.session.snapshotEvents().filter(event => event.type === 'turn/end');
    result.endReason = ends.at(-1)?.data.reason;
    result.completed = result.endReason?.kind === 'completed';
  }
} catch (error) {
  errors.push({ phase: 'run', message: errorText(error) });
  result.stopReason ??= 'runtime-error';
} finally {
  clearTimeout(timer);
  result.responseElapsedMs = submittedAt ? Date.now() - submittedAt : null;
  result.firstTextMs = firstTextAt && submittedAt ? firstTextAt - submittedAt : null;
  if (stopPromise) {
    try { await stopPromise; } catch (error) { errors.push({ phase: 'stop-join', message: errorText(error) }); }
  }
  const events = root?.session.snapshotEvents() ?? [];
  Object.assign(result, observeNativeOutcome(events));
  if (root) {
    result.finalReply = textOf(events.filter(event => event.type === 'assistant/message').at(-1)?.data.message);
    result.rootStepCount = events.filter(event => event.type === 'step/start').length;
    result.rootTurnCount = events.filter(event => event.type === 'turn/end').length;
    result.rootTextMessages = textMessages;
  }
  result.agents = agents.map(agent => ({ id: agent.id,
    kind: agent === root ? 'root' : /^moa-builder-/.test(agent.id) ? 'builder' : /^moa-verifier-/.test(agent.id) ? 'verifier' : 'worker',
    finalStatus: agent.status, stepCount: agent.session.snapshotEvents().filter(event => event.type === 'step/start').length }));
  result.validControl = moa || agents.length === 1;
  if (!result.validControl) errors.push({ phase: 'control', message: 'Single-agent baseline unexpectedly created a child' });
  if (ctx) {
    await flushLiveSessions(ctx.sessions, agents, error => errors.push({ phase: 'flush', message: errorText(error) }));
    try { await ctx.fiber.dispose(); } catch (error) { errors.push({ phase: 'teardown', message: errorText(error) }); }
  }
  result.usage = aggregateUsage();
  result.compaction.metrics = compactionObserver.metrics(requests);
  result.budgetOvershootTokens = Math.max(0, result.usage.totalTokens - manifest.limits.maxTotalTokens);
  result.modelRequestCount = requests.length;
  result.finishedAt = new Date().toISOString();
  result.elapsedMs = Date.now() - started;
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ id: runId, completed: result.completed, responseElapsedMs: result.responseElapsedMs,
    requests: requests.length, totalTokens: result.usage.totalTokens, agents: result.agents.length, stopReason: result.stopReason }));
  if (shutdown) await shutdown.shutdown(0);
}
