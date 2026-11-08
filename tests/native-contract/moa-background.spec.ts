import { expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import Jobs from "@deepseek-ai/dsh-jobs-local";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId, pluginRecordOf } from "@deepseek-ai/dsh-session";
import { createUserMessage, HarnessError, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { Adapter, response } from "../host/fixture.ts";
import { backgroundHandle, bindBackground, type BackgroundResultData } from "../../packages/project-mode/src/host/moa/background.ts";
import type { BackgroundReceipt } from "@deepseek-ai/dsh-agent";
import { defineTool, ToolNotFoundError } from "@deepseek-ai/dsh-tools";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import * as Persistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const user = (text: string) => createUserMessage({ source: { kind: "user" }, content: [{type:"text",text}] });
function calls(...names: string[]): StreamChunk[] {
 return [...names.flatMap((name,index):StreamChunk[]=>[
  {type:"block-start",index,blockType:"tool-call"},
  {type:"tool-call-delta",index,id:`call-${index}`,name,argumentsDelta:"{}"},
  {type:"block-end",index,block:{type:"tool-call",id:`call-${index}`,name,arguments:"{}"}},
 ]),{type:"finish",reason:{kind:"tool-calls"}}];
}
async function setup(strategy:"after-seconds"|"new-message"|"llm-judge"="after-seconds", seconds=0.01, persistenceRoot?:string) {
 const ctx=new Context();
 await mountAgentLoopTestDependencies(ctx,{workingDirectory:true});
 if(persistenceRoot)await ctx.plugin(Persistence,{root:persistenceRoot,compression:"none"});
 await ctx.plugin(AgentLoop,{agents:[]}); await ctx.plugin(Jobs,{pumpPollMs:5});
 const adapter=new Adapter();ctx.llm.registerAdapter(["test"],adapter);
 const {agent}=await ctx.agents.create({sessionId:SessionId("native-moa"),agentOptions:{provider:"test",model:"test"}});
 const off=await bindBackground(ctx,agent,{backgroundStrategy:strategy,backgroundAfterSeconds:seconds});
 return {ctx,agent,adapter,off,async dispose(){await off();await ctx.fiber.dispose();}};
}
async function until(test:()=>boolean) { await expect.poll(test,{timeout:3000,interval:5}).toBe(true); }
const backgroundRecords=(agent:import("@deepseek-ai/dsh-agent").Agent)=>agent.session.snapshotEvents().flatMap(event=>{
 const record=pluginRecordOf(event);
 return record?.type==="plugin:moa/background-result"?[{...record,data:record.data as BackgroundResultData}]:[];
});
const backgroundResults=(f:Awaited<ReturnType<typeof setup>>)=>backgroundRecords(f.agent);
function receiptOf(f:Awaited<ReturnType<typeof setup>>) {
 const e=f.agent.session.snapshotEvents().find(e=>e.type==="tool/result" && (e.data.meta as any)?.moaBackground);
 return (e as any)?.data.meta.moaBackground as BackgroundReceipt;
}

it.each(["consumed","stopped"])("reads a %s background result from durable JSONL after a fresh runtime restart and delivers it only once", async (state) => {
 const root=await mkdtemp(join(tmpdir(),"moa-background-restart-"));
 const gate=Promise.withResolvers<string>();
 let current: {ctx:Context;agent:import("@deepseek-ai/dsh-agent").Agent;adapter:Adapter;off:()=>Promise<void>} | undefined;
 async function open(resume=false){
  const ctx=new Context();
  await mountAgentLoopTestDependencies(ctx,{workingDirectory:true});
  await ctx.plugin(Persistence,{root,compression:"none"});
  await ctx.plugin(AgentLoop,{agents:[]});await ctx.plugin(Jobs);
  const adapter=new Adapter();ctx.llm.registerAdapter(["test"],adapter);
  const options={agentOptions:{provider:"test",model:"test"}};
  const {agent}=resume?await ctx.agents.resume({...options,resumeSessionId:SessionId("persisted-background")}):await ctx.agents.create({...options,sessionId:SessionId("persisted-background")});
  const off=await bindBackground(ctx,agent,{backgroundStrategy:"after-seconds",backgroundAfterSeconds:0.01});
  return {ctx,agent,adapter,off};
 }
 try{
  current=await open();const first=current;
  first.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(_args,exec){if(state==="stopped")await new Promise<void>(resolve=>exec.signal.addEventListener("abort",()=>resolve(),{once:true}));return gate.promise;}});
  first.adapter.handler=()=>first.adapter.requests.length===1?calls("held"):response("done");
  first.agent.followup(user("run"));await first.agent.whenIdle();
  const receipt=first.agent.session.snapshotEvents().find(e=>e.type==="tool/result"&&(e.data.meta as any)?.moaBackground);
  const handle=backgroundHandle((receipt as any).data.meta.moaBackground);
  if(state==="stopped"){
   const stopping=first.agent.cancelAndJoin({kind:"parent"});gate.resolve("the complete durable result");await stopping;
  }else{
   gate.resolve("the complete durable result");
   await until(()=>first.agent.session.snapshotEvents().some(e=>e.type==="user/message"&&e.data.source.kind==="moa-background-result"));
  }
  await first.agent.whenIdle();await first.ctx.sessions.flush(first.agent.session);
  const before=first.agent.session.snapshotEvents().filter(e=>e.type==="user/message"&&e.data.source.kind==="moa-background-result");
  expect(before).toHaveLength(state==="consumed"?1:0);
  await first.off();await first.ctx.fiber.dispose();current=undefined;
  current=await open(true);await current.agent.whenIdle();
  if(state==="stopped"){current.agent.steer(user("resume deliberately"));await current.agent.whenIdle();}
  const after=current.agent.session.snapshotEvents().filter(e=>e.type==="user/message"&&e.data.source.kind==="moa-background-result");
  expect(after).toHaveLength(1);
  const saved=backgroundRecords(current.agent);expect(saved).toHaveLength(1);
  expect(after[0].data.id).toBe(saved[0].data.delivery.id);
  if(state==="consumed"){expect(after).toEqual(before);expect(current.adapter.requests).toHaveLength(0);}
  await current.off();current.off=await bindBackground(current.ctx,current.agent,{backgroundStrategy:"after-seconds",backgroundAfterSeconds:0.01});await current.agent.whenIdle();
  expect(current.agent.session.snapshotEvents().filter(e=>e.type==="user/message"&&e.data.id===saved[0].data.delivery.id)).toHaveLength(1);
  const result=await current.ctx.tools.execute({agent:current.agent,name:"query_background_tool",callId:"query" as any,signal:new AbortController().signal,arguments:{tool_call_id:handle}});
  expect(result.isError).toBe(false);expect(result.value).toMatchObject({status:"finished",...saved[0].data.result});
  expect(["running","stopping"]).toContain(saved[0].data.job?.status);
  expect(result.value).not.toHaveProperty("job");
  if(state==="consumed")expect(JSON.stringify(result)).toContain("the complete durable result");
 }finally{gate.resolve("cleanup");if(current){await current.off();await current.ctx.fiber.dispose();}await rm(root,{recursive:true,force:true});}
});

