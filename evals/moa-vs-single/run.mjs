import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './suite.mjs';
import { makeReport } from './report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['suite.mjs', 'cases-code.mjs', 'cases-analysis.mjs', 'cases-hard.mjs', 'run.mjs', 'run-case.mjs', 'report.mjs'];
const fingerprints = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await readFile(join(here, name)))])));
const planPath = resolve(option('--plan', join(option('--output', '.'), 'manifest.json')));
async function describeBuild(directory) {
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
    hostSha256: hash(await readFile(join(directory, 'packages/project-mode/lib/index.js'))),
    clientSha256: hash(await readFile(join(directory, 'packages/project-mode/lib/client.js'))),
    version: JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).version };
}
async function verifyBuilds(manifest) {
  assert.deepEqual(await describeBuild(manifest.local.repository), manifest.candidate, 'Candidate build changed after the plan was frozen');
  if (manifest.baseline) assert.deepEqual(await describeBuild(manifest.local.baselineRepository), manifest.baseline, 'Baseline build changed after the plan was frozen');
}

async function prepare() {
  const output = resolve(option('--output', ''));
  assert.ok(args.includes('--output') && args.includes('--runtime') && args.includes('--credentials'), 'Provide --output, --runtime, --credentials');
  const runtime = resolve(option('--runtime'));
  const credentials = resolve(option('--credentials'));
  const engine = resolve(option('--engine', process.execPath));
  for (const path of [join(runtime, 'package.json'), credentials, engine]) await stat(path);
  assert.ok(!output.startsWith(repository + '/') && !output.startsWith(repository + '\\'), 'Keep raw results outside the repository');
  await mkdir(output, { recursive: false });
  await mkdir(join(output, 'runs'));
  const repetitions = Number(option('--repetitions', 2));
  assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 10);
  const suite = option('--suite', 'basic');
  assert.ok(['basic', 'hard', 'all'].includes(suite), '--suite is basic, hard, or all');
  if (args.includes('--cases')) assert.ok(typeof option('--cases') === 'string' && option('--cases').length, '--cases requires a comma-separated list');
  const requestedCases = option('--cases')?.split(',').map(id => id.trim());
  if (requestedCases) assert.ok(requestedCases.length && requestedCases.every(Boolean) && new Set(requestedCases).size === requestedCases.length && requestedCases.every(id => cases.some(task => task.id === id)), '--cases must list unique known case IDs');
  const selectedCases = requestedCases ? requestedCases.map(id => cases.find(task => task.id === id)) :
    cases.filter(task => suite === 'all' || (task.difficulty === 'hard') === (suite === 'hard'));
  const baselineRepository = args.includes('--baseline-repository') ? resolve(option('--baseline-repository')) : undefined;
  const arms = baselineRepository ? ['single', 'moa-baseline', 'moa'] : ['single', 'moa'];
  const maxRequests = Number(option('--max-requests', 64));
  const maxTotalTokens = Number(option('--max-total-tokens', 500000));
  assert.ok(Number.isSafeInteger(maxRequests) && maxRequests > 0 && Number.isSafeInteger(maxTotalTokens) && maxTotalTokens > 0, 'Budgets must be positive safe integers');
  const runs = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    // Reverse the task order and each task's arm order on the second repetition.
    const ordered = repetition % 2 ? selectedCases : [...selectedCases].reverse();
    for (let index = 0; index < ordered.length; index++) {
      const task = ordered[index];
      const rotation = selectedCases.findIndex(item => item.id === task.id) % arms.length;
      const rotatedArms = [...arms.slice(rotation), ...arms.slice(0, rotation)];
      const orderedArms = repetition % 2 ? rotatedArms : rotatedArms.reverse();
      for (const arm of orderedArms) runs.push({ id: `${String(runs.length + 1).padStart(2, '0')}-${task.id}-${repetition}-${arm}`, caseId: task.id, repetition, arm });
    }
  }
  const manifest = { version: 1, preparedAt: new Date().toISOString(), suite: requestedCases ? 'selected' : suite, arms, repetitions, concurrency: arms.length,
    model: { provider: option('--provider', 'deepseek-official'), model: option('--model', 'deepseek-flash'), reasoningEffort: option('--reasoning', 'high') },
    limits: { maxRequests, maxTotalTokens },
    candidate: await describeBuild(repository),
    ...(baselineRepository ? { baseline: await describeBuild(baselineRepository) } : {}),
    sources: await fingerprints(),
    cases: selectedCases.map(task => ({ id: task.id, title: task.title, category: task.category, difficulty: task.difficulty ?? 'basic', prompt: task.prompt,
      timeoutSeconds: task.timeoutSeconds, inputSha256: hash(JSON.stringify(task.files)) })),
    local: { repository, ...(baselineRepository ? { baselineRepository } : {}), runtime, credentials, engine }, runs };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ prepared: true, plan: join(output, 'manifest.json'), cases: selectedCases.length, runs: runs.length, modelStarted: false }));
}

