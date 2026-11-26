import { spawnSync } from 'node:child_process';
import { existsSync, globSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = resolve(import.meta.dirname, '..');
const patterns = ['test/*.test.mjs', ...process.argv.slice(2)];
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.platform !== 'win32') {
  run(['--test', ...patterns]);
} else {
  // DSH Windows supports inherited stdio for the independent test processes.
  const files = new Set();
  for (const pattern of patterns) {
    if (pattern.startsWith('-')) throw new Error(`Expected a test file or glob, got ${pattern}`);
    const path = resolve(cwd, pattern);
    const matches = existsSync(path) ? [path] : globSync(pattern.replaceAll('\\', '/'), { cwd });
    const paths = matches.map(name => resolve(cwd, name)).filter(name => statSync(name).isFile()).sort();
    if (!paths.length) throw new Error(`No test files match ${pattern}`);
    for (const file of paths) files.add(file);
  }
  for (const file of files) run([file]);
}