it("continues to refuse unrelated unknown required events on durable reopen",async()=>{
 const root=await mkdtemp(join(tmpdir(),"moa-unknown-event-"));const ctx=new Context();
 try{
  await mountAgentLoopTestDependencies(ctx,{workingDirectory:true});await ctx.plugin(Persistence,{root,compression:"none"});await ctx.plugin(AgentLoop,{agents:[]});
  const {agent}=await ctx.agents.create({sessionId:SessionId("unsupported-event")});
  agent.session.append("unsupported/required" as never,{} as never);await ctx.sessions.flush(agent.session);
  await expect(ctx.sessionPersistence.open(agent.id,"read")).rejects.toThrow(/unknown to this harness and not marked ignorable/);
 }finally{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

it("can disable a draft inside native maintenance without joining itself", async () => {
 const f = await setup();
 try {
  await f.agent.runMaintenance(async signal => {
   await f.off();
   expect(signal.aborted).toBe(false);
  });
  expect(f.agent.session.snapshotEvents().filter(e => e.type === "turn/start")).toHaveLength(0);
  expect(f.ctx.tools.get("query_background_tool", f.agent)).toBeUndefined();
 } finally { await f.dispose(); }
});

it("keeps strict schema/finalizers authoritative and continues the same turn after timer transfer",async()=>{
 const f=await setup();const gate=Promise.withResolvers<string>();let rendered=0,projected=0,finalized=0,observed=0;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>{rendered++;return [{type:"text",text:String(v)}];}},execute:()=>gate.promise,projectContent:(_e,r)=>{projected++;return r.content;},finalizeContent:(_e,r)=>{finalized++;return r.content;}});
  f.ctx.on("tools/result",exec=>{if(exec.name==="held")observed++;});
  f.adapter.handler=()=> f.adapter.requests.length===1?calls("held"):response("done");
  f.agent.followup(user("go"));await f.agent.whenIdle();
  expect(f.agent.moaHasPendingBackground).toBe(true);
  expect(receiptOf(f)).toMatchObject({cause:{kind:"after-seconds"}});
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="turn/start")).toHaveLength(1);
  expect([rendered,projected,finalized,observed]).toEqual([0,0,0,0]);
  const full="real output ".repeat(5000);gate.resolve(full);
  await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
  expect(f.agent.moaHasPendingBackground).toBe(false);
  expect([rendered,projected,finalized,observed]).toEqual([1,1,1,1]);
  expect(JSON.stringify(f.adapter.requests.at(-1))).toContain(full);
  const r=receiptOf(f);const exec={agent:f.agent,callId:"query" as any,signal:new AbortController().signal};
  const query=()=>f.ctx.tools.execute({...exec,name:"query_background_tool",arguments:{tool_call_id:backgroundHandle(r)}});
  expect(await query()).toEqual(await query());
 } finally{gate.resolve("cleanup");await f.dispose();}
});
it("allows a slow SendMessage Notify and explicit reply to use ordinary tool backgrounding",async()=>{
 const f=await setup();const gate=Promise.withResolvers<string>();
 try{
  f.ctx.tools.register({name:"SendMessage",description:"notify",parameters:{type:"object",properties:{mode:{type:"string"},reply_to:{type:"string"}}},output:{schema:{type:"string"},render:(_args,value)=>[{type:"text",text:String(value)}]},execute:()=>gate.promise});
  const args=JSON.stringify({mode:"notify",reply_to:"an-explicit-request"});
  f.adapter.handler=()=>f.adapter.requests.length===1?[
   {type:"block-start",index:0,blockType:"tool-call"},
   {type:"block-end",index:0,block:{type:"tool-call",id:"notification",name:"SendMessage",arguments:args}},
   {type:"finish",reason:{kind:"tool-calls"}},
  ]:response("done");
  f.agent.followup(user("send notification"));await f.agent.whenIdle();
  expect(receiptOf(f)).toMatchObject({callId:"notification",cause:{kind:"after-seconds"}});
  gate.resolve("notification accepted");await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
  expect(JSON.stringify(backgroundResults(f)[0].data.result)).toContain("notification accepted");
 }finally{gate.resolve("cleanup");await f.dispose();}
});
it("message handoff drains every foreground sibling and carries the complete next-step batch into a new turn",async()=>{
 const f=await setup("new-message",0);const held=Promise.withResolvers<string>();const sibling=Promise.withResolvers<string>();let started=0;
 try{
  for(const [name,work] of [["held",held],["sibling",sibling]] as const) f.ctx.tools.register({name,description:name,parameters:{type:"object"},isConcurrencySafe:()=>true,output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{started++;return work.promise;}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held","sibling"):response("next");
  f.agent.followup(user("go"));await until(()=>started===2);
  // Finish sibling before inserting input, while held remains live.
  sibling.resolve("sibling finished");await new Promise(r=>setTimeout(r,5));
  f.agent.steer(user("new direction"));f.agent.steer(user("additional detail"));
  await f.agent.whenIdle();
  const ends=f.agent.session.snapshotEvents().filter(e=>e.type==="turn/end");
  expect(ends[0].data.reason).toMatchObject({kind:"handoff"});
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="tool/result")).toHaveLength(2);
  expect(JSON.stringify(f.adapter.requests[1])).toContain("additional detail");
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="turn/start")).toHaveLength(2);
 }finally{held.resolve("finished");sibling.resolve("finished");await f.dispose();}
});
it("bypasses the threshold only for a declared backgroundOnMessage tool",async()=>{
 const f=await setup("new-message",60);const gate=Promise.withResolvers<string>();let started=false;
 try{
  f.ctx.tools.register(defineTool({name:"held",description:"held",backgroundOnMessage:true,parameters:{},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:v}]},execute:()=>{started=true;return gate.promise;}}));
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");
  f.agent.followup(user("go"));await until(()=>started);f.agent.steer(user("urgent"));await f.agent.whenIdle();
  expect(receiptOf(f).cause.kind).toBe("new-message");
 }finally{gate.resolve("done");await f.dispose();}
});
it("a false judge preserves unread input and judges again for new input",async()=>{
 const f=await setup("llm-judge",0);const gate=Promise.withResolvers<string>();let started=false,judgments=0,main=0;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{started=true;return gate.promise;}});
  f.adapter.handler=options=>options.maxTokens===32?response(++judgments===1?"false":"true"):++main===1?calls("held"):response("done");
  f.agent.followup(user("go"));await until(()=>started);const first=user("progress");f.agent.steer(first);await until(()=>judgments===1);
  expect(f.agent.inbox.nextStep.map(m=>m.id)).toContain(first.id);expect(receiptOf(f)).toBeUndefined();
  f.agent.steer(user("need answer"));await f.agent.whenIdle();expect(judgments).toBe(2);expect(receiptOf(f).cause.kind).toBe("llm-judge");
 }finally{gate.resolve("done");await f.dispose();}
});
it("standalone stop joins background cleanup while later messages remain parked without a fabricated turn",async()=>{
 const f=await setup();const cleanup=Promise.withResolvers<void>();let cancelled=false;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(_a,e){await new Promise<void>(r=>e.signal.addEventListener("abort",()=>{cancelled=true;r();},{once:true}));await cleanup.promise;return "cleaned";}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("go"));await f.agent.whenIdle();
  let joined=false;const stop=f.agent.cancelAndJoin({kind:"parent"}).then(()=>{joined=true;});await until(()=>cancelled);
  expect(f.agent.moaAborting).toBe(true);
  f.agent.steer(user("parked"));await new Promise(r=>setTimeout(r,20));expect(joined).toBe(false);expect(f.adapter.requests).toHaveLength(2);
  cleanup.resolve();await stop;expect(f.agent.moaAborting).toBe(false);expect(f.agent.inbox.nextStep).toHaveLength(1);expect(f.adapter.requests).toHaveLength(2);
  f.agent.steer(user("resume"));await f.agent.whenIdle();expect(JSON.stringify(f.adapter.requests.at(-1))).toContain("tool call aborted");
 }finally{cleanup.resolve();await f.dispose();}
});
it("hard continuation waits for cleanup and flush, then admits the replacement before parked messages",async()=>{
 const f=await setup();const cleanup=Promise.withResolvers<void>();let aborted=false;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(_a,e){await new Promise<void>(r=>e.signal.addEventListener("abort",()=>{aborted=true;r();},{once:true}));await cleanup.promise;return "old exited";}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("go"));await f.agent.whenIdle();
  const stop=f.agent.cancelAndJoin({kind:"parent"},{continuation:user("replacement")});await until(()=>aborted);f.agent.steer(user("later"));expect(f.adapter.requests).toHaveLength(2);
  cleanup.resolve();await stop;await f.agent.whenIdle();const text=JSON.stringify(f.adapter.requests.at(-1));expect(text.indexOf("replacement")).toBeLessThan(text.indexOf("later"));
 }finally{cleanup.resolve();await f.dispose();}
});

