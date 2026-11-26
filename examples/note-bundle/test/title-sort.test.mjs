import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runCli } from '../scripts/run-cli.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('--sort title orders headings A to Z, ignoring case', () => {
  const notes = join(root, 'test', 'fixtures', 'notes');
  const result = runCli(notes, '--sort', 'title');
  assert.equal(result.status, 0, result.stderr.trim());
  assert.deepEqual(
    [...result.stdout.matchAll(/^# (.+)$/gm)].map((match) => match[1]),
    ['apples', 'Bananas', 'Pears'],
  );
});
