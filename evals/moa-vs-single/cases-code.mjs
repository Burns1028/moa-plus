/**
 * Offline, outcome-scored coding cases. Only `files` and `prompt` are copied into
 * an agent's workspace. This module and its hidden checks stay outside it.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

async function gradeCode(project, source) {
  const script = `
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const project = ${JSON.stringify(resolve(project))};
const load = p => import(pathToFileURL(join(project, p)).href);
const node = args => execFileSync(process.execPath, args, { cwd: project, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
const checks = [];
async function check(name, action) {
  try { await action(); checks.push({name, passed: true}); }
  catch (error) { checks.push({name, passed: false, detail: String(error?.message ?? error).slice(0, 1200)}); }
}
try { ${source} }
catch (error) { checks.push({ name: 'module-load-and-grader', passed: false, detail: String(error?.message ?? error).slice(0, 1200) }); }
console.log('__MOA_GRADE__' + JSON.stringify(checks));
`;
  return await new Promise(resolveResult => {
    const child = spawn(process.execPath, ['--input-type=module', '-'], {
      cwd: project, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20_000);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-1_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-10_000); });
    child.stdin.on('error', () => {});
    child.on('error', error => {
      clearTimeout(timer);
      resolveResult({ score: 0, checks: [{ name: 'grader-execution', passed: false, detail: error.message }] });
    });
    child.on('close', code => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).findLast(row => row.startsWith('__MOA_GRADE__'));
      let checks;
      try { checks = JSON.parse(line.slice('__MOA_GRADE__'.length)); } catch {}
      if (timedOut || code !== 0 || !Array.isArray(checks) || !checks.length) {
        resolveResult({ score: 0, checks: [{ name: 'grader-execution', passed: false,
          detail: timedOut ? 'Hidden checks exceeded 20 seconds.' : `exit=${code}; ${stderr.slice(-1200)}` }] });
      } else {
        resolveResult({ score: Math.round(100 * checks.filter(c => c.passed).length / checks.length), checks });
      }
    });
    child.stdin.end(script);
  });
}

const packageFile = name => JSON.stringify({ name, private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n';

const csvCase = {
  id: 'code-csv-boundaries',
  title: '修复 CSV 导入导出的边界问题',
  category: 'code',
  timeoutSeconds: 420,
  prompt: '这个离线 Node 项目的 CSV 导入导出在真实数据上会损坏字段。请按 README.md 的全部契约修复 src/csv.mjs，保留 parseCsv、stringifyCsv 两个导出，补充你认为必要的测试并运行。不能安装依赖。完成后简短说明修复和验证结果。',
  files: {
    'package.json': packageFile('csv-boundary-repair'),
    'README.md': String.raw`# CSV importer/exporter

Node 24, no dependencies. Run npm test. Public API: src/csv.mjs exports
parseCsv(text) and stringifyCsv(rows). Do not change their names/signatures.

## Complete contract

parseCsv accepts a string and returns an array of rows, each an array of strings.
An empty input returns []. Strip one optional leading UTF-8 BOM character.
Outside quotes, comma separates fields and LF, CRLF or a bare CR separates rows.
A final row separator ends the last row; it does not add another row. A blank
record is one empty field. Preserve empty fields, spaces and all field content.
An opening double quote is permitted only at the start of a field. Inside a
quoted field, commas/newlines are data and two double quotes decode to one.
After its closing quote only comma, row separator or end of input is valid.
Throw SyntaxError for an unterminated quote, a quote inside an unquoted field,
or non-delimiter text after a closing quote. A non-string input throws TypeError.

stringifyCsv accepts an array of nonempty arrays of strings. Ragged row widths
are allowed. Invalid shapes or non-string cells throw TypeError; do not coerce.
[] serializes to an empty string. Always quote an empty field, and quote fields
containing comma, quote, CR or LF. Double each embedded quote. Other fields stay
unquoted. Separate records with CRLF, with no terminal separator and no BOM.
Neither API mutates its argument. Every valid rows value must round-trip through
parseCsv(stringifyCsv(rows)) without changing any strings or row boundaries.
`,
    'src/csv.mjs': String.raw`export function parseCsv(text) {
  if (!text) return [];
  return text.trim().split('\n').map(line => line.split(',').map(cell => cell.trim()));
}

export function stringifyCsv(rows) {
  return rows.map(row => row.join(',')).join('\n');
}
`,
    'test/csv.test.mjs': String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, stringifyCsv } from '../src/csv.mjs';

test('basic rows', () => assert.deepEqual(parseCsv('a,b\nc,d'), [['a','b'],['c','d']]));
test('quoted commas and quotes', () => assert.deepEqual(parseCsv('"a,b","say ""hi"""'), [['a,b','say "hi"']]));
test('serializer preserves row identity', () => {
  const rows = [['', ' x '], ['a\nb', '"']];
  assert.deepEqual(parseCsv(stringifyCsv(rows)), rows);
});
`,
  },
  grade: ({ project }) => gradeCode(project, String.raw`
const { parseCsv: parse, stringifyCsv: print } = await load('src/csv.mjs');
await check('plain-records-and-spaces', () => assert.deepEqual(parse(' a , b \nc,d'), [[' a ',' b '],['c','d']]));
await check('empty-input-and-leading-bom', () => {
  assert.deepEqual(parse(''), []); assert.deepEqual(parse('\uFEFF'), []);
  assert.deepEqual(parse('\uFEFFx,y'), [['x','y']]);
});
await check('all-record-separators', () => assert.deepEqual(parse('a,b\r\nc,d\re,f\ng,h\r\n'), [['a','b'],['c','d'],['e','f'],['g','h']]));
await check('empty-fields-and-blank-records', () => {
  assert.deepEqual(parse(',a,\n\n,,\n'), [['','a',''],[''],['','','']]);
  assert.deepEqual(parse('\n'), [['']]);
});
await check('quoted-delimiters-and-escaped-quotes', () => assert.deepEqual(parse('"a,b","""x""",tail'), [['a,b','"x"','tail']]));
await check('quoted-multiline-is-preserved', () => assert.deepEqual(parse('id,text\r\n1,"a\r\nb\nc\rd"\r\n'), [['id','text'],['1','a\r\nb\nc\rd']]));
await check('strict-quote-errors', () => {
  for (const value of ['a"b,c', '"unclosed', '"x"z,y', '"x" ,y']) assert.throws(() => parse(value), SyntaxError);
});
await check('parse-input-types', () => {
  for (const value of [null, undefined, 0, false, [], {}]) assert.throws(() => parse(value), TypeError);
});
await check('canonical-serialization', () => assert.equal(print([['', 'plain', ' a ', 'a,b', 'say "hi"', 'a\nb'], ['x']]), '"",plain, a ,"a,b","say ""hi""","a\nb"\r\nx'));
await check('serialization-shapes-and-types', () => {
  for (const value of [null, {}, [1], [[]], [[2]], [['ok',null]], 'text']) assert.throws(() => print(value), TypeError);
  assert.equal(print([]), '');
});
await check('roundtrip-ragged-and-empty-records', () => {
  const rows = [[''],['',''],[' x ','\r','\n','\r\n',',','"','""','\uFEFFlater'],['last']];
  assert.deepEqual(parse(print(rows)), rows);
});
await check('roundtrip-generated-nonmutation', () => {
  const atoms = ['', 'alpha', ' ', '你好', 'a,b', 'a"b', 'a\nb', 'a\rb'];
  const rows = Array.from({length:31}, (_,i) => Array.from({length:i%5+1}, (_,j) => atoms[(i*7+j*3)%atoms.length]));
  const before = JSON.stringify(rows); assert.deepEqual(parse(print(rows)), rows); assert.equal(JSON.stringify(rows), before);
});
`),
};

const billingCase = {
  id: 'code-usage-invoice',
  title: '实现去重、阶梯计价和账单汇总',
  category: 'code',
  timeoutSeconds: 420,
  prompt: '请完成这个离线 Node 项目的用量账单功能。README.md 定义了聚合、计价和发票的完整契约；实现 src/usage.mjs、src/pricing.mjs、src/invoice.mjs，保留公共接口。不要安装依赖。请补充测试并运行，最后简短说明交付和验证。',
  files: {
    'package.json': packageFile('usage-invoice-feature'),
    'README.md': String.raw`# Usage invoice feature

Node 24; no dependencies; npm test. All money values are integer cents.
Implement the three existing public APIs without changing exports/signatures.
No API may mutate input arrays, objects or events. Invalid input throws TypeError.
All specified numeric inputs are nonnegative safe integers (including zero).
For this exercise test values and calculated totals fit within safe integers.

## src/usage.mjs: aggregateEvents(events)

events is an array of {id, account, service, units}. id/account must be nonempty
strings after trimming for validation, but preserve original nonblank strings as
identifiers (do not normalize them). service is exactly compute or storage.
Deduplicate by id across the entire array. An identical duplicate's four public
fields is ignored. A duplicate id with any differing account/service/units throws.
Unrecognized extra event properties have no meaning for duplicate comparison.
Return [{account, compute, storage}], one entry per account even for zero units,
sorted by account using JS string comparison (a < b). Missing service totals are 0.

## src/pricing.mjs: priceUsage(usage)

usage is an object with optional compute/storage totals, each defaults to 0 only
when missing (undefined). Validate them as nonnegative safe integers.
Every account independently gets its first 10 compute units and 100 storage units
free. Of excess compute units, first 20 cost 7 cents each, remaining cost 5 cents
each. Of excess storage units, first 200 cost 2 cents each, remaining cost 1 cent
each. Return exactly {computeCents, storageCents, totalCents}.

## src/invoice.mjs: buildInvoice(events, options = {})

Use aggregateEvents and priceUsage to produce an invoice. options is an object;
options.credits defaults to {} when undefined and must be an object mapping
account strings to nonnegative safe integer cents. Validate all supplied credit
values, including keys with no usage. options.taxBps defaults to 0 only when
undefined, and must be an integer from 0 through 10000 inclusive. Null or arrays
are not valid options, usage or credits objects. Ignore unspecified extra fields.

For each account, subtotal = priced compute + priced storage. Applied credit is
min(account's supplied credit or 0, subtotal). Tax is on subtotal after credit,
rounded half-up to the nearest integer cent, using basis points (10000 = 100%).
Return exactly:
{ accounts: [{ account, usage: {compute,storage}, computeCents, storageCents,
              subtotalCents, creditCents, taxCents, totalCents }], totalCents }
Account ordering matches aggregateEvents. No account is created solely by a credit.
An empty event list returns {accounts:[],totalCents:0}, after validating options.
`,
    'src/usage.mjs': String.raw`export function aggregateEvents(events) {
  const accounts = {};
  for (const event of events) {
    accounts[event.account] ??= {account:event.account, compute:0, storage:0};
    accounts[event.account][event.service] += event.units;
  }
  return Object.values(accounts);
}
`,
    'src/pricing.mjs': String.raw`export function priceUsage(usage) {
  return {computeCents:(usage.compute ?? 0)*7, storageCents:(usage.storage ?? 0)*2,
    totalCents:(usage.compute ?? 0)*7+(usage.storage ?? 0)*2};
}
`,
    'src/invoice.mjs': String.raw`import { aggregateEvents } from './usage.mjs';
import { priceUsage } from './pricing.mjs';
export function buildInvoice(events, options = {}) {
  throw new Error('Invoice feature not implemented');
}
`,
    'test/invoice.test.mjs': String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEvents } from '../src/usage.mjs';
import { priceUsage } from '../src/pricing.mjs';
import { buildInvoice } from '../src/invoice.mjs';

test('free allowance and first compute tier', () => {
  assert.deepEqual(priceUsage({compute:12,storage:100}), {computeCents:14,storageCents:0,totalCents:14});
});
test('duplicate delivery is ignored', () => {
  const event = {id:'x',account:'a',service:'compute',units:12};
  assert.deepEqual(aggregateEvents([event,{...event}]), [{account:'a',compute:12,storage:0}]);
});
test('credit precedes tax', () => {
  assert.deepEqual(buildInvoice([{id:'x',account:'a',service:'compute',units:12}], {credits:{a:4},taxBps:500}), {
    accounts:[{account:'a',usage:{compute:12,storage:0},computeCents:14,storageCents:0,subtotalCents:14,creditCents:4,taxCents:1,totalCents:11}], totalCents:11,
  });
});
`,
  },
  grade: ({ project }) => gradeCode(project, String.raw`
const { aggregateEvents: aggregate } = await load('src/usage.mjs');
const { priceUsage: price } = await load('src/pricing.mjs');
const { buildInvoice: invoice } = await load('src/invoice.mjs');
const event = (id,account,service,units) => ({id,account,service,units});
await check('aggregate-order-and-services', () => assert.deepEqual(aggregate([
  event('1','z','compute',7), event('2','a','storage',11), event('3','a','compute',2), event('4','z','compute',4), event('5','empty','storage',0)
]), [{account:'a',compute:2,storage:11},{account:'empty',compute:0,storage:0},{account:'z',compute:11,storage:0}]));
await check('duplicates-ignore-extras-and-do-not-mutate', () => {
  const a = event('x','a','compute',12); const events = [a,{...a,extra:1},event('y','a','storage',4),a];
  const before = JSON.stringify(events); assert.deepEqual(aggregate(events), [{account:'a',compute:12,storage:4}]); assert.equal(JSON.stringify(events), before);
});
await check('conflicting-duplicate-rejected', () => {
  const a = event('x','a','compute',12);
  for (const change of [{account:'b'},{service:'storage'},{units:13}]) assert.throws(() => aggregate([a,{...a,...change}]),TypeError);
});
await check('event-validation', () => {
  for (const value of [null,{},[null],[{}],[event('','a','compute',1)],[event('x',' ','compute',1)],[event('x','a','other',1)],[event('x','a','compute',-1)],[event('x','a','compute',1.2)],[event('x','a','compute','3')]]) assert.throws(() => aggregate(value),TypeError);
});
await check('identifiers-are-keys-not-object-properties', () => {
  // A broken {}-based accumulator may mutate Object.prototype through __proto__.
  // Restore it so that one failure cannot contaminate unrelated pricing checks.
  const descriptors=Object.getOwnPropertyDescriptors(Object.prototype);
  try {
    assert.deepEqual(aggregate([
      event('toString','__proto__','storage',1), event('constructor',' a ','compute',1), event(' x ','a','compute',2), event('x','a','compute',3)
    ]), [{account:' a ',compute:1,storage:0},{account:'__proto__',compute:0,storage:1},{account:'a',compute:5,storage:0}]);
  } finally {
    for(const key of Reflect.ownKeys(Object.prototype)) if(!Object.hasOwn(descriptors,key)) delete Object.prototype[key];
    Object.defineProperties(Object.prototype,descriptors);
  }
});
await check('price-free-and-tier-boundaries', () => {
  assert.deepEqual(price({}), {computeCents:0,storageCents:0,totalCents:0});
  for (const [compute,computeCents] of [[0,0],[10,0],[11,7],[30,140],[31,145],[50,240]]) assert.deepEqual(price({compute}), {computeCents,storageCents:0,totalCents:computeCents});
  for (const [storage,storageCents] of [[100,0],[101,2],[300,400],[301,401]]) assert.deepEqual(price({storage}), {computeCents:0,storageCents,totalCents:storageCents});
});
await check('usage-validation', () => {
  for (const value of [null,[],3,{compute:null},{compute:-1},{compute:1.1},{storage:'1'},{storage:NaN},{compute:Number.MAX_SAFE_INTEGER+1}]) assert.throws(() => price(value),TypeError);
});
await check('invoice-credit-before-tax-half-up', () => assert.deepEqual(invoice([event('1','a','compute',12)],{credits:{a:4},taxBps:500}), {
  accounts:[{account:'a',usage:{compute:12,storage:0},computeCents:14,storageCents:0,subtotalCents:14,creditCents:4,taxCents:1,totalCents:11}],totalCents:11
}));
await check('credits-cap-and-unknown-account-does-not-create-row', () => assert.deepEqual(invoice([event('1','a','compute',11)],{credits:{a:100,unused:10},taxBps:10000}), {
  accounts:[{account:'a',usage:{compute:11,storage:0},computeCents:7,storageCents:0,subtotalCents:7,creditCents:7,taxCents:0,totalCents:0}],totalCents:0
}));
await check('invoice-combines-accounts-and-deduplicates', () => {
  const a = event('1','b','compute',31); const b = event('2','a','storage',301);
  assert.deepEqual(invoice([a,b,a],{credits:{a:1},taxBps:750}), {
    accounts:[{account:'a',usage:{compute:0,storage:301},computeCents:0,storageCents:401,subtotalCents:401,creditCents:1,taxCents:30,totalCents:430},
    {account:'b',usage:{compute:31,storage:0},computeCents:145,storageCents:0,subtotalCents:145,creditCents:0,taxCents:11,totalCents:156}],totalCents:586
  });
});
await check('invoice-options-validated-even-with-no-events', () => {
  for (const options of [null,[],{taxBps:null},{taxBps:-1},{taxBps:10001},{taxBps:0.5},{credits:null},{credits:[]},{credits:{unused:-1}},{credits:{unused:'2'}}]) assert.throws(() => invoice([],options),TypeError);
  assert.deepEqual(invoice([]), {accounts:[],totalCents:0});
});
await check('invoice-empty-zero-and-no-mutation', () => {
  const events = [event('1','z','compute',0),event('2','a','storage',100)]; const opts = {credits:{z:20},taxBps:123};
  const before = JSON.stringify([events,opts]);
  assert.deepEqual(invoice(events,opts), {accounts:[{account:'a',usage:{compute:0,storage:100},computeCents:0,storageCents:0,subtotalCents:0,creditCents:0,taxCents:0,totalCents:0},{account:'z',usage:{compute:0,storage:0},computeCents:0,storageCents:0,subtotalCents:0,creditCents:0,taxCents:0,totalCents:0}],totalCents:0});
  assert.equal(JSON.stringify([events,opts]), before);
});
await check('generated-invoices-match-published-formulas', () => {
  const events = [], credits = {}, expected = [];
  for (let i=0;i<16;i++) {
    const account='acct-'+String(i).padStart(2,'0'), compute=i*7, storage=i*43;
    events.push(event('c'+i,account,'compute',compute),event('s'+i,account,'storage',storage));
    credits[account]=i*3;
    const c=Math.min(Math.max(compute-10,0),20)*7+Math.max(compute-30,0)*5;
    const s=Math.min(Math.max(storage-100,0),200)*2+Math.max(storage-300,0);
    const creditCents=Math.min(c+s,credits[account]); const taxCents=Math.floor(((c+s-creditCents)*825+5000)/10000);
    expected.push({account,usage:{compute,storage},computeCents:c,storageCents:s,subtotalCents:c+s,creditCents,taxCents,totalCents:c+s-creditCents+taxCents});
  }
  assert.deepEqual(invoice(events.reverse(),{credits,taxBps:825}), {accounts:expected,totalCents:expected.reduce((n,row)=>n+row.totalCents,0)});
});
`),
};

const graphCase = {
  id: 'code-incremental-build',
  title: '修复增量构建的依赖计划和命令行',
  category: 'code',
  timeoutSeconds: 420,
  prompt: '这个离线构建计划工具漏掉了依赖和间接受影响任务，CLI 也没实现筛选。请依据 README.md 修复 src/graph.mjs 和 src/cli.mjs，保留两个导出的接口并实现命令行契约。无需真的执行构建命令，不要安装依赖。请补充测试并运行，完成后简短报告。',
  files: {
    'package.json': packageFile('incremental-build-planner'),
    'README.md': String.raw`# Incremental build planner

Node 24, no dependencies. npm test. The tool plans tasks; it must never execute
arbitrary commands from a manifest. src/graph.mjs exports planBuild(manifest,
targets?) and affectedTasks(manifest,changedFiles). Preserve both APIs.

## Manifest and validation

A manifest is {tasks:{taskName:{deps?:string[],inputs?:string[]}}}. Tasks is an
object, not null/array, and each task definition is an object, not null/array.
Task names and every deps/inputs member are nonempty strings. Whitespace-only
strings are invalid; otherwise preserve exact names/paths without normalization.
Missing deps/inputs default to []; supplied values must be arrays of valid strings.
Duplicate deps/inputs are ignored. Unknown dependency names and dependency cycles
(including self-cycles) are errors. Validate the COMPLETE manifest before either
API returns, even when an invalid task is unreachable from requested targets.
Unknown extra manifest/task fields are ignored. All contract errors throw Error
or a subclass. Inputs and manifests must not be mutated.

## planBuild

targets defaults to every task when undefined. Otherwise it must be an array of
valid known task names; duplicates are ignored. [] means no work. Include every
transitive dependency of the selected targets (but no unrelated dependents).
Return an array of waves, each a sorted array of task names, such that all nodes
with no remaining dependency run together in the earliest possible wave. A task
must appear after all of its dependencies. Use JS string comparison for ordering.
Empty plans have no waves, not a single empty wave.

## affectedTasks

changedFiles must be an array of valid nonblank strings; duplicates are ignored.
A task is directly affected when one of its inputs exactly equals a changed file.
Return all directly affected tasks AND all transitive dependent tasks, sorted.
Do not add dependencies solely because a dependent task is affected. No match
returns []. Dependencies needed to build affected tasks are added by planBuild.

## CLI

node src/cli.mjs path/to/manifest.json [--targets=a,b | --changed=file1,file2]
The filename is required. At most one filter flag is allowed. Reject unknown flags,
duplicate flags, extra positionals, empty comma-separated names and missing files.
No filter selects all task names. --targets selects the supplied unique names.
--changed selects affectedTasks. Output one JSON object to stdout on success:
{targets:[sorted selected task names],waves:planBuild(manifest,selected)}
This is selected targets, not their dependency closure. End with a newline.
Successful exit code is 0; an input/argument/read/JSON/graph error exits 2 with
no stdout and a short nonempty stderr message, without a JavaScript stack trace.
`,
    'src/graph.mjs': String.raw`export function planBuild(manifest, targets = Object.keys(manifest.tasks)) {
  return [targets];
}

export function affectedTasks(manifest, changedFiles) {
  return Object.keys(manifest.tasks).filter(name => (manifest.tasks[name].inputs ?? []).some(path => changedFiles.includes(path)));
}
`,
    'src/cli.mjs': String.raw`import { readFileSync } from 'node:fs';
import { planBuild } from './graph.mjs';
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const targets = Object.keys(manifest.tasks);
console.log(JSON.stringify({targets,waves:planBuild(manifest,targets)}));
`,
    'build.json': JSON.stringify({ tasks: {
      bundle: { deps: ['compile', 'styles'], inputs: [] },
      compile: { deps: ['types'], inputs: ['src/app.ts'] },
      styles: { inputs: ['src/app.css'] },
      types: { inputs: ['src/types.ts'] },
      docs: { inputs: ['README.md'] },
    } }, null, 2) + '\n',
    'test/graph.test.mjs': String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import { planBuild, affectedTasks } from '../src/graph.mjs';

const graph={tasks:{app:{deps:['lib'],inputs:['app.js']},lib:{inputs:['lib.js']},docs:{inputs:['guide.md']}}};
test('target includes dependencies', () => assert.deepEqual(planBuild(graph,['app']), [['lib'],['app']]));
test('changed dependency affects consumers', () => assert.deepEqual(affectedTasks(graph,['lib.js']), ['app','lib']));
test('empty targets mean no work', () => assert.deepEqual(planBuild(graph,[]), []));
`,
  },
  grade: ({ project }) => gradeCode(project, String.raw`
const { planBuild: plan, affectedTasks: affected } = await load('src/graph.mjs');
const graph={tasks:{ship:{deps:['test','bundle']},test:{deps:['lib'],inputs:['test.js']},bundle:{deps:['lib','css']},lib:{deps:['types'],inputs:['lib.js']},types:{inputs:['types.ts']},css:{inputs:['styles.css']},docs:{inputs:['guide.md']}}};
await check('earliest-sorted-waves', () => assert.deepEqual(plan(graph), [['css','docs','types'],['lib'],['bundle','test'],['ship']]));
await check('target-closure-excludes-unrelated', () => assert.deepEqual(plan(graph,['test','test']), [['types'],['lib'],['test']]));
await check('empty-manifest-and-selection', () => {
  assert.deepEqual(plan({tasks:{}}),[]); assert.deepEqual(plan(graph,[]),[]); assert.deepEqual(affected({tasks:{}},[]),[]);
});
await check('transitive-change-propagation', () => assert.deepEqual(affected(graph,['types.ts','types.ts']), ['bundle','lib','ship','test','types']));
await check('change-does-not-add-dependencies', () => {
  assert.deepEqual(affected(graph,['test.js']),['ship','test']); assert.deepEqual(affected(graph,['missing']),[]);
});
await check('exact-input-matching-and-deduplication', () => {
  const m={tasks:{' x ':{inputs:[' x ','x','x']},x:{deps:[' x ',' x ']}}};
  assert.deepEqual(affected(m,[' x ']),[' x ','x']); assert.deepEqual(plan(m),[[' x '],['x']]);
});
await check('cycle-detected-even-if-unreachable', () => {
  const m={tasks:{ok:{},a:{deps:['b']},b:{deps:['a']}}};
  assert.throws(()=>plan(m,['ok'])); assert.throws(()=>affected(m,[])); assert.throws(()=>plan({tasks:{x:{deps:['x']}}}));
});
await check('unknown-dependency-detected-even-if-unreachable', () => {
  const m={tasks:{ok:{},bad:{deps:['absent']}}}; assert.throws(()=>plan(m,[])); assert.throws(()=>affected(m,['a']));
});
await check('manifest-and-definition-validation', () => {
  for(const m of [null,{},[],{tasks:null},{tasks:[]},{tasks:{x:null}},{tasks:{x:[]}},{tasks:{' ':{}}},{tasks:{x:{deps:'a'}}},{tasks:{x:{inputs:[1]}}},{tasks:{x:{deps:[' ']}}}]) {assert.throws(()=>plan(m));assert.throws(()=>affected(m,[]));}
});
await check('target-and-change-validation', () => {
  for(const t of [null,'test',['missing'],[' '],[2]]) assert.throws(()=>plan(graph,t));
  for(const c of [null,'x',[' '],[1]]) assert.throws(()=>affected(graph,c));
});
await check('nonmutation', () => {
  const before=JSON.stringify(graph), targets=['ship','ship'], changes=['types.ts','types.ts'];
  plan(graph,targets); affected(graph,changes); assert.equal(JSON.stringify(graph),before); assert.deepEqual(targets,['ship','ship']); assert.deepEqual(changes,['types.ts','types.ts']);
});
await check('CLI-default-json', () => {
  const output=node(['src/cli.mjs','build.json']); assert.ok(output.endsWith('\n'));
  assert.deepEqual(JSON.parse(output),{targets:['bundle','compile','docs','styles','types'],waves:[['docs','styles','types'],['compile'],['bundle']]});
});
await check('CLI-target-selection', () => assert.deepEqual(JSON.parse(node(['src/cli.mjs','build.json','--targets=compile,compile'])),{targets:['compile'],waves:[['types'],['compile']]}));
await check('CLI-changed-selection-and-no-match', () => {
  assert.deepEqual(JSON.parse(node(['src/cli.mjs','build.json','--changed=src/types.ts'])),{targets:['bundle','compile','types'],waves:[['styles','types'],['compile'],['bundle']]});
  assert.deepEqual(JSON.parse(node(['src/cli.mjs','build.json','--changed=not-present'])),{targets:[],waves:[]});
});
await check('CLI-errors-exit-two-without-stdout-or-stack', () => {
  const cases=[[],['missing-manifest.json'],['build.json','--bogus=x'],['build.json','--targets='],['build.json','--targets=compile,'],['build.json','--targets=docs','--changed=README.md'],['build.json','--targets=docs','--targets=docs'],['build.json','extra.json'],['build.json','--targets=absent']];
  for(const args of cases) {
    let caught; try { node(['src/cli.mjs',...args]); } catch(e) { caught=e; }
    assert.ok(caught,'must fail: '+JSON.stringify(args)); assert.equal(caught.status,2); assert.equal(caught.stdout,'');
    assert.ok(caught.stderr.trim().length>0); assert.ok(!/\n\s+at\s/.test(caught.stderr),'no JS stack trace');
  }
});
`),
};

export const codeCases = [csvCase, billingCase, graphCase];