async function shell(f:Awaited<ReturnType<typeof setup>>,promote=true) {
 const {default:Subprocess}=await import("@deepseek-ai/dsh-subprocess-local");
 const {default:Bash}=await import("@deepseek-ai/dsh-bash-local");
 const Tool=await import("@deepseek-ai/dsh-tool-bash");
 await f.ctx.plugin(Subprocess);await f.ctx.plugin(Bash,{timeoutMs:30,maxTimeoutMs:2000,graceMs:500});await f.ctx.plugin(await import("@deepseek-ai/dsh-shell-env"));await f.ctx.plugin(Tool,{promoteOnTimeout:promote});
 expect(f.ctx.tools.get("bash",f.agent)).toBeDefined();
}
function bashCall(command:string,timeoutMs=30,explicit=false):StreamChunk[] {
 const args=JSON.stringify({command,description:"Run native Bash contract test",timeoutMs,...explicit?{run_in_background:true}:{}});
 return [{type:"block-start",index:0,blockType:"tool-call"},{type:"tool-call-delta",index:0,id:"bash-call",name:"bash",argumentsDelta:args},{type:"block-end",index:0,block:{type:"tool-call",id:"bash-call",name:"bash",arguments:args}},{type:"finish",reason:{kind:"tool-calls"}}];
}
it("adopts the actual locked Bash producer at native promotion and publishes its final output",async()=>{
 const f=await setup("after-seconds",60);
 try{
  await shell(f);
  f.adapter.handler=()=>f.adapter.requests.length===1?bashCall("printf 'begin\\n'; sleep 0.2; printf 'actual final\\n'"):response("done");
  f.agent.followup(user("run"));await f.agent.whenIdle();
  const r=receiptOf(f);expect(r).toBeDefined();expect(r.jobId).toMatch(/^bash-/);expect(r.cause.kind).toBe("producer-promotion");
  expect(f.ctx.jobs.list(f.agent.id)).toHaveLength(1);expect(backgroundResults(f)).toHaveLength(0);
  expect(JSON.stringify(f.ctx.jobs.readAt(r.jobId,0,f.agent.id))).toContain("begin");
  await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
  expect(JSON.stringify(backgroundResults(f)[0].data.result)).toContain("actual final");
  expect(JSON.stringify(backgroundResults(f)[0].data)).toContain("exit code: 0");
  expect(f.ctx.jobs.get(r.jobId,f.agent.id).completionNotice).toBe("producer");
 }finally{await f.dispose();}
});
it("joins real Bash termination cleanup beyond its ordinary promotion wait",async()=>{
 const f=await setup("after-seconds",60);
 try{
  await shell(f);
  // TERM trap keeps the real shell alive after the cancellation request.
  f.adapter.handler=()=>f.adapter.requests.length===1?bashCall("trap 'sleep 0.15; exit 0' TERM; printf 'ready\\n'; while :; do sleep 0.02; done",25):response("done");
  f.agent.followup(user("run"));await f.agent.whenIdle();expect(receiptOf(f)).toBeDefined();
  let joined=false;const started=Date.now();const stop=f.agent.cancelAndJoin({kind:"parent"}).then(()=>{joined=true;});
  await new Promise(r=>setTimeout(r,50));expect(joined).toBe(false);await stop;
  expect(Date.now()-started).toBeGreaterThan(100);expect(f.adapter.requests).toHaveLength(2);
 }finally{await f.dispose();}
});
it("leaves explicit native background jobs independently controlled",async()=>{
 const f=await setup("after-seconds",60);
 try{
  await shell(f);
  f.adapter.handler=()=>f.adapter.requests.length===1?bashCall("sleep 0.1; printf explicit",30,true):response("done");
  f.agent.followup(user("run"));await f.agent.whenIdle();expect(receiptOf(f)).toBeUndefined();
  const [job]=f.ctx.jobs.list(f.agent.id);expect(job.completionNotice).toBeUndefined();
  await f.agent.cancelAndJoin({kind:"parent"});expect(f.ctx.jobs.get(job.id,f.agent.id).status).toBe("running");
  await f.ctx.jobs.wait(job.id,1000,f.agent.id);
 }finally{await f.dispose();}
});

