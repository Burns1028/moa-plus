import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run against the prepared distribution, including a Desktop's runtime-only
// packages. No personal profile, conversations or model provider is used.
const modules = process.env.MOA_COMPAT_MODULES;
const options = { skip: !modules };
const load = (name) => import(pathToFileURL(join(resolve(modules), '@deepseek-ai', name, 'lib/index.js')));

async function fixture() {
  const [{ Context }, { SandboxedFileSystem }, { SandboxPolicyService }] = await Promise.all([
    load('cordis'), load('dsh-fs-sandbox'), load('dsh-sandbox-policy'),
  ]);
  const root = await mkdtemp(join(tmpdir(), 'moa-rc2-memory-'));
  const records = join(root, 'records');
  await mkdir(records);
  const notes = join(records, 'notes.md');
  const archived = join(records, 'archived.md');
  await writeFile(notes, 'NOTES');
  await writeFile(archived, 'ARCHIVED');
  const policy = {
    defaultMode: 'danger-full-access', workspaceRoot: root,
    additionalWritableRoots: [join(root, 'additional')],
    readOnlyRestrictions: new Map(), overrideOf: () => undefined,
    restrictReadOnly: SandboxPolicyService.prototype.restrictReadOnly,
    resolve: SandboxPolicyService.prototype.resolve,
  };
  const session = { id: 'worker', header: { cwd: root } };
  const ctx = new Context();
  ctx.provide('sandboxPolicy', policy);
  const fs = new SandboxedFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 });
  return { root, records, notes, archived, policy, session, fs,
    async dispose() {
      await ctx.fiber.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('rc2 scoped ownership survives mode escalation and independent disposal', options, async () => {
  const f = await fixture();
  try {
    const paths = [f.notes, f.archived];
    const off = f.policy.restrictReadOnly(f.session.id, paths);
    const other = f.policy.restrictReadOnly(f.session.id, [f.notes]);
    paths.length = 0;
    const snapshot = f.policy.resolve({ session: f.session });
    assert.deepEqual(snapshot.readOnlyPaths, [f.notes, f.archived]);
    assert.deepEqual(snapshot.additionalWritableRoots, [join(f.root, 'additional')]);
    assert.deepEqual(f.policy.resolve({ session: f.session, mode: 'workspace-write' }).readOnlyPaths, snapshot.readOnlyPaths);
    assert.equal(f.policy.resolve({ session: { id: 'coordinator', header: { cwd: f.root } } }).readOnlyPaths, undefined);
    off(); off();
    assert.deepEqual(f.policy.resolve({ session: f.session }).readOnlyPaths, [f.notes]);
    other();
    assert.equal(f.policy.resolve({ session: f.session }).readOnlyPaths, undefined);
    assert.deepEqual(snapshot.readOnlyPaths, [f.notes, f.archived]);
    assert.throws(() => f.policy.restrictReadOnly('worker', ['relative.md']), /absolute/);
    assert.throws(() => f.policy.restrictReadOnly('worker', [f.notes + '\0']), /NUL/);
  } finally { await f.dispose(); }
});

test('rc2 filesystem fences write/edit/patch/delete/move and aliases before full-access', options, async () => {
  const f = await fixture();
  try {
    const off = f.policy.restrictReadOnly(f.session.id, [f.notes, f.archived]);
    const policy = f.policy.resolve({ session: f.session });
    const signal = new AbortController().signal;
    const notes = await f.fs.resolve(f.notes);
    const sibling = await f.fs.resolve(join(f.root, 'output.md'));
    await f.fs.writeText(sibling, 'OUTPUT', undefined, signal, policy);
    const denied = { code: 'FS_READ_ONLY_PATH' };
    await assert.rejects(f.fs.writeText(notes, 'bad', undefined, signal, policy), denied);
    await assert.rejects(f.fs.editText(notes, { oldString: 'NOTES', newString: 'bad' }, undefined, signal, policy), denied);
    await assert.rejects(f.fs.patchText(notes, [], undefined, signal, policy), denied);
    await assert.rejects(f.fs.deleteFile(notes, undefined, signal, policy), denied);
    await assert.rejects(f.fs.moveFile(notes, sibling, {}, signal, policy), denied);
    await assert.rejects(f.fs.moveFile(sibling, notes, {}, signal, policy), denied);
    await assert.rejects(f.fs.checkedTarget(await f.fs.resolve(f.records), policy), denied);
    const aliasPath = join(f.root, 'notes-alias.md');
    await link(f.notes, aliasPath);
    await assert.rejects(f.fs.writeText(await f.fs.resolve(aliasPath), 'bad', undefined, signal, policy), denied);
    assert.equal(await readFile(f.notes, 'utf8'), 'NOTES');
    assert.equal(await readFile(f.archived, 'utf8'), 'ARCHIVED');
    assert.equal(await readFile(join(f.root, 'output.md'), 'utf8'), 'OUTPUT');
    // Coordinator atomic publication remains allowed; the Worker's path fence
    // also protects the newly published file object on its next call.
    await f.fs.writeText(notes, 'COORDINATOR', undefined, signal, f.policy.resolve());
    await assert.rejects(f.fs.writeText(await f.fs.resolve(f.notes), 'bad', undefined, signal, policy), denied);
    assert.equal(await readFile(f.notes, 'utf8'), 'COORDINATOR');
    const missing = join(f.root, 'future-record.md');
    const missingOff = f.policy.restrictReadOnly(f.session.id, [missing]);
    await assert.rejects(f.fs.writeText(await f.fs.resolve(missing), 'bad', undefined, signal, f.policy.resolve({ session: f.session })), denied);
    missingOff(); off();
    await f.fs.writeText(await f.fs.resolve(f.notes), 'RELEASED', undefined, signal, f.policy.resolve({ session: f.session }));
    assert.equal(await readFile(f.notes, 'utf8'), 'RELEASED');
  } finally { await f.dispose(); }
});

test('rc2 filesystem ownership error remains a native wire error code', options, async () => {
  const { FS_ERROR_CODES } = await load('dsh-fs');
  assert.ok(FS_ERROR_CODES.includes('FS_READ_ONLY_PATH'));
});

test('rc2 Bash and PowerShell refuse unsupported record protection before native spawn', options, async () => {
  const { SandboxBashExecutor } = await load('dsh-bash-sandbox');
  const { SandboxPwshExecutor } = await load('dsh-pwsh-sandbox');
  for (const Executor of [SandboxBashExecutor, SandboxPwshExecutor]) {
    await assert.rejects(Executor.prototype.execute.call({ supportsReadOnlyPaths: undefined }, {
      sandboxPolicy: { mode: 'danger-full-access', readOnlyPaths: [resolve('notes.md')] },
    }), { code: 'READ_ONLY_PATH_UNSUPPORTED' });
  }
});

test('rc2 Windows/custom/Landlock policy refusals cannot reach runner preparation', options, async () => {
  const { LocalSandboxProvider } = await load('dsh-sandbox-local');
  for (const runner of ['windows-acl', 'landlock', 'custom']) {
    let prepared = false;
    const provider = {
      runnerCommand: runner === 'custom' ? ['custom-runner'] : undefined,
      selectRunner: () => ({ runner, enforcement: 'partial' }),
      runnerArgv: () => { prepared = true; return []; },
    };
    await assert.rejects(LocalSandboxProvider.prototype.confine.call(provider, ['should-not-run'], {
      mode: 'danger-full-access', workspaceRoot: process.cwd(), readOnlyPaths: [resolve('notes.md')],
    }), { code: 'READ_ONLY_PATH_UNSUPPORTED' });
    assert.equal(prepared, false);
  }
});

test('rc2 bwrap keeps additional writable roots and mounts records last', options, async () => {
  const f = await fixture();
  try {
    const { LocalSandboxProvider } = await load('dsh-sandbox-local');
    const root2 = join(f.root, 'additional');
    await mkdir(root2);
    const fake = {
      runnerCommand: undefined,
      selectRunner: () => ({ runner: 'bwrap', enforcement: 'full' }),
      runnerArgv: LocalSandboxProvider.prototype.runnerArgv,
    };
    const result = await LocalSandboxProvider.prototype.confine.call(fake, ['native-command'], {
      mode: 'workspace-write', workspaceRoot: f.root,
      additionalWritableRoots: [root2], readOnlyPaths: [f.notes],
    });
    const grants = result.argv;
    assert.ok(grants.some((arg, index) => arg === '--bind' && grants[index + 1] === root2 && grants[index + 2] === root2));
    assert.deepEqual(grants.slice(-5), ['--ro-bind', f.notes, f.notes, '--', 'native-command']);
  } finally { await f.dispose(); }
});
