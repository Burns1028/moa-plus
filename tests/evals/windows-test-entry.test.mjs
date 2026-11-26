import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { codeCases } from '../../evals/moa-vs-single/cases-code.mjs';
import { npmInvocation } from '../../scripts/moa.mjs';

const modules = process.env.MOA_COMPAT_MODULES;
const options = { skip: process.platform !== 'win32' || !modules };

async function runStarter(t, expected, prepare, args = []) {
  const root = await mkdtemp(join(tmpdir(), 'moa-test-entry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project);
  await prepare(project);
  const runner = resolve(modules, '@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js');
  const node = process.versions.electron
    ? execFileSync('where.exe', ['node'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    : process.execPath;
  const npm = npmInvocation(['test', '--', ...args], { execPath: node });
  const env = { ...process.env, npm_config_cache: join(project, '.npm-cache') };
  // Run the package in its own test session, with its actual default flags.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [
    runner, '--workspace', project, '--temp', root, '--mode', 'workspace-write',
    '--', npm.command, ...npm.args,
  ], { cwd: project, env, encoding: 'utf8', timeout: 30000 });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 1, output);
  assert.doesNotMatch(output, /spawn EPERM/);
  // Note Bundle reports once per test file. Node's TAP and spec reporters
  // use the same counter names after their line prefix.
  const counts = { pass: 0, fail: 0 };
  for (const [, name, value] of output.matchAll(/^(?:#|ℹ) (pass|fail) (\d+)\r?$/gm)) {
    counts[name] += Number(value);
  }
  assert.deepEqual(counts, expected, output);
  return output;
}

test('Note Bundle reaches its one intentional feature failure under the Windows sandbox', options, async t => {
  const output = await runStarter(t, { pass: 3, fail: 1 }, project =>
    cp(new URL('../../examples/note-bundle/', import.meta.url), project, { recursive: true }));
  assert.match(output, /Unknown option: --sort/);
});

test('generated CSV starter reports real assertion failures under the Windows sandbox', options, async t => {
  const csv = codeCases.find(task => task.id === 'code-csv-boundaries');
  const output = await runStarter(t, { pass: 1, fail: 2 }, async project => {
    for (const [file, content] of Object.entries(csv.files)) {
      const path = join(project, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
  });
  assert.match(output, /ERR_ASSERTION/);
});

test('a failing extra test glob makes an otherwise green npm test fail', options, async t => {
  const output = await runStarter(t, { pass: 1, fail: 1 }, async project => {
    const example = new URL('../../examples/note-bundle/', import.meta.url);
    await cp(new URL('package.json', example), join(project, 'package.json'));
    await cp(new URL('scripts/', example), join(project, 'scripts'), { recursive: true });
    await mkdir(join(project, 'test'));
    await mkdir(join(project, 'extra tests'));
    await writeFile(join(project, 'test', 'baseline.test.mjs'), "import test from 'node:test'; test('baseline', () => {});");
    await writeFile(join(project, 'extra tests', 'broken.mjs'), "import test from 'node:test'; test('additional case', () => { throw Error('extra file executed'); });");
  }, ['extra tests/*.mjs']);
  assert.match(output, /extra file executed/);
});
