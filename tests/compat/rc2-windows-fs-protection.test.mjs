import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, readFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const modules = resolve(process.env.MOA_COMPAT_MODULES);
const native = name => import(pathToFileURL(join(modules, '@deepseek-ai', name, 'lib/index.js')).href);
const [{ Context }, { default: LocalFs }] = await Promise.all([native('cordis'), native('dsh-fs-local')]);
const delay = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'moa-native-fs-protection-'));
  const ctx = new Context(); await ctx.plugin(LocalFs, { cwd: root });
  const paths = [join(root, 'notes.md'), join(root, 'archived.md')];
  for (const path of paths) await ctx.fs.writeText(await ctx.fs.resolve(path), 'original');
  return { ctx, fs: ctx.fs, root, paths, async close() { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); } };
}
test('canonical leases share their stable native owner and keep overlapping guards until last cleanup', async () => {
 const f=await fixture(); try {
  const owners=[],cleanups=[];
  const one=await f.ctx.fs.acquireProcessPathProtection(f.paths,(paths,owner)=>{owners.push(owner);assert.deepEqual(paths,[...f.paths].sort());return ()=>cleanups.push(1);});
  const two=await f.ctx.fs.acquireProcessPathProtection([...f.paths].reverse(),async(_,owner)=>{owners.push(owner);return async()=>{cleanups.push(2);};});
  assert.equal(owners[0],owners[1]);
  const target=await f.fs.resolve(f.paths[0]);await f.fs.writeText(target,'updated');assert.equal(await f.fs.readText(target),'updated');
  await f.fs.editText(target,{oldString:'updated',newString:'edited'});
  const {parsePatch}=await native('dsh-fs-patch');const update=parsePatch('*** Begin Patch\n*** Update File: notes.md\n-edited\n+patched\n*** End Patch')[0];await f.fs.patchText(target,update.hunks);assert.equal(await f.fs.readText(target),'patched\n');
  const incoming=await f.fs.resolve(join(f.root,'incoming.md'));await f.fs.writeText(incoming,'moved-in');await f.fs.moveFile(incoming,target,{});assert.equal(await f.fs.readText(target),'moved-in');
  await assert.rejects(f.fs.deleteFile(target),error=>error.code==='FS_READ_ONLY_PATH');
  const dest=await f.fs.resolve(join(f.root,'moved.md'));await assert.rejects(f.fs.moveFile(target,dest,{}),error=>error.code==='FS_READ_ONLY_PATH');
  await one.cleanup();await one.cleanup();assert.deepEqual(cleanups,[1]);await assert.rejects(f.fs.deleteFile(target),error=>error.code==='FS_READ_ONLY_PATH');
  await two.cleanup();assert.deepEqual(cleanups,[1,2]);await f.fs.deleteFile(target);
 }finally{await f.close();}
});
test('installer, mutations and cleanup use the same native FIFO boundary',async()=>{
 const f=await fixture();try{
  const installed=Promise.withResolvers(),admit=Promise.withResolvers(),removing=Promise.withResolvers(),release=Promise.withResolvers();
  const acquiring=f.fs.acquireProcessPathProtection([f.paths[0]],async()=>{installed.resolve();await admit.promise;return async()=>{removing.resolve();await release.promise;};});
  await installed.promise;let wrote=false;const target=await f.fs.resolve(f.paths[0]);const writing=f.fs.writeText(target,'after-install').then(()=>{wrote=true;});await delay();assert.equal(wrote,false);admit.resolve();const lease=await acquiring;await writing;
  const cleanup=lease.cleanup();await removing.promise;let deleted=false;const deleting=f.fs.deleteFile(target).then(()=>{deleted=true;});await delay();assert.equal(deleted,false);release.resolve();await cleanup;await deleting;assert.equal(deleted,true);
 }finally{await f.close();}
});
test('ancestor mutation already holding its native key excludes admission until its complete async boundary',async()=>{
 const f=await fixture(),entered=Promise.withResolvers(),release=Promise.withResolvers();let admitted,mutation;
 try{
  // LocalFS currently rejects directory delete/move. Exercise its existing
  // native mutation-lock seam without introducing a new directory operation.
  mutation=f.fs.withLock(f.root,async()=>{f.fs.checkProcessProtectedRemoval(f.root);entered.resolve();await release.promise;await rm(f.paths[0]);});
  await entered.promise;let installed=false;
  admitted=f.fs.acquireProcessPathProtection([f.paths[0]],()=>{installed=true;return()=>{};}).then(lease=>({lease}),error=>({error}));
  await new Promise(resolve=>setTimeout(resolve,40));const installedBeforeMutationFinished=installed;
  release.resolve();await mutation;const outcome=await admitted;if(outcome.lease)await outcome.lease.cleanup();
  assert.equal(installedBeforeMutationFinished,false,'installer must not overlap an already-running ancestor mutation');
  assert.equal(outcome.error?.code,'FS_READ_ONLY_PATH','record removed before admission must fail closed');
 }finally{release.resolve();if(mutation)await mutation;await f.close();}
});
test('lease cleanup holds ancestor mutation keys until both ACL removal and native guards settle',async()=>{
 const f=await fixture(),removing=Promise.withResolvers(),release=Promise.withResolvers();let cleanup,mutation;
 try{
  const lease=await f.fs.acquireProcessPathProtection([f.paths[0]],()=>async()=>{removing.resolve();await release.promise;});
  cleanup=lease.cleanup();await removing.promise;let ran=false;
  mutation=f.fs.withLock(f.root,()=>{f.fs.checkProcessProtectedRemoval(f.root);ran=true;});const observed=mutation.then(()=>({ok:true}),error=>({error}));
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(ran,false);release.resolve();await cleanup;assert.deepEqual(await observed,{ok:true});
 }finally{release.resolve();if(cleanup)await cleanup;if(mutation)await mutation;await f.close();}
});
test('native owner identities are different for different filesystem providers',async()=>{
 const a=await fixture(),b=await fixture();try{let first,second;const x=await a.fs.acquireProcessPathProtection([a.paths[0]],(_,owner)=>{first=owner;return()=>{};});const y=await b.fs.acquireProcessPathProtection([b.paths[0]],(_,owner)=>{second=owner;return()=>{};});assert.notEqual(first,second);await x.cleanup();await y.cleanup();}finally{await a.close();await b.close();}
});
test('installer failure stays exact and failed cleanup keeps the active removal guard',async()=>{
 const f=await fixture();try{
  const installFailure=new Error('native installer failure');await assert.rejects(f.fs.acquireProcessPathProtection([f.paths[0]],()=>{throw installFailure;}),error=>error===installFailure);
  const failure=new Error('native cleanup failure'),target=await f.fs.resolve(f.paths[0]);const lease=await f.fs.acquireProcessPathProtection([f.paths[0]],()=>async()=>{throw failure;});await assert.rejects(lease.cleanup(),error=>error===failure);await assert.rejects(lease.cleanup(),error=>error===failure);await assert.rejects(f.fs.deleteFile(target),error=>error.code==='FS_READ_ONLY_PATH');
 }finally{await f.close();}
});
test('aborted acquisition unwinds its own installer and does not leave a guard',async()=>{
 const f=await fixture();try{const abort=new AbortController();let removed=0;await assert.rejects(f.fs.acquireProcessPathProtection([f.paths[0]],()=>{abort.abort();return()=>{removed++;};},abort.signal),error=>error.code==='FS_ABORTED');assert.equal(removed,1);await f.fs.deleteFile(await f.fs.resolve(f.paths[0]));}finally{await f.close();}
});
test('initial absent and multiply linked records cannot acquire protection',async()=>{
 const f=await fixture();try{await assert.rejects(f.fs.acquireProcessPathProtection([join(f.root,'absent.md')],()=>()=>{}));await link(f.paths[0],join(f.root,'alias.md'));await assert.rejects(f.fs.acquireProcessPathProtection([f.paths[0]],()=>()=>{}),error=>error.code==='FS_READ_ONLY_PATH');}finally{await f.close();}
});
test('protected publication never falls back to rename when the target disappears',async()=>{
 const f=await fixture();try{const target=await f.fs.resolve(f.paths[0]),lease=await f.fs.acquireProcessPathProtection([f.paths[0]],()=>()=>{});f.fs.internals.inspectTemp=async()=>{await rm(f.paths[0]);};await assert.rejects(f.fs.writeText(target,'must not recreate'));await assert.rejects(readFile(f.paths[0]),error=>error.code==='ENOENT');await lease.cleanup();}finally{await f.close();}
});
test('first-visible protected staging denies creation and same-user WRITE_DAC to a real restricted Windows child',{skip:process.platform!=='win32',timeout:20000},async()=>{
 const f=await fixture();let sandbox;
 try{
  const {AclSandbox,workspaceWriteSid}=await native('dsh-sandbox-windows-acl');sandbox=new AclSandbox({mode:'workspace-write',writableDirs:[f.root],tempDir:null,writeSid:workspaceWriteSid(f.root)});await sandbox.init();
  const koffiPath=createRequire(pathToFileURL(join(modules,'@deepseek-ai/dsh-fs-local/package.json'))).resolve('koffi');
  let checked=0;const inspect=async({stagingDir,tempPath})=>{
   const source=`const fs=require('node:fs');const koffi=require(${JSON.stringify(koffiPath)});const root=${JSON.stringify(f.root)},dir=${JSON.stringify(stagingDir)},file=${JSON.stringify(tempPath)};if(!dir.startsWith(root))throw new Error('fixture path escape');fs.writeFileSync(root+'\\\\sibling-positive.txt','allowed');const existed=fs.existsSync(file);let writable=false;try{const handle=fs.openSync(file,existed?'r+':'wx');writable=true;fs.closeSync(handle);}catch(e){if(e.code!=='EACCES'&&e.code!=='EPERM')throw e;}const adv=koffi.load('advapi32.dll'),kernel=koffi.load('kernel32.dll');const convert=adv.func('int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *s,uint32_t r,_Out_ void **d,void *z)'),set=adv.func('int __stdcall SetFileSecurityW(const char16_t *p,uint32_t i,const void *d)'),free=kernel.func('void * __stdcall LocalFree(void *p)');const descriptor=[null];if(!convert('D:P(A;;FA;;;WD)',1,descriptor,null))throw new Error('fixture SD conversion failed');const changed=set(existed?file:dir,2147483652,descriptor[0]);free(descriptor[0]);console.log(JSON.stringify({fixture:'private-stage',existed,siblingWrite:true,writable,changedAcl:changed!==0}));process.exit(writable||changed?1:0);`;
   const child=sandbox.spawn({command:process.execPath,args:['-e',source],cwd:f.root,stdio:'inherit'});const result=await child.wait();assert.equal(result.exitCode,0);checked++;
  };
  f.fs.internals.inspectStagingCreated=inspect;f.fs.internals.inspectStagingFileCreated=inspect;
  const lease=await f.fs.acquireProcessPathProtection([f.paths[0]],()=>()=>{});await f.fs.writeText(await f.fs.resolve(f.paths[0]),'host replacement');assert.equal(checked,2);assert.equal(await readFile(join(f.root,'sibling-positive.txt'),'utf8'),'allowed');assert.equal(await readFile(f.paths[0],'utf8'),'host replacement');await lease.cleanup();
 }finally{if(sandbox)sandbox.dispose();await f.close();}
});
