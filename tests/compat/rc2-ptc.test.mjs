import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

if (!process.env.MOA_COMPAT_MODULES) throw new Error('Set MOA_COMPAT_MODULES to the prepared DSH runtime node_modules');
const require = createRequire(pathToFileURL(resolve(process.env.MOA_COMPAT_MODULES, '../package.json')));
const { PtcExecutor } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tool-executor-ptc')));
const { defineTool } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')));
const tool = (name, nativeOnly = false) => defineTool({ name, description: name, parameters: {}, nativeOnly, output: { schema: { type: 'string' } }, execute: async () => 'ok' });

test('PTC advertises direct-only tools, excludes SDK bindings, and enforces both invocation routes', () => {
  const direct = tool('moa_message', true), ordinary = tool('read_file');
  const definitions = [direct, ordinary];
  const tools = { executable: name => definitions.find(definition => definition.name === name), schemas: () => [], get: name => definitions.find(definition => definition.name === name) };
  const ctx = { tools, systemPrompt: { getSectionOrder: () => 1 }, get: name => name === 'ptcRuntime' ? { language: 'typescript', programFormat: 'function-body' } : undefined };
  const executor = new PtcExecutor(ctx);
  executor.ptcTransport = tool('run_code');
  assert.deepEqual(executor.describe(definitions).schemas.map(schema => schema.name), ['run_code', 'moa_message']);
  assert.deepEqual(executor.describe(definitions).knownNames, ['run_code', 'moa_message']);
  const sdk = executor.renderSdk(definitions);
  assert.match(sdk, /read_file/);
  assert.doesNotMatch(sdk, /moa_message/);
  assert.equal(executor.pipeline.resolveExecution('moa_message', undefined, false), direct);
  assert.equal(executor.pipeline.resolveExecution('moa_message', undefined, true), undefined);
  assert.equal(executor.pipeline.resolveExecution('read_file', undefined, false), undefined);
  assert.equal(executor.pipeline.resolveExecution('read_file', undefined, true), ordinary);
});
