import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Capture the real CLI's two streams without creating named pipes.
export function runCli(...args) {
  const dir = mkdtempSync(join(tmpdir(), 'note-bundle-cli-'));
  const outPath = join(dir, 'stdout');
  const errPath = join(dir, 'stderr');
  let stdout;
  let stderr;
  try {
    stdout = openSync(outPath, 'w');
    stderr = openSync(errPath, 'w');
    const result = spawnSync(process.execPath, ['note-bundle.mjs', ...args], {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['ignore', stdout, stderr],
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: readFileSync(outPath, 'utf8'),
      stderr: readFileSync(errPath, 'utf8'),
    };
  } finally {
    if (stdout !== undefined) closeSync(stdout);
    if (stderr !== undefined) closeSync(stderr);
    rmSync(dir, { recursive: true, force: true });
  }
}