it("keeps foreground siblings ordered behind a transferred root, including later exclusive work",async()=>{
 const f=await setup("after-seconds",60);const held=Promise.withResolvers<string>(),first=Promise.withResolvers<string>(),last=Promise.withResolvers<string>();let starts=0;
 const newInput=user("handoff message");
 try{
  const seen:string[]=[];
  for(const [name,gate,parallel] of [["held",held,true],["first",first,true],["last",last,true],["exclusive",undefined,false]] as const)f.ctx.tools.register({name,description:name,parameters:{type:"object"},isConcurrencySafe:()=>parallel,output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(){starts++;seen.push(name);return gate?gate.promise:"exclusive done";}});
  f.agent.ctx.on("agent/tool-activity-started",a=>{if(a.execution.name==="held"){f.agent.steer(newInput);void a.requestBackground({kind:"new-message",messageIds:[newInput.id]});}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held","first","last","exclusive"):response("done");
  f.agent.followup(user("go"));await until(()=>starts===3);last.resolve("last first");await new Promise(r=>setTimeout(r,15));
  expect(f.adapter.requests).toHaveLength(1);expect(seen).not.toContain("exclusive");
  first.resolve("first last");await f.agent.whenIdle();expect(seen).toEqual(["held","first","last","exclusive"]);
  const events=f.agent.session.snapshotEvents();const end=events.findIndex(e=>e.type==="turn/end");
  expect(events.slice(0,end).filter(e=>e.type==="tool/result").map(e=>e.data.message.source.callId)).toEqual(["call-0","call-1","call-2","call-3"]);
  expect(events[end].data).toMatchObject({reason:{kind:"handoff"}});
 }finally{held.resolve("done");first.resolve("done");last.resolve("done");await f.dispose();}
});
it("retains foreground ownership if native job admission rejects",async()=>{
 const f=await setup();const gate=Promise.withResolvers<string>();let started=false;
 try{
  // Existing controller remains attached; occupy the actual registry's capacity.
  const jobs=[];for(let i=0;i<10;i++)jobs.push(f.ctx.jobs.start({kind:"bash",label:"capacity",owner:f.agent.id,run:()=>({cancel(){},done:gate.promise.then(()=>({status:"completed" as const}))})}));
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{started=true;return gate.promise;}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("go"));await until(()=>started);await new Promise(r=>setTimeout(r,30));
  expect(receiptOf(f)).toBeUndefined();expect(f.adapter.requests).toHaveLength(1);gate.resolve("foreground");await f.agent.whenIdle();expect(backgroundResults(f)).toHaveLength(0);
 }finally{gate.resolve("done");await f.dispose();}
});
it("a reentrant abort during registration wins before ownership release",async()=>{
 const f=await setup();let exited=false;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(_a,e){await new Promise<void>(r=>e.signal.addEventListener("abort",()=>r(),{once:true}));exited=true;return "stopped";}});
  const off=f.ctx.jobs.events.subscribe({owners:"scope"},e=>{if(e.type==="registered")f.agent.cancel({kind:"parent"});});
  f.adapter.handler=()=>calls("held");f.agent.followup(user("go"));await f.agent.whenIdle();off();
  expect(exited).toBe(true);expect(receiptOf(f)).toBeUndefined();expect(f.ctx.jobs.list(f.agent.id)).toHaveLength(1);
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="tool/result")).toHaveLength(1);
 }finally{await f.dispose();}
});
it("does not start a background timer while native pre-policy is pending",async()=>{
 const f=await setup();const approval=Promise.withResolvers<void>();let started=0;
 try{
  f.ctx.on("tools/pre-execute",async(exec,next)=>{if(exec.name==="held")await approval.promise;return next();});
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(){started++;return "immediate";}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("go"));await until(()=>f.adapter.requests.length===1);await new Promise(r=>setTimeout(r,30));
  expect(started).toBe(0);expect(f.ctx.jobs.list(f.agent.id)).toHaveLength(0);approval.resolve();await f.agent.whenIdle();expect(receiptOf(f)).toBeUndefined();
 }finally{approval.resolve();await f.dispose();}
});
it("releases admitted activity when native pre-policy fails before dispatch",async()=>{
 const f=await setup();let dispatched=false;
 try{
  f.ctx.on("tools/pre-execute",async(exec,next)=>{if(exec.name==="held")throw new Error("policy storage unavailable");return next();});
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{dispatched=true;return "unreachable";}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("go"));await f.agent.whenIdle();
  expect(dispatched).toBe(false);
  await Promise.race([f.agent.cancelAndJoin({kind:"parent"}),new Promise((_,reject)=>setTimeout(()=>reject(new Error("policy failure leaked activity")),200))]);
 }finally{await f.dispose();}
});
it("keeps ordinary native Stop distinct from joined background cancellation",async()=>{
 const f=await setup();const gate=Promise.withResolvers<string>();let signal:AbortSignal|undefined;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute(_a,e){signal=e.signal;return gate.promise;}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("go"));await f.agent.whenIdle();f.agent.cancel({kind:"user"});expect(signal!.aborted).toBe(false);
  gate.resolve("still owned by jobs");await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
 }finally{gate.resolve("done");await f.dispose();}
});

