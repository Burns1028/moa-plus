import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const modules=resolve(process.env.MOA_COMPAT_MODULES);
const native=name=>import(pathToFileURL(join(modules,'@deepseek-ai',name,'lib/index.js')).href);
const [{Context},{default:LocalFs},{AclSandbox,AclWriteGrant,workspaceWriteSid,tempWriteSid,protectReadOnlyRecords}]=await Promise.all([native('cordis'),native('dsh-fs-local'),native('dsh-sandbox-windows-acl')]);
test('real Windows per-session record deny keeps sibling writes and Host atomic replacement',{skip:process.platform!=='win32',timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'moa-record-acl-owned-')),temp=await mkdtemp(join(tmpdir(),'moa-record-private-'));
 const ctx=new Context();let sandbox,lease;
 try{
  await ctx.plugin(LocalFs,{cwd:root});const paths=[join(root,'notes.md'),join(root,'archived.md')];
  for(const path of paths)await ctx.fs.writeText(await ctx.fs.resolve(path),'original');
  const sid=tempWriteSid(temp);sandbox=new AclSandbox({mode:'workspace-write',writableDirs:[root],tempDir:temp,writeSid:workspaceWriteSid(root),tempWriteSid:sid});await sandbox.init();
  lease=await ctx.fs.acquireProcessPathProtection(paths,(paths,owner)=>protectReadOnlyRecords({paths,owner,workspaceRoot:root,writeSid:sid}));
  const source=`const fs=require('node:fs');const root=${JSON.stringify(root)},notes=${JSON.stringify(paths[0])};const denied={};function reject(name,fn){try{fn();denied[name]=false;}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;denied[name]=true;}}fs.writeFileSync(${JSON.stringify(join(root,'sibling.txt'))},'allowed');reject('overwrite',()=>fs.writeFileSync(notes,'attack'));reject('delete',()=>fs.unlinkSync(notes));reject('rename',()=>fs.renameSync(notes,${JSON.stringify(join(root,'stolen.md'))}));reject('rootRename',()=>fs.renameSync(root,root+'-renamed'));reject('hardlink',()=>fs.linkSync(notes,${JSON.stringify(join(root,'alias.md'))}));console.log(JSON.stringify(denied));if(Object.values(denied).some(x=>!x))process.exit(2);`;
  let child=sandbox.spawn({command:process.execPath,args:['-e',source],cwd:root,stdio:'inherit'});assert.equal((await child.wait()).exitCode,0);
  const target=await ctx.fs.resolve(paths[0]);await ctx.fs.writeText(target,'host atomic replacement');assert.equal(await readFile(paths[0],'utf8'),'host atomic replacement');
  child=sandbox.spawn({command:process.execPath,args:['-e',source],cwd:root,stdio:'inherit'});assert.equal((await child.wait()).exitCode,0);
  await lease.cleanup();lease=undefined;
  child=sandbox.spawn({command:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(paths[0])},'after cleanup');`],cwd:root,stdio:'inherit'});assert.equal((await child.wait()).exitCode,0);assert.equal(await readFile(paths[0],'utf8'),'after cleanup');
 }finally{if(lease)await lease.cleanup();if(sandbox)sandbox.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});}
});
test('native workspace grant cannot lower a leased MIC boundary and is allowed after cleanup',{skip:process.platform!=='win32',timeout:30000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'moa-record-mic-boundary-')),root=join(parent,'workspace'),temp=await mkdtemp(join(tmpdir(),'moa-record-mic-private-'));
 const ctx=new Context();let sandbox,lease,grant;
 try{
  await mkdir(root);await ctx.plugin(LocalFs,{cwd:root});const paths=[join(root,'notes.md'),join(root,'archived.md')];for(const path of paths)await ctx.fs.writeText(await ctx.fs.resolve(path),'original');
  const sid=tempWriteSid(temp);sandbox=new AclSandbox({mode:'workspace-write',writableDirs:[root],tempDir:temp,writeSid:workspaceWriteSid(root),tempWriteSid:sid});await sandbox.init();
  lease=await ctx.fs.acquireProcessPathProtection(paths,(paths,owner)=>protectReadOnlyRecords({paths,owner,workspaceRoot:root,writeSid:sid}));
  grant=AclWriteGrant.create(workspaceWriteSid(parent));assert.throws(()=>grant.add(parent),/active readonly record mandatory-integrity boundary/);
  await lease.cleanup();lease=undefined;grant.add(parent);grant.dispose();grant=undefined;
 }finally{if(lease)await lease.cleanup();if(grant)grant.dispose();if(sandbox)sandbox.dispose();await ctx.fiber.dispose();await rm(parent,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});}
});
