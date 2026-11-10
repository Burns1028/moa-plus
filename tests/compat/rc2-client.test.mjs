import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modules = process.env.MOA_COMPAT_MODULES;
const nativeTest = (name, fn) => test(name, { skip: !modules, timeout: 15000 }, fn);
const load = (name, file = 'lib/index.js') => import(pathToFileURL(resolve(modules, '@deepseek-ai', name, file)).href);
const signal = () => new AbortController().signal;
const resident = Symbol.for('dsh.subagent.withResidentChild');
const until = async (check) => {
  for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail('native child did not settle');
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'moa-rc2-client-'));
  const [{ Context }, kit, { default: AgentLoop }, { LlmAdapter }, Policy, Fs,
    Directory, Persistence, QueryModule, Subagents, Spawn, Uploads, Attachments] = await Promise.all([
    load('cordis'), load('dsh-agent-loop-testkit'), load('dsh-agent-loop'), load('dsh-llm'),
    load('dsh-sandbox-policy'), load('dsh-fs-local'), load('dsh-working-directory'),
    load('dsh-session-persistence-jsonl'), load('dsh-session-query'), load('dsh-subagent'),
    load('dsh-subagent-spawn-in-process'), load('dsh-client-file-upload'), load('dsh-attachment'),
  ]);
  const ctx = new Context();
  await kit.mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(Policy.default, { mode: 'danger-full-access' });
  await ctx.plugin(Fs.default);
  await ctx.plugin(Directory.default);
  await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' });
  await ctx.plugin(AgentLoop, { agents: [] });
  class Adapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream() {
      yield* [{ type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'done' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } },
        { type: 'finish', reason: { kind: 'stop' } }];
    }
  }
  ctx.llm.registerAdapter(['test'], new Adapter());
  class Query extends QueryModule.default {
    async searchSessions() { throw new Error('search outside fixture'); }
    async searchEvents() { throw new Error('search outside fixture'); }
  }
  await ctx.plugin(Query);
  await ctx.plugin(Subagents.default);
  await ctx.plugin(Spawn, { providerName: 'spawn' });
  class TestAttachments extends Attachments.default {
    imageLimits = { maxImagesPerMessage: 8, maxMessageImageBytes: 1000000, maxImageBytes: 1000000, mediaTypes: ['image/png'] };
    paths = new Map();
    async validateImage() { throw new Error('image decoding outside fixture'); }
    async saveImage() { throw new Error('image storage outside fixture'); }
    async readImage() { throw new Error('image storage outside fixture'); }
    async saveFileStream(input) {
      const chunks = [];
      for await (const chunk of input.data) { input.signal?.throwIfAborted(); chunks.push(chunk); }
      const data = Buffer.concat(chunks), attachmentId = createHash('sha256').update(data).digest('hex');
      await mkdir(join(root, 'uploads'), { recursive: true });
      const path = join(root, 'uploads', attachmentId);
      await writeFile(path, data); this.paths.set(attachmentId, path);
      return { attachmentId, name: input.name ?? 'input.txt', bytes: data.length };
    }
    fileHostPath(ref) { return this.paths.get(ref.attachmentId); }
  }
  await ctx.plugin(TestAttachments);
  ctx.provide('commands', { registerFileReceiptResolver: () => () => {} });
  ctx.provide('connection', { fetch: { register: () => () => {} } });
  await ctx.plugin(Uploads.default);
  const { agent: parent } = await ctx.agents.create({ sessionId: 'rc2-upload-parent', meta: { cwd: root }, agentOptions: { provider: 'test', model: 'test' } });
  const childId = 'rc2-upload-child';
  await ctx.subagents.startActivation({ provider: 'spawn', label: 'files', childId,
    request: { parent, prompt: [{ type: 'text', text: 'initial' }], cwd: root }, signal: signal(), delivery: 'caller' });
  await until(() => ctx.agents.get(childId) === undefined);
  return { ctx, root, parent, childId,
    use: callback => ctx.subagents[resident](parent, childId, signal(), callback),
    upload: (agent, value = 'exact child file') => ctx.fileUploads.uploadStream({ sessionId: agent.id, name: 'input.txt', data: (async function* () { yield Buffer.from(value); })(), signal: signal() }),
    prompt: (requestId, receiptId) => ctx.subagents.prompt({ requestId, parentSessionId: parent.id, childSessionId: childId, mode: 'continuable', delivery: 'queue', content: [{ type: 'file', receiptId }] }, signal()),
    async dispose() { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); },
  };
}