it("drains native activity when a later tool's concurrency classification throws",async()=>{
 const f=await setup("after-seconds",60);const gate=Promise.withResolvers<string>();let started=false;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},isConcurrencySafe:()=>true,output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{started=true;return gate.promise;}});
  f.ctx.tools.register({name:"broken",description:"broken",parameters:{type:"object"},isConcurrencySafe:()=>{throw new Error("classification failed");},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>"unreachable"});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held","broken"):response("done");
  f.agent.followup(user("go"));await until(()=>started);gate.resolve("drained");await f.agent.whenIdle();
  await f.agent.cancelAndJoin({kind:"parent"});
  expect(f.agent.moaAborting).toBe(false);
  const events=f.agent.session.snapshotEvents();
  expect(events.filter(e=>e.type==="tool/call").length).toBe(events.filter(e=>e.type==="tool/result").length);
 }finally{gate.resolve("cleanup");await f.dispose();}
});

it("retains Aborting when a native resource-exit observation fails",async()=>{
 const f=await setup();const gate=Promise.withResolvers<void>();gate.promise.catch(()=>{});
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(_a,e){e.background!.bindProducer({exited:gate.promise,cancel(){}});await new Promise<void>(r=>e.signal.addEventListener("abort",()=>r(),{once:true}));return "value before resource exit";}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");
  f.agent.followup(user("go"));await until(()=>receiptOf(f)!==undefined);await f.agent.whenIdle();gate.reject(new Error("managed exit unavailable"));
  await expect(f.agent.cancelAndJoin({kind:"parent"})).rejects.toThrow();
  expect(f.agent.moaAborting).toBe(true);
 }finally{gate.resolve();await f.off().catch(()=>{});await f.ctx.fiber.dispose().catch(()=>{});}
});

it("keeps canonical program subcall values while transferring the whole native run_code",async()=>{
 const f=await setup();const gate=Promise.withResolvers<string>();let started=false;
 try{
  const {default:Subprocess}=await import("@deepseek-ai/dsh-subprocess-local");
  const {default:Ptc}=await import("@deepseek-ai/dsh-ptc-runtime-node");
  const {default:Policy}=await import("@deepseek-ai/dsh-sandbox-policy");
  const {default:Sandbox}=await import("@deepseek-ai/dsh-sandbox-local");
  await f.ctx.plugin(Subprocess);await f.ctx.plugin(Policy,{mode:"danger-full-access"});await f.ctx.plugin(Sandbox);await f.ctx.plugin(Ptc);
  expect(f.ctx.get("ptcRuntime")).toBeDefined();
  f.agent.ctx.tools.presentAs("ptc");
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{started=true;return gate.promise;}});
  const args=JSON.stringify({code:"const result = await tools.held({}); return {original: result, length: result.length}",description:"Call a held native subtool"});
  f.adapter.handler=()=>f.adapter.requests.length===1?[
   {type:"block-start",index:0,blockType:"tool-call"},{type:"block-end",index:0,block:{type:"tool-call",id:"ptc-call",name:"run_code",arguments:args}},{type:"finish",reason:{kind:"tool-calls"}},
  ]:response("done");
  f.agent.followup(user("run"));await until(()=>started);await f.agent.whenIdle();
  const receipt=receiptOf(f);expect(receipt).toBeDefined();expect(f.ctx.jobs.list(f.agent.id)).toHaveLength(1);
  gate.resolve("canonical subcall");await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
  expect(JSON.stringify(backgroundResults(f)[0].data.result)).toContain("canonical subcall");
  const dispatch=f.agent.session.snapshotEvents().find(e=>pluginRecordOf(e)?.type==="plugin:tools/ptc-dispatch");expect(JSON.stringify(dispatch)).toContain("canonical subcall");
 }finally{gate.resolve("cleanup");await f.dispose();}
});

