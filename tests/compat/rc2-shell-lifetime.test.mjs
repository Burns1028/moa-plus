import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// These consumer tests use the real native subprocess range. The controlled
// provider supplies a lease and executable argv; Windows ACL enforcement is
// independently covered by the native protected-record provider tests.
const modules = process.env.MOA_COMPAT_MODULES;
// Running the suite in Desktop's Electron must not launch another desktop UI.
const targetNode = process.versions.electron
  ? execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
  : process.execPath;
const load = name => import(pathToFileURL(resolve(modules, '@deepseek-ai', name, 'lib/index.js')));
const options = { skip: !modules, timeout: 15000 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => {
  for (let i = 0; i < 600; i++) {
    if (await predicate()) return;
    await pause(5);
  }
  assert.fail('native shell lifecycle observation did not arrive');
};
const exists = async path => readFile(path).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});

async function fixture(kind, prepare) {
  const [{ Context }, { default: Subprocess }, { default: Executor }] = await Promise.all([
    load('cordis'), load('dsh-subprocess-local'), load(`dsh-${kind}-sandbox`),
  ]);
  const root = await mkdtemp(join(tmpdir(), 'moa-rc2-shell-lifetime-'));
  const ctx = new Context();
  const policy = { mode: 'workspace-write', workspaceRoot: root, additionalWritableRoots: [], readOnlyPaths: [join(root, 'notes.md')] };
  const calls = [];
  ctx.provide('sandboxPolicy', { defaultMode: policy.mode, resolve: () => policy });
  ctx.provide('sandbox', { supportsReadOnlyPaths: true, confine: async (argv, actualPolicy, signal, contract) => {
    assert.deepEqual(actualPolicy, policy);
    assert.deepEqual(contract, { processLifetime: 'managed' });
    const call = { argv, signal };
    calls.push(call);
    const prepared = await prepare({ argv, signal, root });
    if (!prepared.cleanup) return prepared;
    return { ...prepared, bindProcessLifetime(lifetime) {
      assert.equal(call.lifetime, undefined, 'handoff binds one lifetime per lease');
      call.lifetime = lifetime;
      prepared.bindProcessLifetime?.(lifetime);
    } };
  } });
  await ctx.plugin(Subprocess);
  const nativeSpawn = ctx.subprocess.spawn.bind(ctx.subprocess);
  ctx.subprocess.spawn = spec => {
    if (spec.requireManagedRange) assert.ok(calls.at(-1)?.lifetime instanceof Promise, 'lifetime must bind before actual admission');
    return nativeSpawn(spec);
  };
  const executor = ctx.plugin(Executor, { cwd: root, graceMs: 50 });
  await executor;
  return { root, ctx, calls, policy, executor,
    execute: request => ctx.shell.execute(ctx.shell.resolve({ command: 'native consumer test', ...request, sandboxPolicy: policy })),
    async dispose() { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); },
  };
}