async function dispatch(manifest, entry, bootOnly = false) {
  await verifyBuilds(manifest);
  const directory = join(dirname(planPath), 'runs', entry.id);
  const task = cases.find(task => task.id === entry.caseId);
  const child = spawn(manifest.local.engine, [join(here, 'run-case.mjs'), planPath, entry.id, ...(bootOnly ? ['--boot-only'] : [])],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', forced = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => {
    forced = true;
    if (process.platform === 'win32' && child.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); }
      catch { child.kill(); }
    } else child.kill();
  }, (bootOnly ? 60 : task.timeoutSeconds + 60) * 1000);
  const exitCode = await new Promise((fulfill, reject) => { child.once('error', reject); child.once('close', fulfill); });
  clearTimeout(timer);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'stdout.log'), stdout);
  await writeFile(join(directory, 'stderr.log'), stderr);
  let result;
  try { result = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')); }
  catch (error) {
    result = { ...entry, completed: false, validControl: false, stopReason: forced ? 'runner-cleanup-timeout' : 'runner-failed',
      responseElapsedMs: null, finalReply: '', errors: [{ message: error.message }],
      modelRequestCount: null, usage: { totalTokens: null, missingUsageRequests: 1 }, agents: [] };
  }
  result.processExitCode = exitCode;
  result.forced = forced;
  if (bootOnly) return result;
  let grade;
  try { grade = await task.grade({ project: join(directory, 'project'), finalReply: result.finalReply ?? '' }); }
  catch (error) { grade = { score: 0, checks: [{ name: 'grader', passed: false, detail: String(error.message).slice(0, 500) }] }; }
  assert.ok(Number.isFinite(grade.score) && grade.score >= 0 && grade.score <= 100);
  if (task.category === 'analysis') {
    const changed = [];
    for (const [name, expected] of Object.entries(task.files)) {
      try { if (await readFile(join(directory, 'project', name), 'utf8') !== expected) changed.push(name); }
      catch { changed.push(name); }
    }
    grade.checks.push({ name: 'input-files-preserved', passed: changed.length === 0, ...(changed.length ? { detail: changed.join(', ') } : {}) });
    if (changed.length) { grade.scoreBeforeInputViolation = grade.score; grade.score = 0; }
  }
  const scored = { ...result, category: task.category, title: task.title, grade };
  await writeFile(join(directory, 'scored.json'), JSON.stringify(scored, null, 2));
  console.log(JSON.stringify({ id: entry.id, score: grade.score, completed: result.completed,
    seconds: Math.round(result.responseElapsedMs / 1000), requests: result.modelRequestCount,
    tokens: result.usage?.totalTokens, agents: result.agents.length, stopReason: result.stopReason }));
  return scored;
}

async function execute() {
  const manifest = JSON.parse(await readFile(planPath, 'utf8'));
  assert.deepEqual(await fingerprints(), manifest.sources, 'Evaluation source must match the frozen plan');
  await verifyBuilds(manifest);
  if (args.includes('--boot-check')) {
    // Preflight uses dedicated plan entries and no model calls; retain its evidence.
    for (const arm of manifest.arms ?? ['single', 'moa']) {
      await verifyBuilds(manifest);
      const entry = { id: `preflight-${arm}`, caseId: manifest.cases[0].id, repetition: 0, arm };
      const temporary = { ...manifest, runs: [...manifest.runs, entry] };
      const preflightPath = join(dirname(planPath), `preflight-${arm}.json`);
      await writeFile(preflightPath, JSON.stringify(temporary, null, 2));
      // dispatch child always reads planPath; preflight entries are supplied through a separate CLI process.
      const command = [join(here, 'run-case.mjs'), preflightPath, entry.id, '--boot-only'];
      const stdout = execFileSync(manifest.local.engine, command, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 60000 });
      const result = JSON.parse(await readFile(join(dirname(planPath), 'runs', entry.id, 'result.json'), 'utf8'));
      assert.ok(result.bootOnly && !result.stopReason && result.validControl && result.modelRequestCount === 0, `${arm} preflight failed: ${stdout.slice(-1000)}`);
      console.log(JSON.stringify({ preflight: arm, tools: result.visibleToolNames, modelStarted: false }));
    }
    return;
  }
  const batchSize = manifest.arms?.length ?? manifest.concurrency;
  for (let offset = 0; offset < manifest.runs.length; offset += batchSize) {
    await Promise.all(manifest.runs.slice(offset, offset + batchSize).map(async entry => {
      const scoredPath = join(dirname(planPath), 'runs', entry.id, 'scored.json');
      try { await stat(scoredPath); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      // A failed run is evidence: never silently recreate its directory or retry until pass.
      await dispatch(manifest, entry);
    }));
    await makeReport(planPath);
  }
  const report = await makeReport(planPath);
  console.log(JSON.stringify({ finished: report.finishedRuns, planned: report.plannedRuns, wins: report.qualityWins,
    ties: report.qualityTies, losses: report.qualityLosses, report: join(dirname(planPath), 'report.md') }));
}

if (args.includes('--prepare')) await prepare();
else if (args.includes('--run') || args.includes('--boot-check')) await execute();
else if (args.includes('--report')) await makeReport(planPath);
else console.log('See README.md. Use --prepare --output ... --runtime ... --credentials ... --engine ..., then --boot-check --plan ..., then --run --plan ...');