it("keeps detached PTC completion and later subcalls readable through native durable cold observation",async()=>{
 const root=await mkdtemp(join(tmpdir(),"moa-detached-ptc-log-"));
 const f=await setup("new-message",0,root),gate=Promise.withResolvers<string>();
 let started=false;
 let observer:Context|undefined;
 try{
  await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
  await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-policy")).default,{mode:"danger-full-access"});
  await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
  await f.ctx.plugin((await import("@deepseek-ai/dsh-ptc-runtime-node")).default);
  f.agent.ctx.tools.presentAs("ptc");
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}],presentationMeta:()=>({fixture:"held-result"})},execute:()=>{started=true;return gate.promise;}});
  f.ctx.tools.register({name:"later",description:"later",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>"second subcall"});
  f.ctx.tools.register({name:"broken",description:"broken",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{throw new HarnessError("expected detached failure","EXPECTED_FAILURE");}});
  const args=JSON.stringify({code:"const first = await tools.held({}); const second = await tools.later({}); let failure; try { await tools.broken({}); } catch (error) { failure = error.message; } return {first, second, failure};",description:"Finish native subcalls after foreground closure"});
  f.adapter.handler=()=>f.adapter.requests.length===1?[
   {type:"block-start",index:0,blockType:"tool-call"},{type:"block-end",index:0,block:{type:"tool-call",id:"detached-ptc",name:"run_code",arguments:args}},{type:"finish",reason:{kind:"tool-calls"}},
  ]:response("done");
  f.agent.followup(user("run"));await until(()=>started);
  f.agent.steer(user("Process this message before the held tool finishes"));
  await f.agent.whenIdle();
  expect(receiptOf(f)).toBeDefined();
  gate.resolve("canonical first subcall");
  await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
  await f.ctx.sessions.flush(f.agent.session);
  await using handle=await f.ctx.sessionPersistence.open(f.agent.id,"read");
  await expect(handle.read(0)).resolves.toBeDefined();
  const traces=f.agent.session.snapshotEvents().flatMap(event=>{const record=pluginRecordOf(event);return record?.type.startsWith("plugin:tools/ptc-dispatch")?[record]:[];});
  expect(traces.map(record=>record.type)).toEqual(["plugin:tools/ptc-dispatch","plugin:tools/ptc-dispatch-start","plugin:tools/ptc-dispatch","plugin:tools/ptc-dispatch-start","plugin:tools/ptc-dispatch"]);
  const start=f.agent.session.snapshotEvents().find(event=>event.type==="tool/ptc-dispatch-start");
  expect(start?.type).toBe("tool/ptc-dispatch-start");
  const first=traces[0].data as Record<string,unknown>,laterStart=traces[1].data as Record<string,unknown>,laterResult=traces[2].data as Record<string,unknown>;
  expect(first).toMatchObject({...start!.data,isError:false,content:[{type:"text",text:"canonical first subcall"}],meta:{fixture:"held-result"}});
  expect(laterResult).toMatchObject({...laterStart,isError:false,content:[{type:"text",text:"second subcall"}]});
  expect(first).not.toHaveProperty("error");
  expect(laterStart.rootCallId).toEqual(first.rootCallId);
  expect(laterStart.parentCallId).toEqual(first.parentCallId);
  expect(traces[4].data).toMatchObject({...traces[3].data as object,isError:true,error:{code:"EXPECTED_FAILURE"},content:[{type:"text",text:"Error: expected detached failure"}]});
  expect(JSON.stringify(backgroundResults(f)[0].data.result)).toContain("canonical first subcall");
  expect(JSON.stringify(backgroundResults(f)[0].data.result)).toContain("second subcall");
  observer=new Context();await mountAgentLoopTestDependencies(observer,{workingDirectory:true});
  await observer.plugin(Persistence,{root,compression:"none"});
  await observer.plugin(AgentLoop,{agents:[]});
  await observer.plugin((await import("@deepseek-ai/dsh-session-query")).default);
  using cold=await observer.sessionQuery.observeSession(f.agent.id);
  expect(cold.source).toBe("prepared");
  expect(cold.projections?.values.inbox).toMatchObject({"next-step":[],"next-turn":[]});
 }finally{gate.resolve("cleanup");await observer?.fiber.dispose();await f.dispose();await rm(root,{recursive:true,force:true});}
});

it.each([false,true])("selects the PTC trace envelope after async shaping (transfer=%s)",async(transfer)=>{
 const root=await mkdtemp(join(tmpdir(),"moa-ptc-log-shaping-"));
 const f=await setup("new-message",0,root),gate=Promise.withResolvers<void>();let shaping=false;
 try{
  await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
  await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-policy")).default,{mode:"danger-full-access"});
  await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
  await f.ctx.plugin((await import("@deepseek-ai/dsh-ptc-runtime-node")).default);
  f.agent.ctx.tools.presentAs("ptc");
  f.ctx.tools.register({name:"quick",description:"quick",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>"canonical quick result"});
  f.ctx.on("tools/ptc-dispatch-log",async(_dispatch,next)=>{shaping=true;await gate.promise;return next();});
  const args=JSON.stringify({code:"return await tools.quick({});",description:"Preserve a shaped subcall result"});
  f.adapter.handler=()=>f.adapter.requests.length===1?[
   {type:"block-start",index:0,blockType:"tool-call"},{type:"block-end",index:0,block:{type:"tool-call",id:"shaped-ptc",name:"run_code",arguments:args}},{type:"finish",reason:{kind:"tool-calls"}},
  ]:response("done");
  f.agent.followup(user("run"));await until(()=>shaping);
  if(transfer){f.agent.steer(user("Process this now"));await f.agent.whenIdle();expect(receiptOf(f)).toBeDefined();}
  gate.resolve();if(transfer)await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
  const events=f.agent.session.snapshotEvents(),ordinary=events.filter(event=>event.type==="tool/ptc-dispatch"),detached=events.flatMap(event=>{const record=pluginRecordOf(event);return record?.type==="plugin:tools/ptc-dispatch"?[record]:[];});
  expect(ordinary).toHaveLength(transfer?0:1);expect(detached).toHaveLength(transfer?1:0);
  const result=transfer?detached[0].data:ordinary[0].data;
  expect(result).toMatchObject({parentCallId:"shaped-ptc",isError:false,content:[{type:"text",text:"canonical quick result"}]});
  await f.ctx.sessions.flush(f.agent.session);await using handle=await f.ctx.sessionPersistence.open(f.agent.id,"read");
  await expect(handle.read(0)).resolves.toBeDefined();
 }finally{gate.resolve();await f.dispose();await rm(root,{recursive:true,force:true});}
});