test('rc2 real protected PowerShell and native atomic publication retain record ownership through background composition teardown', {
  skip: !modules || process.platform !== 'win32', timeout: 20000,
}, async () => {
  const [{ Context }, { default: LocalFs }, { default: Subprocess }, { default: Sandbox }, { default: Shell }] = await Promise.all([
    load('cordis'), load('dsh-fs-local'), load('dsh-subprocess-local'), load('dsh-sandbox-local'), load('dsh-pwsh-sandbox'),
  ]);
  const root = await mkdtemp(join(tmpdir(), 'moa-native-protected-composition-'));
  const paths = [join(root, 'notes.md'), join(root, 'archived.md')];
  const ctx = new Context(), errors = [];
  ctx.logger.error = (...args) => errors.push(args.map(String).join(' '));
  let proc, fs, sandbox;
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  try {
    await ctx.plugin(LocalFs, { cwd: root }); fs = ctx.fs;
    for (const path of paths) await fs.writeText(await fs.resolve(path), 'ORIGINAL');
    await ctx.plugin(Sandbox); sandbox = ctx.sandbox;
    await ctx.plugin(Subprocess);
    const policy = { mode: 'workspace-write', workspaceRoot: root, sessionId: 'owned-composition-test', readOnlyPaths: paths, additionalWritableRoots: [] };
    ctx.provide('sandboxPolicy', { defaultMode: policy.mode, resolve: () => policy });
    await ctx.plugin(Shell, { cwd: root, graceMs: 50 });
    const sibling = join(root, 'sibling.txt'), trigger = join(root, 'host-published'), result = join(root, 'worker-result.txt');
    const command = `$ErrorActionPreference='Stop'; Set-Content -LiteralPath ${quote(sibling)} -Value 'SIBLING'; while(!(Test-Path -LiteralPath ${quote(trigger)})){Start-Sleep -Milliseconds 10}; $before=Get-Content -LiteralPath ${quote(paths[0])} -Raw; $denied=$false; try{Set-Content -LiteralPath ${quote(paths[0])} -Value 'BAD'}catch{$denied=$true}; Set-Content -LiteralPath ${quote(result)} -Value ($before.Trim()+':'+$denied); while($true){Start-Sleep -Milliseconds 100}`;
    proc = await ctx.shell.execute(ctx.shell.resolve({ command, onExpiry: 'none', sandboxPolicy: policy }));
    await until(() => exists(sibling));
    assert.equal(fs.processPathProtections.size, 2);
    assert.equal(sandbox.activeProtectionLeases.size, 1);
    await fs.writeText(await fs.resolve(paths[0]), 'HOST');
    await fs.writeText(await fs.resolve(trigger), 'ready');
    await until(() => exists(result));
    assert.equal((await readFile(result, 'utf8')).trim(), 'HOST:True');
    assert.equal(await readFile(paths[0], 'utf8'), 'HOST');
    assert.equal(await readFile(paths[1], 'utf8'), 'ORIGINAL');
    await ctx.fiber.dispose();
    assert.equal(await proc.managed.waitForExit(), true);
    assert.equal(fs.processPathProtections.size, 0);
    assert.equal(sandbox.activeProtectionLeases.size, 0);
    assert.deepEqual(errors, []);
  } finally {
    proc?.managed.terminate();
    if (proc) await proc.managed.waitForExit();
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
function confined(argv, cleanup) {
  return { argv, enforcement: 'partial', denialSignatures: [], runnerFailureRules: [], cleanup };
}

for (const kind of ['bash', 'pwsh']) {
  test(`rc2 ${kind} confinement lease survives direct exit until the real descendant range is empty`, options, async () => {
    let releases = 0;
    const f = await fixture(kind, ({ root }) => {
      const marker = join(root, 'descendant-finished');
      const started = join(root, 'descendant-started');
      const child = `require('node:fs').writeFileSync(${JSON.stringify(started)}, String(process.pid)); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'done'), 500)`;
      // Node's own Windows child Job kills non-detached children on exit;
      // detached skips that inner Job while retaining the native outer Job.
      const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], {stdio:'ignore',detached:true}).unref(); const timer=setInterval(() => { if(require('node:fs').existsSync(${JSON.stringify(started)})) clearInterval(timer); }, 5);`;
      return confined([targetNode, '-e', parent], async () => { releases++; assert.equal(await exists(marker), true); });
    });
    try {
      const proc = await f.execute({ onExpiry: 'none' });
      assert.equal((await proc.result()).exitCode, 0);
      assert.equal(releases, 0);
      assert.equal(await exists(join(f.root, 'descendant-finished')), false);
      assert.equal(await proc.managed.waitForExit(), true);
      assert.equal(releases, 1);
      assert.equal(await proc.managed.waitForExit(), true);
      assert.equal(releases, 1);
    } finally { await f.dispose(); }
  });

  test(`rc2 ${kind} background confinement is released without reading its result`, options, async () => {
    let releases = 0;
    const f = await fixture(kind, () => confined([targetNode, '-e', 'setTimeout(() => {}, 30)'], async () => { releases++; }));
    try {
      const proc = await f.execute({ onExpiry: 'none' });
      await until(() => releases === 1);
      assert.equal(proc.exitCode, 0);
      assert.equal(await proc.managed.waitForExit(), true);
      assert.equal(releases, 1);
    } finally { await f.dispose(); }
  });

  test(`rc2 ${kind} preparation timeout joins the late lease through its virtual handle`, options, async () => {
    const preparation = Promise.withResolvers(), release = Promise.withResolvers();
    let releases = 0, joined = false;
    const f = await fixture(kind, async () => {
      await preparation.promise;
      return confined([targetNode, '-e', 'throw new Error("must not spawn")'], async () => { releases++; await release.promise; });
    });
    try {
      const proc = await f.execute({ timeoutMs: 10 });
      assert.equal((await proc.result()).timedOut, true);
      const joining = proc.managed.waitForExit().then(() => { joined = true; });
      await pause(10); assert.equal(joined, false); assert.equal(releases, 0);
      preparation.resolve(); await until(() => releases === 1);
      assert.equal(joined, false);
      release.resolve(); await joining;
      assert.equal(releases, 1); assert.equal(f.calls.length, 1);
    } finally { preparation.resolve(); release.resolve(); await f.dispose(); }
  });

  test(`rc2 ${kind} cancellation before admission joins late cleanup and retains the native abort`, options, async () => {
    const preparation = Promise.withResolvers(), release = Promise.withResolvers();
    const controller = new AbortController(), reason = new Error('caller cancellation');
    let releases = 0, settled = false;
    const f = await fixture(kind, async () => {
      await preparation.promise;
      return confined([targetNode, '-e', 'throw new Error("must not spawn")'], async () => { releases++; await release.promise; });
    });
    try {
      const execution = f.execute({ signal: controller.signal, onExpiry: 'none' });
      const rejection = assert.rejects(execution, error => error === reason).then(() => { settled = true; });
      await until(() => f.calls.length === 1); controller.abort(reason);
      await pause(10); assert.equal(settled, false);
      preparation.resolve(); await until(() => releases === 1);
      assert.equal(settled, false);
      release.resolve(); await rejection;
      assert.equal(releases, 1);
    } finally { preparation.resolve(); release.resolve(); await f.dispose(); }
  });

  test(`rc2 ${kind} cleanup failure remains a rejected native join after spawn failure`, options, async () => {
    const failure = new Error('lease cleanup failed');
    let releases = 0;
    const f = await fixture(kind, ({ root }) => confined([join(root, 'missing-runner.exe')], async () => { releases++; throw failure; }));
    try {
      const proc = await f.execute({ onExpiry: 'none' });
      await assert.rejects(proc.result(), { code: 'SANDBOX_UNAVAILABLE' });
      await assert.rejects(proc.managed.waitForExit(), error => error === failure);
      await assert.rejects(proc.managed.waitForExit(), error => error === failure);
      await assert.rejects(f.calls[0].lifetime, error => error === failure);
      assert.equal(releases, 1);
    } finally { await f.dispose(); }
  });

  test(`rc2 ${kind} cancelled managed wait does not release a live range`, options, async () => {
    let releases = 0;
    const f = await fixture(kind, () => confined([targetNode, '-e', 'setInterval(() => {}, 100)'], async () => { releases++; }));
    try {
      const proc = await f.execute({ onExpiry: 'none' });
      const controller = new AbortController(); controller.abort();
      assert.equal(await proc.managed.waitForExit(controller.signal), false);
      assert.equal(releases, 0);
      proc.managed.terminate();
      assert.equal(await proc.managed.waitForExit(), true);
      assert.equal(releases, 1);
    } finally { await f.dispose(); }
  });

  test(`rc2 ${kind} uncertain native range exit retains its lease and rejected join`, options, async () => {
    let releases = 0, nativeWait, nativeProc;
    const failure = new Error('native managed range observation failed');
    const f = await fixture(kind, () => confined([targetNode, '-e', 'setInterval(() => {}, 100)'], async () => { releases++; }));
    const spawn = f.ctx.subprocess.spawn.bind(f.ctx.subprocess);
    // Inject an observation failure at the real provider boundary, retaining
    // its actual process and its original wait for owned fixture cleanup.
    f.ctx.subprocess.spawn = spec => {
      nativeProc = spawn(spec);
      nativeWait = nativeProc.waitForExit.bind(nativeProc);
      let first = true;
      nativeProc.waitForExit = signal => {
        if (first) { first = false; return Promise.reject(failure); }
        return nativeWait(signal);
      };
      return nativeProc;
    };
    try {
      const proc = await f.execute({ onExpiry: 'none' });
      await pause(10); assert.equal(releases, 0);
      proc.managed.terminate(); await nativeWait();
      await assert.rejects(proc.managed.waitForExit(), error => error === failure);
      await assert.rejects(proc.managed.waitForExit(), error => error === failure);
      await assert.rejects(f.calls[0].lifetime, error => error === failure);
      assert.equal(releases, 0);
    } finally {
      nativeProc?.terminate();
      if (nativeWait) await nativeWait();
      await f.dispose();
    }
  });

  test(`rc2 ${kind} executor reload preserves the native range and lease until subprocess teardown`, options, async () => {
    let releases = 0;
    const f = await fixture(kind, () => confined([targetNode, '-e', 'setInterval(() => {}, 100)'], async () => { releases++; }));
    try {
      const proc = await f.execute({ onExpiry: 'none' });
      await f.executor.dispose();
      const cancelled = new AbortController(); cancelled.abort();
      assert.equal(await proc.managed.waitForExit(cancelled.signal), false);
      assert.equal(releases, 0);
      await f.dispose();
      assert.equal(await proc.managed.waitForExit(), true);
      assert.equal(releases, 1);
    } finally { await f.dispose(); }
  });

  test(`rc2 ${kind} leased spawn refuses weak containment before target and rolls back its lease`, options, async () => {
    let releases = 0;
    const f = await fixture(kind, ({ root }) => confined([targetNode, '-e', `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'must-not-start'))}, 'unsafe')`], async () => { releases++; }));
    // Exercise the real LocalSubprocess admission branch, without pretending
    // that a process-tree fallback proves a complete managed process range.
    f.ctx.subprocess.selectContainmentMode = () => 'fallback';
    const spawn = f.ctx.subprocess.spawn.bind(f.ctx.subprocess);
    let refused;
    f.ctx.subprocess.spawn = spec => {
      assert.equal(spec.requireManagedRange, true);
      try { return spawn(spec); } catch (error) { refused = error; throw error; }
    };
    try {
      const proc = await f.execute({ onExpiry: 'none' });
      await assert.rejects(proc.result(), error => error === refused && /requires a native managed process range/.test(error.message));
      assert.equal(await proc.managed.waitForExit(), true);
      assert.equal(releases, 1);
      assert.equal(await exists(join(f.root, 'must-not-start')), false);
    } finally { await f.dispose(); }
  });

  test(`rc2 ${kind} a backend without a confinement lease preserves ordinary fallback execution`, options, async () => {
    const f = await fixture(kind, () => confined([targetNode, '-e', 'process.stdout.write("legacy backend")']));
    f.ctx.subprocess.selectContainmentMode = () => 'fallback';
    const spawn = f.ctx.subprocess.spawn.bind(f.ctx.subprocess);
    f.ctx.subprocess.spawn = spec => {
      assert.equal(spec.requireManagedRange, undefined);
      return spawn(spec);
    };
    try {
      const proc = await f.execute({ onExpiry: 'none' });
      const result = await proc.result();
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.text, 'legacy backend');
      assert.equal(await proc.managed.waitForExit(), true);
    } finally { await f.dispose(); }
  });
}
