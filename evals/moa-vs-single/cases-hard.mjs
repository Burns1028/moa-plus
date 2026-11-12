import { gradeCode } from './cases-code.mjs';

const packageFile = name => JSON.stringify({ name, private: true, type: 'module', scripts: { test: 'node --test --test-isolation=none' } }, null, 2) + '\n';
const asyncChecks = String.raw`
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const bounded = async action => { let timer; try { return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Operation did not settle')),800)})]); } finally {clearTimeout(timer)} };
const verify = (name, action) => check(name, () => bounded(action));
`;

const cacheCase = {
  id: 'hard-concurrent-cache', title: '并发缓存的取消、失效与迟到结果', category: 'code', difficulty: 'hard', timeoutSeconds: 600,
  prompt: '修复这个异步缓存项目。当前实现会在并发取消、失效与迟到结果时出错。请依据README.md完整契约修复src/cache.mjs，保留createResolver接口，补充测试并运行。项目离线且无依赖；直接使用 node --test --test-isolation=none 运行测试。交付后简短说明。',
  files: {
    'package.json': packageFile('concurrent-cache-repair'),
    'README.md': String.raw`# Concurrent resolver

Node 24, no dependencies. Run node --test --test-isolation=none.
Export createResolver({load,ttlMs,maxEntries,now=Date.now}) from src/cache.mjs.
It returns {get(key,options={}),invalidate(key),clear(),get size()}.
load is called as load(key,{signal}), may return a value or promise, and may throw.
All public inputs described below are part of the contract.

Construction validates load/now are functions, ttlMs is a finite nonnegative
number, and maxEntries is a positive safe integer; invalid configuration throws
TypeError. Every get returns a promise, including validation failures. A key is
a nonempty string; options must be a non-null non-array object, and its optional
signal must be an AbortSignal. Invalid get inputs reject with TypeError.

For the same key, concurrent misses share one load but return independent
subscriber promises. Successful values are cached; failures are never cached.
A synchronous loader throw is a rejected get, not a synchronous get throw.
The same original loader error object is delivered to all live subscribers.

Subscribers cancel independently. An already-aborted signal rejects with an
error named AbortError without starting load or returning even a cached value.
Canceling one subscriber does not cancel the others. When the last live
subscriber cancels, abort the load's shared controller and immediately stop
coalescing new gets with that flight. A loader may ignore abort; its late value
must not be cached or replace/delete a newer flight. Remove subscriber abort
listeners at settlement. Abort is allowed to happen synchronously inside load.

TTL starts when load fulfills, using now() then. A value is fresh iff current
now() < fulfilledTime+ttlMs; equality is expired. ttlMs=0 prevents reuse after
settlement but still coalesces an in-flight load. Only settled cache entries
count toward size/capacity. size prunes expired entries. Cache is LRU: fresh
get hits and newly cached fulfillments are most recent; size does not refresh
recency. Evict the least recent settled entry when capacity is exceeded.

invalidate(key) removes that key's cached value and detaches its current flight
from new gets, but does not cancel existing subscribers. They still receive the
old result, which must not populate cache. A fresh get starts a new flight even
while the old one runs. clear() applies the same operation to every key.
These methods return undefined. Invalid invalidate keys throw TypeError.

Old-flight settlement must not remove a newer flight, overwrite a newer cached
value, or settle a subscriber of another generation. All calls and results are
per resolver instance; no global key or cancellation state is shared.
`,
    'src/cache.mjs': String.raw`export function createResolver({load,ttlMs,maxEntries,now=Date.now}) {
  const cache=new Map(), pending=new Map();
  return {
    get(key,{signal}={}) {
      if(cache.has(key)&&cache.get(key).until>=now()) return Promise.resolve(cache.get(key).value);
      if(pending.has(key)) return pending.get(key);
      const promise=Promise.resolve(load(key,{signal})).then(value=>{
        cache.set(key,{value,until:now()+ttlMs});
        if(cache.size>maxEntries) cache.delete(cache.keys().next().value);
        pending.delete(key); return value;
      });
      pending.set(key,promise);return promise;
    },
    invalidate(key){cache.delete(key)},
    clear(){cache.clear()},
    get size(){return cache.size},
  };
}
`,
    'test/cache.test.mjs': String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolver } from '../src/cache.mjs';
test('coalesces misses and caches a result',async()=>{
  let calls=0,release;const p=new Promise(r=>release=r);
  const c=createResolver({load:()=>{calls++;return p},ttlMs:10,maxEntries:2,now:()=>0});
  const a=c.get('a'),b=c.get('a');release(7);
  assert.deepEqual(await Promise.all([a,b]),[7,7]);assert.equal(calls,1);
});
test('expiry boundary is exclusive',async()=>{
  let t=0,n=0;const c=createResolver({load:()=>++n,ttlMs:10,maxEntries:2,now:()=>t});
  assert.equal(await c.get('a'),1);t=10;assert.equal(await c.get('a'),2);
});
test('already aborted subscriber rejects',async()=>{
  const ac=new AbortController();ac.abort();let n=0;
  const c=createResolver({load:()=>++n,ttlMs:10,maxEntries:2});
  await assert.rejects(c.get('a',{signal:ac.signal}),{name:'AbortError'});assert.equal(n,0);
});
`,
  },
  grade: ({ project }) => gradeCode(project, asyncChecks + String.raw`
const {createResolver: make}=await load('src/cache.mjs');
const config = fn => ({load:fn,ttlMs:10,maxEntries:2,now:()=>0});
await verify('construction-and-get-validation',async()=>{
  for(const extra of [{load:null},{now:4},{ttlMs:-1},{ttlMs:Infinity},{maxEntries:0},{maxEntries:1.5}]) assert.throws(()=>make({...config(()=>1),...extra}),TypeError);
  const c=make(config(()=>1));for(const key of ['',null,7]) await assert.rejects(c.get(key),TypeError);
  for(const options of [null,[],{signal:{}}]) await assert.rejects(c.get('a',options),TypeError);
  assert.throws(()=>c.invalidate(''),TypeError);
});
await verify('coalesces-independent-promises',async()=>{
  const d=deferred();let calls=0;const c=make(config(()=>{calls++;return d.promise}));
  const a=c.get('x'),b=c.get('x');assert.notEqual(a,b);await turn();assert.equal(calls,1);assert.equal(c.size,0);
  d.resolve(3);assert.deepEqual(await Promise.all([a,b]),[3,3]);assert.equal(c.size,1);assert.equal(await c.get('x'),3);assert.equal(calls,1);
});
await verify('one-abort-does-not-cancel-peer',async()=>{
  const d=deferred(),ac=new AbortController();let signal;const c=make(config((_,o)=>{signal=o.signal;return d.promise}));
  const a=c.get('x',{signal:ac.signal}),b=c.get('x');const rejection=assert.rejects(a,{name:'AbortError'});await turn();ac.abort();await rejection;
  assert.equal(signal.aborted,false);d.resolve(4);assert.equal(await b,4);assert.equal(await c.get('x'),4);
});
await verify('last-abort-ends-flight-for-new-subscribers',async()=>{
  const first=deferred(),second=deferred(),ac=new AbortController();let n=0,oldSignal;
  const c=make(config((_,o)=>{if(n++===0){oldSignal=o.signal;return first.promise}return second.promise}));
  const a=c.get('x',{signal:ac.signal});const rejected=assert.rejects(a,{name:'AbortError'});await turn();ac.abort();await rejected;
  assert.equal(oldSignal.aborted,true);const b=c.get('x');await turn();assert.equal(n,2);second.resolve('new');assert.equal(await b,'new');
  first.resolve('old');await turn();assert.equal(await c.get('x'),'new');
});
await verify('already-aborted-does-not-return-cache',async()=>{
  let n=0;const c=make(config(()=>++n));await c.get('x');const ac=new AbortController();ac.abort();await assert.rejects(c.get('x',{signal:ac.signal}),{name:'AbortError'});assert.equal(n,1);
});
await verify('abort-synchronously-inside-loader',async()=>{
  const ac=new AbortController();let shared;const d=deferred();const c=make(config((_,o)=>{shared=o.signal;ac.abort();return d.promise}));
  const p=c.get('x',{signal:ac.signal});await assert.rejects(p,{name:'AbortError'});assert.equal(shared.aborted,true);d.resolve('stale');await turn();assert.equal(c.size,0);
});
await verify('loader-errors-not-cached-and-preserve-identity',async()=>{
  const err=new Error('expected');let n=0;const d=deferred();const c=make(config(()=>++n===1?d.promise:8));
  const a=c.get('x'),b=c.get('x');const checks=Promise.all([assert.rejects(a,e=>e===err),assert.rejects(b,e=>e===err)]);d.reject(err);await checks;
  assert.equal(await c.get('x'),8);assert.equal(n,2);
});
await verify('synchronous-loader-error-is-rejection',async()=>{
  const err=new Error('sync');const c=make(config(()=>{throw err}));let p;assert.doesNotThrow(()=>{p=c.get('x')});await assert.rejects(p,e=>e===err);
});
await verify('ttl-starts-at-fulfillment-and-exclusive-boundary',async()=>{
  let t=0,n=0;const d=deferred();const c=make({...config(()=>++n===1?d.promise:n),now:()=>t});
  const p=c.get('x');t=50;d.resolve(1);await p;t=59;assert.equal(await c.get('x'),1);t=60;assert.equal(await c.get('x'),2);
});
await verify('zero-ttl-still-coalesces-pending',async()=>{
  let n=0;const d=deferred();const c=make({...config(()=>++n===1?d.promise:n),ttlMs:0});
  const a=c.get('x'),b=c.get('x');d.resolve(1);assert.deepEqual(await Promise.all([a,b]),[1,1]);assert.equal(c.size,0);assert.equal(await c.get('x'),2);
});
await verify('fresh-hit-updates-lru-not-insertion-order',async()=>{
  const calls=[];const c=make(config(key=>{calls.push(key);return key}));
  await c.get('a');await c.get('b');await c.get('a');await c.get('c');assert.equal(c.size,2);await c.get('a');await c.get('b');assert.deepEqual(calls,['a','b','c','b']);
});
await verify('size-prunes-expired-without-refreshing-recency',async()=>{
  let t=0;const c=make({...config(k=>k),now:()=>t});await c.get('a');t=5;await c.get('b');t=10;assert.equal(c.size,1);t=15;assert.equal(c.size,0);
});
await verify('invalidate-pending-keeps-old-waiter-but-detaches-generation',async()=>{
  const a=deferred(),b=deferred();let n=0;const c=make(config(()=>n++===0?a.promise:b.promise));
  const p=c.get('x');assert.equal(c.invalidate('x'),undefined);const q=c.get('x');b.resolve(2);assert.equal(await q,2);a.resolve(1);assert.equal(await p,1);assert.equal(await c.get('x'),2);assert.equal(n,2);
});
await verify('old-settlement-does-not-delete-new-pending',async()=>{
  const a=deferred(),b=deferred();let n=0;const c=make(config(()=>n++===0?a.promise:b.promise));
  const p=c.get('x');c.invalidate('x');const q=c.get('x');a.resolve(1);assert.equal(await p,1);const r=c.get('x');assert.equal(n,2);b.resolve(2);assert.deepEqual(await Promise.all([q,r]),[2,2]);
});
await verify('clear-detaches-all-flights-without-canceling-live-subscribers',async()=>{
  const ds=[deferred(),deferred(),deferred()];let n=0;const c=make(config(()=>ds[n++].promise));
  const a=c.get('a'),b=c.get('b');assert.equal(c.clear(),undefined);const fresh=c.get('a');ds[0].resolve(1);ds[1].resolve(2);assert.deepEqual(await Promise.all([a,b]),[1,2]);assert.equal(c.size,0);ds[2].resolve(3);assert.equal(await fresh,3);assert.equal(c.size,1);
});
await verify('settlement-removes-subscriber-listeners',async()=>{
  const {getEventListeners}=await import('node:events');const ac=new AbortController(),d=deferred();
  const before=getEventListeners(ac.signal,'abort').length;
  const c=make(config(()=>d.promise)),p=c.get('x',{signal:ac.signal});await turn();d.resolve(1);assert.equal(await p,1);
  assert.equal(getEventListeners(ac.signal,'abort').length,before);ac.abort();assert.equal(await c.get('x'),1);
});
await verify('separate-keys-and-resolvers-do-not-share-state',async()=>{
  const c=make(config(k=>k)),d=make(config(k=>'other-'+k));assert.equal(await c.get('__proto__'),'__proto__');assert.equal(await d.get('__proto__'),'other-__proto__');await c.get('toString');c.clear();assert.equal(d.size,1);
});
`),
};

const ledgerCase = {
  id: 'hard-journal-ledger', title: '事务账本的原子提交、去重与恢复', category: 'code', difficulty: 'hard', timeoutSeconds: 600,
  prompt: '修复这个多模块事务账本。当前实现存在部分更新、重复扣款、持久化失败后状态错误和恢复问题。请按README.md全部契约修改src/中的实现，保留四个公共接口，补充测试并运行。项目离线且无依赖；直接使用 node --test --test-isolation=none。最后简短说明交付和验证。',
  files: {
    'package.json': packageFile('journal-ledger-repair'),
    'README.md': String.raw`# Journal ledger

Node 24; no dependencies. Run node --test --test-isolation=none.
Money is integer cents; specified totals/intermediate results fit safe integers.
Account keys and transaction ids are nonblank strings (trim only to validate;
preserve original strings). Object keys such as __proto__ and constructor are valid.
Do not mutate caller inputs, even when a later validation or transaction fails.

## src/validate.mjs: normalizeEntries(entries)

entries is a nonempty array of {from,to,cents}. Both account names must be valid
strings, from!=to, cents must be a positive safe integer. Invalid shapes, names,
same-account entries and amounts throw TypeError. Extra properties are ignored.
Return a new array of fresh objects with exactly from,to,cents.

## src/fold.mjs: applyEntries(balances, entries)

balances is a non-null non-array object whose own enumerable keys are valid
account names and values are nonnegative safe integers. Invalid input throws
TypeError. Validate/normalize entries, then apply them sequentially to a private
copy. Both accounts must be own keys and the source must have sufficient funds
at that entry; either failure throws RangeError. Earlier incoming credits may
fund later entries. On success return a fresh plain object of all balances,
including zero balances. On any failure nothing outside the function changes.

## src/replay.mjs: replayJournal(initialBalances, records)

records is an array of {seq,id,entries}. A first unique record has seq=1; later
unique records must increment by exactly 1. seq is a positive safe integer;
id and entries follow the above validation. Apply each unique transaction.
A repeated physical record with the same seq, id and normalized entries is
ignored, even if extra properties differ. Reusing seq or id for a different
record, gaps, malformed records, unknown accounts or insufficient funds is a
corrupt journal: throw an Error with name JournalError. Invalid initialBalances
or non-array records throws TypeError. Never mutate inputs.
Return exactly {balances,receipts:[{id,seq}]} in unique journal order.

## src/ledger.mjs: createJournalLedger({balances,append,records=[]})

Construct synchronously from the initial balances and journal, without calling
append while replaying. append must be a function. Return methods:
commit(id,entries), snapshot(), getReceipt(id).
snapshot returns a fresh plain balance object; getReceipt returns a fresh
{id,seq} or undefined if that transaction has not durably committed.

Every commit returns a promise, including validation failures. Normalize and
copy its inputs when called, before waiting for earlier commits. Nonduplicate
commits execute in call order, with at most one append in flight. Evaluate each
against the last committed balances, and call append({seq,id,entries}) once
only after the entire transaction can succeed. seq is next durable sequence.
append may throw synchronously, return a value, or return a promise.

Only after append succeeds publish new balances/receipt and resolve commit.
While append is pending, snapshots and receipts still show committed state.
If validation, balance checks or append fail, no state/sequence/id is committed;
reject with the original error and keep the queue usable. A failed id can retry.
The next successful record still uses the next contiguous sequence number.

Calls with the same id and identical normalized entries, pending or committed,
share one durable transaction and return equivalent receipts without an extra
append. A valid but different transaction for a pending/committed id rejects
with an Error named ConflictError. Idempotency also applies to restored records.
All stored balances, entries and receipts must be independent of caller-owned
objects and of the record object retained by append. Mutating a returned
snapshot/receipt or a retained append record must not corrupt ledger state.
`,
    'src/validate.mjs': String.raw`export function normalizeEntries(entries) {
  return entries.map(entry=>({...entry}));
}
`,
    'src/fold.mjs': String.raw`export function applyEntries(balances,entries) {
  for(const e of entries){balances[e.from]-=e.cents;balances[e.to]+=e.cents;if(balances[e.from]<0)throw new RangeError('funds')}
  return balances;
}
`,
    'src/replay.mjs': String.raw`import {applyEntries} from './fold.mjs';
export function replayJournal(initialBalances,records){
  const balances={...initialBalances},receipts=[];
  for(const r of records){applyEntries(balances,r.entries);receipts.push({id:r.id,seq:r.seq})}
  return {balances,receipts};
}
`,
    'src/ledger.mjs': String.raw`import {applyEntries} from './fold.mjs';
import {replayJournal} from './replay.mjs';
export function createJournalLedger({balances,append,records=[]}){
  const restored=replayJournal(balances,records);let state=restored.balances,seq=records.length;const receipts=new Map(restored.receipts.map(r=>[r.id,r]));
  return {
    async commit(id,entries){state=applyEntries(state,entries);const r={seq:++seq,id,entries};await append(r);const receipt={id,seq};receipts.set(id,receipt);return receipt},
    snapshot(){return state},getReceipt(id){return receipts.get(id)},
  };
}
`,
    'test/ledger.test.mjs': String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEntries} from '../src/fold.mjs';
import {createJournalLedger} from '../src/ledger.mjs';
test('failed multi-entry transaction is atomic',()=>{
  const initial={a:50,b:0,c:0};assert.throws(()=>applyEntries(initial,[{from:'a',to:'b',cents:30},{from:'b',to:'c',cents:50}]),RangeError);assert.deepEqual(initial,{a:50,b:0,c:0});
});
test('duplicate delivery commits once',async()=>{
  const rows=[],l=createJournalLedger({balances:{a:50,b:0},append:r=>rows.push(r)}),e=[{from:'a',to:'b',cents:10}];
  await l.commit('x',e);await l.commit('x',e);assert.equal(rows.length,1);assert.deepEqual(l.snapshot(),{a:40,b:10});
});
test('append failure does not publish balances',async()=>{
  const l=createJournalLedger({balances:{a:50,b:0},append:()=>{throw new Error('disk')}});await assert.rejects(l.commit('x',[{from:'a',to:'b',cents:10}]));assert.deepEqual(l.snapshot(),{a:50,b:0});
});
`,
  },
  grade: ({ project }) => gradeCode(project, asyncChecks + String.raw`
const {normalizeEntries:norm}=await load('src/validate.mjs');
const {applyEntries:apply}=await load('src/fold.mjs');
const {replayJournal:replay}=await load('src/replay.mjs');
const {createJournalLedger:make}=await load('src/ledger.mjs');
const entries=(from='a',to='b',cents=10)=>[{from,to,cents}];
const record=(seq,id,es=entries())=>({seq,id,entries:es});
await verify('normalization-validates-and-clones',()=>{
  const input=[{from:' a ',to:'b',cents:2,extra:true}],out=norm(input);assert.deepEqual(out,[{from:' a ',to:'b',cents:2}]);assert.notEqual(out,input);assert.notEqual(out[0],input[0]);
  for(const value of [null,[],[null],[{}],entries('a','a'),entries('','b'),entries('a','b',0),entries('a','b',1.2),entries('a','b','1')])assert.throws(()=>norm(value),TypeError);
});
await verify('apply-sequential-credits-without-mutation',()=>{
  const initial={a:50,b:0,c:0},es=[...entries('a','b',30),...entries('b','c',20)];const before=JSON.stringify([initial,es]);assert.deepEqual(apply(initial,es),{a:20,b:10,c:20});assert.equal(JSON.stringify([initial,es]),before);
});
await verify('apply-atomic-on-late-failure',()=>{
  const initial={a:50,b:0,c:0};assert.throws(()=>apply(initial,[...entries('a','b',30),...entries('b','c',40)]),RangeError);assert.deepEqual(initial,{a:50,b:0,c:0});assert.throws(()=>apply(initial,entries('missing','b')),RangeError);
});
await verify('balance-validation-and-own-account-keys',()=>{
  for(const value of [null,[],{a:-1},{a:1.2},{a:'5'}])assert.throws(()=>apply(value,entries()),TypeError);
  const initial=JSON.parse('{"__proto__":20,"constructor":0}');assert.deepEqual(apply(initial,entries('__proto__','constructor',3)),JSON.parse('{"__proto__":17,"constructor":3}'));
  assert.throws(()=>apply({a:10},entries('a','toString',1)),RangeError);
});
await verify('replay-idempotent-physical-duplicate',()=>{
  const a=record(1,'x'),b=record(2,'y',entries('b','a',5)),rows=[a,{...a,extra:1},b];const before=JSON.stringify(rows);
  assert.deepEqual(replay({a:50,b:0},rows),{balances:{a:45,b:5},receipts:[{id:'x',seq:1},{id:'y',seq:2}]});assert.equal(JSON.stringify(rows),before);
});
await verify('replay-rejects-conflicts-gaps-and-invalid-records',()=>{
  for(const rows of [[record(2,'x')],[record(1,'x'),record(3,'y')],[record(1,'x'),record(1,'y')],[record(1,'x'),record(2,'x')],[record(1,'x'),record(1,'x',entries('a','b',11))],[{seq:1,id:'x',entries:[]}],[record(1,'x',entries('missing','b'))],[record(1,'x',entries('a','b',51))]])assert.throws(()=>replay({a:50,b:0},rows),e=>e.name==='JournalError');
});
await verify('constructor-replays-without-append',()=>{
  let n=0;const l=make({balances:{a:50,b:0},records:[record(1,'x')],append:()=>n++});assert.equal(n,0);assert.deepEqual(l.snapshot(),{a:40,b:10});assert.deepEqual(l.getReceipt('x'),{id:'x',seq:1});assert.throws(()=>make({balances:{a:1},append:null}),TypeError);
});
await verify('commit-promises-for-invalid-input',async()=>{
  const l=make({balances:{a:50,b:0},append:()=>{}});for(const [id,es]of [[null,entries()],['',entries()],['x',[]],['x',entries('a','a')]]){let p;assert.doesNotThrow(()=>{p=l.commit(id,es)});assert.ok(p&&typeof p.then==='function');await assert.rejects(p,TypeError)}
});
await verify('durability-before-visible-state',async()=>{
  const d=deferred(),rows=[];const l=make({balances:{a:50,b:0},append:r=>{rows.push(r);return d.promise}});
  const p=l.commit('x',entries());await turn();assert.equal(rows.length,1);assert.deepEqual(l.snapshot(),{a:50,b:0});assert.equal(l.getReceipt('x'),undefined);d.resolve();assert.deepEqual(await p,{id:'x',seq:1});assert.deepEqual(l.snapshot(),{a:40,b:10});
});
await verify('queued-transactions-use-latest-committed-state',async()=>{
  const a=deferred(),b=deferred(),rows=[];const l=make({balances:{a:50,b:0,c:0},append:r=>{rows.push(r);return rows.length===1?a.promise:b.promise}});
  const p=l.commit('x',entries('a','b',30)),q=l.commit('y',entries('b','c',20));await turn();assert.equal(rows.length,1);a.resolve();await p;await turn();assert.equal(rows.length,2);assert.deepEqual(l.snapshot(),{a:20,b:30,c:0});b.resolve();await q;assert.deepEqual(l.snapshot(),{a:20,b:10,c:20});assert.deepEqual(rows.map(r=>r.seq),[1,2]);
});
await verify('pending-identical-id-coalesces',async()=>{
  const d=deferred();let n=0;const l=make({balances:{a:50,b:0},append:()=>{n++;return d.promise}});const p=l.commit('x',entries()),q=l.commit('x',entries());await turn();assert.equal(n,1);d.resolve();assert.deepEqual(await Promise.all([p,q]),[{id:'x',seq:1},{id:'x',seq:1}]);assert.deepEqual(l.snapshot(),{a:40,b:10});
});
await verify('conflicting-pending-and-committed-ids-rejected',async()=>{
  const d=deferred();const l=make({balances:{a:50,b:0},append:()=>d.promise});const p=l.commit('x',entries());await assert.rejects(l.commit('x',entries('a','b',11)),e=>e.name==='ConflictError');d.resolve();await p;await assert.rejects(l.commit('x',entries('a','b',12)),e=>e.name==='ConflictError');
});
await verify('append-rejection-rolls-back-and-releases-id',async()=>{
  const err=new Error('disk'),rows=[];let first=true;const l=make({balances:{a:50,b:0},append:r=>{rows.push(r);if(first){first=false;return Promise.reject(err)}}});
  await assert.rejects(l.commit('x',entries()),e=>e===err);assert.deepEqual(l.snapshot(),{a:50,b:0});assert.equal(l.getReceipt('x'),undefined);assert.deepEqual(await l.commit('x',entries('a','b',15)),{id:'x',seq:1});assert.deepEqual(rows.map(r=>r.seq),[1,1]);
});
await verify('failed-transaction-does-not-poison-queue',async()=>{
  const rows=[];const l=make({balances:{a:50,b:0,c:0},append:r=>rows.push(r)});const bad=l.commit('bad',[...entries('a','b',30),...entries('b','c',40)]);const rejected=assert.rejects(bad,RangeError);const good=l.commit('ok',entries('a','c',50));await rejected;assert.deepEqual(await good,{id:'ok',seq:1});assert.deepEqual(l.snapshot(),{a:0,b:0,c:50});assert.equal(rows.length,1);
});
await verify('synchronous-append-error-preserved-and-queue-continues',async()=>{
  const err=new Error('sync');let n=0;const l=make({balances:{a:50,b:0},append:()=>{if(n++===0)throw err}});await assert.rejects(l.commit('x',entries()),e=>e===err);assert.deepEqual(await l.commit('y',entries()),{id:'y',seq:1});
});
await verify('inputs-copied-before-queue-wait',async()=>{
  const d=deferred();let n=0;const l=make({balances:{a:50,b:0,c:0},append:()=>++n===1?d.promise:undefined});const a=l.commit('x',entries('a','b',30)),es=entries('b','c',10),b=l.commit('y',es);es[0].cents=999;es.push(...entries('a','c',999));d.resolve();await Promise.all([a,b]);assert.deepEqual(l.snapshot(),{a:20,b:20,c:10});
});
await verify('external-mutations-do-not-corrupt-state-or-idempotency',async()=>{
  const tryMutation=action=>{try{action()}catch{}};
  let retained;const initial={a:50,b:0};const l=make({balances:initial,append:r=>{retained=r}});const es=entries(),receipt=await l.commit('x',es);initial.a=999;es[0].cents=999;tryMutation(()=>{receipt.seq=99});const snap=l.snapshot();assert.notEqual(snap,l.snapshot());tryMutation(()=>{snap.a=888});const own=l.getReceipt('x');assert.notEqual(own,l.getReceipt('x'));tryMutation(()=>{own.seq=88});tryMutation(()=>{retained.entries[0].cents=777;retained.id='other'});
  assert.deepEqual(l.snapshot(),{a:40,b:10});assert.deepEqual(l.getReceipt('x'),{id:'x',seq:1});assert.deepEqual(await l.commit('x',entries()),{id:'x',seq:1});
});
await verify('restored-idempotency-and-next-sequence',async()=>{
  const rows=[];const l=make({balances:{a:50,b:0},records:[record(1,'x'),record(1,'x')],append:r=>rows.push(r)});assert.deepEqual(await l.commit('x',entries()),{id:'x',seq:1});assert.equal(rows.length,0);await assert.rejects(l.commit('x',entries('a','b',11)),e=>e.name==='ConflictError');assert.deepEqual(await l.commit('y',entries('b','a',5)),{id:'y',seq:2});assert.equal(rows[0].seq,2);assert.deepEqual(l.snapshot(),{a:45,b:5});
});
`),
};

export const hardCases = [cacheCase, ledgerCase];