it("queries the settled native PTC job after real nested Bash cancellation without changing the canonical result",async()=>{
 const f=await setup();
 try{
  await shell(f,true);
  await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-policy")).default,{mode:"danger-full-access"});
  await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
  await f.ctx.plugin((await import("@deepseek-ai/dsh-ptc-runtime-node")).default);
  f.agent.ctx.tools.presentAs("ptc");
  const args=JSON.stringify({code:"const result = await tools.bash({description:'Run an owned child', command:\"printf 'inner-job-output\\n'; sleep 1\", timeoutMs:1500}); return result;",description:"Run and cancel actual nested Bash"});
  f.adapter.handler=()=>f.adapter.requests.length===1?[
   {type:"block-start",index:0,blockType:"tool-call"},
   {type:"block-end",index:0,block:{type:"tool-call",id:"ptc-cancel",name:"run_code",arguments:args}},
   {type:"finish",reason:{kind:"tool-calls"}},
  ]:response("done");
  f.agent.followup(user("run"));await f.agent.whenIdle();

  await until(()=>f.ctx.jobs.list(f.agent.id).some(job=>job.kind==="bash"&&f.ctx.jobs.readAt(job.id,0,f.agent.id).chunks.some(chunk=>chunk.text.includes("inner-job-output"))));
  const receipt=receiptOf(f),handle=backgroundHandle(receipt),signal=new AbortController().signal,parent=Symbol("native-control-dispatch") as any;
  const cancelled=await f.ctx.tools.execute({agent:f.agent,name:"cancel_background_tool",callId:"cancel" as any,parent,signal,arguments:{tool_call_id:handle}});
  expect(cancelled.isError).toBe(false);
  await until(()=>f.ctx.jobs.get(receipt.jobId,f.agent.id).status==="killed");await f.agent.whenIdle();
  const saved=backgroundResults(f)[0].data;
  expect(saved.job?.status).toBe("stopping");
  const queried=await f.ctx.tools.execute({agent:f.agent,name:"query_background_tool",callId:"query" as any,parent,signal,arguments:{tool_call_id:handle}});
  expect(queried.isError).toBe(false);
  expect(queried.value).toMatchObject({status:"finished",job:{status:"killed"},...saved.result});
  expect(f.ctx.jobs.list(f.agent.id).find(job=>job.kind==="bash")?.status).toBe("killed");
 }finally{await f.dispose();}
});

it("transfers real foreground-only Bash without changing its native timeout policy",async()=>{
 const f=await setup("after-seconds",0.01);
 try{
  await shell(f,false);
  f.adapter.handler=()=>f.adapter.requests.length===1?bashCall("printf 'direct\\n'; sleep 0.12; printf 'direct final\\n'",1000):response("done");
  f.agent.followup(user("run"));await f.agent.whenIdle();expect(receiptOf(f)).toBeDefined();
  await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();expect(JSON.stringify(backgroundResults(f)[0].data.result)).toContain("direct final");
 }finally{await f.dispose();}
});

it("preserves native queued-turn admission without treating queue input as steering",async()=>{
 const f=await setup("new-message",0);const gate=Promise.withResolvers<string>();let started=false;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{started=true;return gate.promise;}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");
  f.agent.followup(user("start"));await until(()=>started);f.agent.followup(user("queued later"));await new Promise(r=>setTimeout(r,15));
  expect(receiptOf(f)).toBeUndefined();expect(f.adapter.requests).toHaveLength(1);
  f.agent.steer(user("urgent now"));await f.agent.whenIdle();
  expect(JSON.stringify(f.adapter.requests[1])).toContain("urgent now");expect(JSON.stringify(f.adapter.requests[1])).toContain("queued later");
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="turn/start")).toHaveLength(2);
 }finally{gate.resolve("cleanup");await f.dispose();}
});

it.each(["empty", "nontext", "error"] as const)("durably returns %s canonical output and keeps queries repeatable",async(kind)=>{
 const f=await setup();const gate=Promise.withResolvers<void>();
 const image={type:"image" as const,offloaded:true as const,attachment:{attachmentId:AttachmentId("test-immutable-image"),mediaType:"image/png" as const,bytes:10,width:1,height:1,name:"background-image.png"}};
 try{
  f.adapter.resolveModel=async(provider,model)=>({provider,id:model,name:model,inputModalities:["text","image"]});
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:()=>kind==="nontext"?[image]:[]},async execute(){await gate.promise;if(kind==="error")throw new ToolNotFoundError("deliberate-missing");return "";}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("run"));await f.agent.whenIdle();
  gate.resolve();await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
  const record=backgroundResults(f)[0].data;
  if(kind==="empty")expect(record.result.content).toEqual([]);
  if(kind==="nontext"){expect(record.result.content).toEqual([image]);expect(JSON.stringify(f.adapter.requests.at(-1))).toContain("background-image.png");}
  if(kind==="error"){expect(record.result.isError).toBe(true);expect(record.result.error?.info?.code).toBe("UNKNOWN_TOOL");expect(JSON.stringify(f.adapter.requests.at(-1))).toContain("deliberate-missing");await until(()=>f.ctx.jobs.get(record.receipt.jobId,f.agent.id).status==="failed");}
  const query=()=>f.ctx.tools.execute({agent:f.agent,name:"query_background_tool",callId:"query" as any,signal:new AbortController().signal,arguments:{tool_call_id:backgroundHandle(record.receipt)}});
  expect(await query()).toEqual(await query());
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="user/message" && e.data.id===record.delivery.id)).toHaveLength(1);
 }finally{gate.resolve();await f.dispose();}
});

it("retains a stopped result for deliberate resume and rejects a copied owner's handle",async()=>{
 const f=await setup();const gate=Promise.withResolvers<void>();
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(_a,e){await new Promise<void>(r=>e.signal.addEventListener("abort",()=>r(),{once:true}));await gate.promise;return "cancelled final";}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("run"));await f.agent.whenIdle();
  const stop=f.agent.cancelAndJoin({kind:"parent"});gate.resolve();await stop;
  const record=backgroundResults(f)[0].data;expect(f.adapter.requests).toHaveLength(2);expect(f.agent.inbox.nextStep).toHaveLength(0);
  f.agent.steer(user("resume deliberately"));await f.agent.whenIdle();
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="user/message" && e.data.id===record.delivery.id)).toHaveLength(1);
  f.agent.steer(user("another message"));await f.agent.whenIdle();
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="user/message" && e.data.id===record.delivery.id)).toHaveLength(1);
  const {agent:other}=await f.ctx.agents.create({sessionId:SessionId("other-owner"),meta:{isSeeded:true},agentOptions:{provider:"test",model:"test"},seed:f.agent.session.snapshotEvents(),inheritedEventCount:f.agent.session.seq});
  const off=await bindBackground(f.ctx,other,{backgroundStrategy:"after-seconds",backgroundAfterSeconds:0.01});
  try{
   const result=await f.ctx.tools.execute({agent:other,name:"query_background_tool",callId:"foreign" as any,signal:new AbortController().signal,arguments:{tool_call_id:backgroundHandle(record.receipt)}});
   expect(result.isError).toBe(true);expect(JSON.stringify(result)).toContain("another Agent");
  }finally{await off();}
 }finally{gate.resolve();await f.dispose();}
});

