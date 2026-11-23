import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyPatch, reversePatch, parsePatch } from 'diff';
import { repository, loadJobOutput, sha256 } from './fixtures/job-output.mjs';

const targets = [{ name: 'SDK', modules: resolve(repository, 'node_modules') }];
if (process.env.MOA_COMPAT_MODULES && resolve(process.env.MOA_COMPAT_MODULES) !== targets[0].modules)
  targets.push({ name: 'prepared runtime', modules: resolve(process.env.MOA_COMPAT_MODULES) });

for (const target of targets) test(`${target.name}: stock, previous patched and final job-output bytes pass exact helper preflight`, async () => {
  const implementation = await loadJobOutput(target.modules);
  const directory = await mkdtemp(join(tmpdir(), 'job-output-manifest-'));
  try {
    const profile = join(repository, 'compat', implementation.profile);
    const manifest = JSON.parse(await readFile(join(profile, 'manifest.json'), 'utf8'));
    const entries = manifest.filter(entry => entry.package === '@deepseek-ai/dsh-tool-jobs');
    assert.equal(entries.length, 2);
    const [stock, upgrade] = entries;
    assert.deepEqual(stock.runtimeFingerprint, upgrade.runtimeFingerprint);
    assert.deepEqual(stock.files.map(file => file.file), ['lib/index.js']);
    assert.equal(stock.files[0].after, upgrade.files[0].after);
    const stockPatch = (await readFile(join(profile, stock.runtimePatch), 'utf8')).replaceAll('\r\n', '\n');
    assert.equal(await readFile(join(profile, stock.patch), 'utf8'), await readFile(join(profile, stock.runtimePatch), 'utf8'));
    const upgradePatch = (await readFile(join(profile, upgrade.runtimePatch), 'utf8')).replaceAll('\r\n', '\n');
    const original = applyPatch(implementation.source, reversePatch(parsePatch(stockPatch)[0]));
    const previous = applyPatch(implementation.source, reversePatch(parsePatch(upgradePatch)[0]));
    assert.equal(sha256(original), stock.files[0].before);
    assert.equal(sha256(previous), upgrade.files[0].before);
    assert.equal(applyPatch(original, stockPatch), implementation.source);
    assert.equal(applyPatch(previous, upgradePatch), implementation.source);
    const checkout = join(directory, 'helper');
    const fixtureProfile = join(checkout, 'compat', implementation.profile);
    await mkdir(join(checkout, 'scripts'), { recursive: true });
    await mkdir(fixtureProfile, { recursive: true });
    await copyFile(join(repository, 'scripts/apply-native-compat.mjs'), join(checkout, 'scripts/apply-native-compat.mjs'));
    // Exercise the actual helper with these real, versioned package entries.
    // Other packages' whole-profile admission is covered by native-compat.spec.
    const agentEntry = { package: '@deepseek-ai/dsh-agent', version: stock.version,
      variant: 'fixture-profile-selector', patch: 'unused.patch', runtimePatch: 'unused.patch', files: [] };
    await writeFile(join(fixtureProfile, 'manifest.json'), JSON.stringify([agentEntry, ...entries]));
    for (const file of new Set(entries.flatMap(entry => [entry.patch, entry.runtimePatch])))
      await copyFile(join(profile, file), join(fixtureProfile, file));
    for (const [state, source] of [['stock', original], ['previous', previous], ['final', implementation.source]]) {
      const modules = join(directory, state, 'node_modules');
      const packageRoot = join(modules, stock.package);
      await mkdir(join(packageRoot, 'lib'), { recursive: true });
      await mkdir(join(modules, agentEntry.package), { recursive: true });
      await writeFile(join(modules, agentEntry.package, 'package.json'), JSON.stringify({ version: stock.version }));
      await copyFile(join(target.modules, stock.package, 'package.json'), join(packageRoot, 'package.json'));
      await writeFile(join(packageRoot, 'lib/index.js'), source);
      const backup = join(directory, state, 'backup');
      const args = [join(checkout, 'scripts/apply-native-compat.mjs'), '--modules', modules, '--backup', backup];
      const preflight = execFileSync(process.execPath, [...args, '--dry-run'], { encoding: 'utf8' });
      assert.match(preflight, /Preflight passed/);
      assert.equal(await readFile(join(packageRoot, 'lib/index.js'), 'utf8'), source);
      // SDK and runtime-only use the same JS contract; exercise both modes.
      execFileSync(process.execPath, [...args, ...(state === 'previous' ? ['--runtime-only'] : [])], { stdio: 'pipe' });
      assert.equal(sha256(await readFile(join(packageRoot, 'lib/index.js'))), stock.files[0].after);
      execFileSync(process.execPath, args, { stdio: 'pipe' });
      if (state !== 'final') assert.equal(await readFile(join(backup, stock.package, 'lib/index.js'), 'utf8'), source);
    }
  } finally { await implementation.dispose(); await rm(directory, { recursive: true, force: true }); }
});