nativeTest('rc2 Worker uses the native staged-part shape and retires receipts after acceptance', async () => {
  const f = await fixture();
  try {
    await f.use(async child => {
      const file = await f.upload(child);
      assert.deepEqual(f.ctx.fileUploads.resolve(child, file.receiptId), { type: 'file', attachment: file.file });
      const result = await f.prompt('unique-file', file.receiptId);
      await child.whenIdle();
      const events = child.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.rpcId === 'unique-file');
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].data.content[0], { type: 'file', attachment: file.file });
      assert.equal(f.ctx.fileUploads.resolve(child, file.receiptId), undefined);
      assert.deepEqual(await f.prompt('unique-file', file.receiptId), result);
    });
  } finally { await f.dispose(); }
});

nativeTest('rc2 Worker rejects foreign receipts and concurrent retries keep one native input', async () => {
  const f = await fixture();
  try {
    const foreign = await f.upload(f.parent, 'parent only');
    await f.use(async child => {
      await assert.rejects(f.prompt('foreign-file', foreign.receiptId), e => e.code === 'subagent/attachment-invalid' && e.details.reason === 'FILE_NOT_STAGED');
      const file = await f.upload(child);
      const [first, retry] = await Promise.all([f.prompt('concurrent-file', file.receiptId), f.prompt('concurrent-file', file.receiptId)]);
      assert.deepEqual(first, retry); await child.whenIdle();
      assert.equal(child.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.rpcId === 'concurrent-file').length, 1);
    });
    assert.ok(f.ctx.fileUploads.resolve(f.parent, foreign.receiptId));
  } finally { await f.dispose(); }
});

nativeTest('rc2 promptless borrowing preserves idle children without creating another input', async () => {
  const f = await fixture();
  try {
    let snapshot;
    await f.use(async child => { snapshot = child.session.snapshotEvents().length; await new Promise(r => setTimeout(r, 10)); assert.equal(f.ctx.agents.get(child.id), child); });
    await until(() => f.ctx.agents.get(f.childId) === undefined);
    await f.use(async child => { assert.equal(child.session.snapshotEvents().length, snapshot); });
  } finally { await f.dispose(); }
});

nativeTest('rc2 receipt retries deduplicate after native claim and before history commit', async () => {
  const f = await fixture(), entered = Promise.withResolvers(), release = Promise.withResolvers();
  try {
    await f.use(async child => {
      const file = await f.upload(child);
      const off = child.ctx.on('agent/pre-step', async next => { entered.resolve(); await release.promise; return next; });
      try {
        const first = await f.prompt('claimed-file', file.receiptId);
        await entered.promise;
        assert.equal(child.inbox.nextTurn.length, 0);
        assert.equal(child.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source.rpcId === 'claimed-file'), false);
        assert.deepEqual(await f.prompt('claimed-file', file.receiptId), first);
        release.resolve(); await child.whenIdle();
        assert.equal(child.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.rpcId === 'claimed-file').length, 1);
      } finally { release.resolve(); off(); }
    });
  } finally { release.resolve(); await f.dispose(); }
});

nativeTest('rc2 Host and Client codecs admit receipts and reject fabricated file references', async () => {
  const [{ TYPERT }, { TYPERT_REMOTE }] = await Promise.all([load('dsh-subagent', 'lib/typert.host.js'), load('dsh-subagent', 'lib/typert.remote-client.js')]);
  const host = TYPERT.invocations.find(method => method.method === 'prompt');
  const client = TYPERT_REMOTE.methods['subagents/prompt'];
  const request = { requestId: 'wire', parentSessionId: 'p', childSessionId: 'c', mode: 'continuable', delivery: 'queue', content: [{ type: 'file', receiptId: 'opaque' }] };
  for (const method of [host, client]) {
    assert.equal(method.parameters[0].codec.create().safeParse(request).success, true);
    assert.equal(method.parameters[0].strictCodec.create().safeParse({ ...request, content: [{ type: 'file', attachment: { attachmentId: 'foreign' } }] }).success, false);
  }
});