it("joins surviving native children after the Bash root exits",async()=>{
 const f=await setup("after-seconds",0.01);
 try{
  await shell(f,false);
  f.adapter.handler=()=>f.adapter.requests.length===1?bashCall("sh -c 'trap \"sleep 0.15; exit 0\" TERM; while :; do sleep 0.02; done' & sleep 0.04; exit 0",1000):response("done");
  f.agent.followup(user("run"));await f.agent.whenIdle();expect(receiptOf(f)).toBeDefined();
  await new Promise(r=>setTimeout(r,70));expect(backgroundResults(f)).toHaveLength(0);
  let joined=false;const started=Date.now();const stop=f.agent.cancelAndJoin({kind:"parent"}).then(()=>{joined=true;});
  await new Promise(r=>setTimeout(r,40));expect(joined).toBe(false);await stop;expect(Date.now()-started).toBeGreaterThan(100);
 }finally{await f.dispose();}
});

it("retries a failed result flush on resume without retaining a false resource failure",async()=>{
 const f=await setup();const gate=Promise.withResolvers<string>();
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>gate.promise});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("run"));await f.agent.whenIdle();
  const original=f.ctx.sessions.flush.bind(f.ctx.sessions);let failed=false;
  const flush=vi.spyOn(f.ctx.sessions,"flush").mockImplementation(async(session)=>{if(!failed && session.snapshotEvents().some(e=>pluginRecordOf(e)?.type==="plugin:moa/background-result")){failed=true;throw new Error("transient storage failure");}return original(session);});
  gate.resolve("full real result");await until(()=>failed);await until(()=>f.ctx.jobs.get(receiptOf(f).jobId,f.agent.id).status!=="running");
  expect(f.adapter.requests).toHaveLength(2);
  expect(f.agent.moaHasPendingBackground).toBe(true);
  await f.agent.cancelAndJoin({kind:"parent"});expect(f.agent.moaAborting).toBe(false);
  f.agent.steer(user("retry after storage recovers"));await f.agent.whenIdle();flush.mockRestore();
  const record=backgroundResults(f)[0].data;expect(record.result.content).toEqual([{type:"text",text:"full real result"}]);
  expect(f.agent.session.snapshotEvents().filter(e=>e.type==="user/message" && e.data.id===record.delivery.id)).toHaveLength(1);
  expect(JSON.stringify(f.adapter.requests.at(-1))).toContain("full real result");
  expect(f.agent.moaHasPendingBackground).toBe(false);
 }finally{vi.restoreAllMocks();gate.resolve("cleanup");await f.dispose();}
});

it("restores a pending receipt with a missing process-local job as interrupted without rerunning work",async()=>{
 const f=await setup();const gate=Promise.withResolvers<string>();const ctx=new Context();let executed=0;
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},execute:()=>{executed++;return gate.promise;}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("run"));await f.agent.whenIdle();
  const saved=f.agent.session.snapshotEvents();
  await mountAgentLoopTestDependencies(ctx,{workingDirectory:true});await ctx.plugin(AgentLoop,{agents:[]});await ctx.plugin(Jobs);
  const adapter=new Adapter();ctx.llm.registerAdapter(["test"],adapter);
  const {agent}=await ctx.agents.create({sessionId:f.agent.id,seed:saved,agentOptions:{provider:"test",model:"test"}});
  let off=await bindBackground(ctx,agent,{backgroundStrategy:"after-seconds",backgroundAfterSeconds:0.01});await agent.whenIdle();
  const records=backgroundRecords(agent);expect(records).toHaveLength(1);
  expect(records[0].data.result).toMatchObject({isError:true,error:{info:{code:"MOA_BACKGROUND_UNAVAILABLE"}}});expect(executed).toBe(1);expect(ctx.jobs.list(agent.id)).toHaveLength(0);
  const messageId=records[0].data.delivery.id;expect(agent.session.snapshotEvents().filter(e=>e.type==="user/message" && e.data.id===messageId)).toHaveLength(1);
  await off();off=await bindBackground(ctx,agent,{backgroundStrategy:"after-seconds",backgroundAfterSeconds:0.01});await agent.whenIdle();
  expect(agent.session.snapshotEvents().filter(e=>e.type==="user/message" && e.data.id===messageId)).toHaveLength(1);await off();
 }finally{gate.resolve("old world cleanup");await f.dispose();await ctx.fiber.dispose();}
});

it("query timeout leaves work alive and cancel reports stopping until actual cleanup",async()=>{
 const f=await setup();const cleanup=Promise.withResolvers<void>();
 try{
  f.ctx.tools.register({name:"held",description:"held",parameters:{type:"object"},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:String(v)}]},async execute(_a,e){await new Promise<void>(r=>e.signal.addEventListener("abort",()=>r(),{once:true}));await cleanup.promise;return "resource cleanup completed";}});
  f.adapter.handler=()=>f.adapter.requests.length===1?calls("held"):response("done");f.agent.followup(user("run"));await f.agent.whenIdle();
  const receipt=receiptOf(f),handle=backgroundHandle(receipt),signal=new AbortController().signal;
  const query=(seconds=0)=>f.ctx.tools.execute({agent:f.agent,name:"query_background_tool",callId:"query" as any,signal,arguments:{tool_call_id:handle,wait_timeout:seconds}});
  const waiting=await query(0.01);expect(waiting.isError).toBe(false);expect(JSON.stringify(waiting)).toContain('"running"');
  const cancel=await f.ctx.tools.execute({agent:f.agent,name:"cancel_background_tool",callId:"cancel" as any,signal,arguments:{tool_call_id:handle}});
  expect(cancel.isError).toBe(false);expect(f.ctx.jobs.get(receipt.jobId,f.agent.id).status).toBe("stopping");
  expect(JSON.stringify(await query())).toContain('"stopping"');cleanup.resolve();await until(()=>backgroundResults(f).length===1);await f.agent.whenIdle();
  expect(f.ctx.jobs.get(receipt.jobId,f.agent.id).status).toBe("killed");const final=await query();expect(final.value).toMatchObject({status:"finished",job:{status:"killed"}});expect(final).toEqual(await query());
 }finally{cleanup.resolve();await f.dispose();}
});
