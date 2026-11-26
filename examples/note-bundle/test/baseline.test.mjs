import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runCli } from '../scripts/run-cli.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const noteDirectory = join(root, 'test', 'fixtures', 'notes');
const expected = ['10-pears.md', '20-apples.md', '30-bananas.md']
  .map((name) => readFileSync(join(noteDirectory, name), 'utf8').trim())
  .join('\n\n---\n\n') + '\n';

test('default output follows filename order and keeps note content', () => {
  const result = runCli(noteDirectory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test('--output creates the destination directory and writes the bundle', () => {
  const scratch = mkdtempSync(join(root, '.test-'));
  try {
    const destination = join(scratch, 'nested', 'bundle.md');
    const result = runCli(noteDirectory, '--output', destination);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(destination, 'utf8'), expected);
    assert.match(result.stdout, /^Wrote 3 notes to /);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('unknown options report a failure', () => {
  const result = runCli(noteDirectory, '--bogus');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option: --bogus/);
});
