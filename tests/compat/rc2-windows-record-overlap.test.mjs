import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const modules=resolve(process.env.MOA_COMPAT_MODULES);
const native=name=>import(pathToFileURL(join(modules,'@deepseek-ai',name,'lib/index.js')).href);
const [{Context},{default:LocalFs},{AclSandbox,workspaceWriteSid,tempWriteSid,protectReadOnlyRecords}]=await Promise.all([native('cordis'),native('dsh-fs-local'),native('dsh-sandbox-windows-acl')]);
const koffiPath=createRequire(pathToFileURL(join(modules,'@deepseek-ai/dsh-fs-local/package.json'))).resolve('koffi');
test('real tokens retain same-SID/other-SID leases and reject owner WRITE_DAC before/after atomic replacement',{skip:process.platform!=='win32',timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'moa-record-review-owned-')),tempA=await mkdtemp(join(tmpdir(),'moa-record-review-a-')),tempB=await mkdtemp(join(tmpdir(),'moa-record-review-b-'));
 const ctx=new Context();const live=new Set();let a,b;
 try{
  await ctx.plugin(LocalFs,{cwd:root});const parent=join(root,'records');await mkdir(parent);const record=join(parent,'notes.md');await ctx.fs.writeText(await ctx.fs.resolve(record),'original');
  const sidA=tempWriteSid(tempA),sidB=tempWriteSid(tempB);
  a=new AclSandbox({mode:'workspace-write',writableDirs:[root],tempDir:tempA,writeSid:workspaceWriteSid(root),tempWriteSid:sidA});
  b=new AclSandbox({mode:'workspace-write',writableDirs:[root],tempDir:tempB,writeSid:workspaceWriteSid(root),tempWriteSid:sidB});
  await a.init();await b.init();
  const acquire=async sid=>{const lease=await ctx.fs.acquireProcessPathProtection([record],(paths,owner)=>protectReadOnlyRecords({paths,owner,workspaceRoot:root,writeSid:sid}));live.add(lease);return lease;};
  const release=async lease=>{await lease.cleanup();live.delete(lease);};
  const check=async(sandbox,denied,label)=>{
   const source=`const fs=require('node:fs'),koffi=require(${JSON.stringify(koffiPath)});const record=${JSON.stringify(record)},parent=${JSON.stringify(parent)},root=${JSON.stringify(root)};fs.writeFileSync(root+'\\\\positive-sibling.txt','allowed');let wrote=false;try{fs.writeFileSync(record,'worker allowed');wrote=true;}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;}const adv=koffi.load('advapi32.dll'),kernel=koffi.load('kernel32.dll'),convert=adv.func('int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *s,uint32_t r,_Out_ void **d,void *z)'),set=adv.func('int __stdcall SetFileSecurityW(const char16_t *p,uint32_t i,const void *d)'),free=kernel.func('void * __stdcall LocalFree(void *p)');const descriptor=[null];if(!convert('D:P(A;;FA;;;WD)',1,descriptor,null))throw new Error('fixture SD conversion failed');const changed=${denied?'[record,parent,root].map(path=>set(path,2147483652,descriptor[0])!==0)':'[]'};free(descriptor[0]);console.log(JSON.stringify({label:${JSON.stringify(label)},wrote,changed}));process.exit(wrote===${!denied}&&changed.every(x=>!x)?0:2);`;
   const child=sandbox.spawn({command:process.execPath,args:['-e',source],cwd:root,stdio:'inherit'});assert.equal((await child.wait()).exitCode,0,label);
  };
  const first=await acquire(sidA),second=await acquire(sidA),other=await acquire(sidB);
  await check(a,true,'both A leases active');await check(b,true,'B active');
  await release(first);await check(a,true,'A first cleanup preserves same-SID second');
  await ctx.fs.writeText(await ctx.fs.resolve(record),'Host atomic overwrite 1');assert.equal(await readFile(record,'utf8'),'Host atomic overwrite 1');
  await check(a,true,'A protection after Host atomic overwrite');await check(b,true,'B protection after Host atomic overwrite');
  await release(second);await check(a,false,'A last cleanup restores only A');await check(b,true,'B deny survives A last cleanup');
  await ctx.fs.writeText(await ctx.fs.resolve(record),'Host atomic overwrite 2');assert.equal(await readFile(record,'utf8'),'Host atomic overwrite 2');await check(b,true,'B protection after A cleanup and overwrite');
  await release(other);await check(a,false,'A restored after all cleanup');await check(b,false,'B restored after all cleanup');
 }finally{for(const lease of live)await lease.cleanup();if(a)a.dispose();if(b)b.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});await rm(tempA,{recursive:true,force:true});await rm(tempB,{recursive:true,force:true});}
});
