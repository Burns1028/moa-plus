import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import AttachmentStore, {
  AttachmentId,
  type FileAttachmentRef,
  type SaveFileStreamAttachment,
} from "@deepseek-ai/dsh-attachment";
import FileUploads from "@deepseek-ai/dsh-client-file-upload";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { fixture } from "../host/fixture.ts";

// The store writes exact test bytes; native FileUploads owns receipt state and
// native Subagents owns admission, serialization, inboxes and lifecycle.
class TestAttachments extends AttachmentStore {
  readonly imageLimits = {
    maxImagesPerMessage: 8,
    maxMessageImageBytes: 1_000_000,
    maxImageBytes: 1_000_000,
    mediaTypes: ["image/png" as const],
  };
  readonly paths = new Map<string, string>();
  constructor(
    ctx: ConstructorParameters<typeof AttachmentStore>[0],
    readonly directory: string,
  ) {
    super(ctx);
  }
  async validateImage(): Promise<void> {
    throw new Error("Image decoding is outside this file-receipt fixture");
  }
  async saveImage(): Promise<never> {
    throw new Error("Image storage is outside this file-receipt fixture");
  }
  async readImage(): Promise<never> {
    throw new Error("Image storage is outside this file-receipt fixture");
  }
  async saveFileStream(
    input: SaveFileStreamAttachment,
  ): Promise<FileAttachmentRef> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${this.paths.size}.bin`);
    const file = await open(path, "w");
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of input.data) {
        input.signal?.throwIfAborted();
        hash.update(chunk);
        bytes += chunk.byteLength;
        await file.write(chunk);
      }
    } finally {
      await file.close();
    }
    const attachmentId = AttachmentId(hash.digest("hex"));
    this.paths.set(attachmentId, path);
    return { attachmentId, name: input.name ?? "upload.txt", bytes };
  }
  fileHostPath(ref: FileAttachmentRef) {
    return this.paths.get(ref.attachmentId);
  }
}
const signal = () => new AbortController().signal;
const residentChild = Symbol.for("dsh.subagent.withResidentChild");
async function bench() {
  const f = await fixture();
  let attachments!: TestAttachments;
  // Match the application: storage is a sibling plugin service, not a root
  // property that accidentally grants undeclared access to every descendant.
  await f.ctx.plugin({
    name: "worker-attachment-store-fixture",
    apply(scope) {
      attachments = new TestAttachments(scope, join(f.root, "uploads"));
    },
  });
  f.ctx.provide("commands", {
    registerFileReceiptResolver: () => () => {},
  } as any);
  f.ctx.provide("connection", { fetch: { register: () => () => {} } } as any);
  await f.ctx.plugin(FileUploads);
  const { agent: parent } = await f.ctx.agents.create({
    sessionId: SessionId("attachment-parent"),
    meta: { cwd: f.root },
    agentOptions: { provider: "test", model: "test" },
  });
  const childId = SessionId("attachment-child");
  await f.ctx.subagents.startActivation({
    provider: "spawn",
    label: "files",
    childId,
    request: {
      parent,
      prompt: [{ type: "text", text: "initial task" }],
      cwd: f.root,
    },
    signal: signal(),
    delivery: "caller",
  });
  await vi.waitFor(() => expect(f.ctx.agents.get(childId)).toBeUndefined());
  const use = <T>(callback: (child: Agent) => Promise<T>) =>
    (f.ctx.subagents as any)[residentChild](
      parent,
      childId,
      signal(),
      callback,
    ) as Promise<T>;
  const upload = (agent: Agent, text = "worker attachment unique contents") =>
    f.ctx.fileUploads.uploadStream({
      sessionId: agent.id,
      name: "worker-notes.txt",
      data: (async function* () {
        yield Buffer.from(text);
      })(),
      signal: signal(),
    });
  const prompt = (
    requestId: string,
    receiptId: string,
    delivery: "queue" | "steer" = "queue",
  ) =>
    f.ctx.subagents.prompt(
      {
        requestId,
        parentSessionId: parent.id,
        childSessionId: childId,
        mode: "continuable",
        delivery,
        content: [
          { type: "file", receiptId },
          { type: "text", text: "read attachment" },
        ],
      } as any,
      signal(),
    );
  return { ...f, attachments, parent, childId, use, upload, prompt };
}

it.each(["queue", "steer"] as const)(
  "admits a native Worker file through %s and retires its exact-Session receipt",
  async (delivery) => {
    const b = await bench();
    try {
      await b.use(async (child) => {
        const uploaded = await b.upload(child);
        expect(b.ctx.fileUploads.resolve(child, uploaded.receiptId)).toEqual(
          uploaded.file,
        );
        const result = await b.prompt(
          `file-${delivery}`,
          uploaded.receiptId,
          delivery,
        );
        await child.whenIdle();
        const events = child.session
          .snapshotEvents()
          .filter(
            (e) =>
              e.type === "user/message" &&
              "rpcId" in e.data.source &&
              e.data.source.rpcId === `file-${delivery}`,
          );
        expect(events).toHaveLength(1);
        expect(events[0].data.id).toBe(result.messageId);
        expect(events[0].data.content[0]).toEqual({
          type: "file",
          attachment: uploaded.file,
        });
        expect(
          b.ctx.fileUploads.resolve(child, uploaded.receiptId),
        ).toBeUndefined();
        expect(
          await b.prompt(`file-${delivery}`, uploaded.receiptId, delivery),
        ).toEqual(result);
        expect(
          child.session
            .snapshotEvents()
            .filter(
              (e) =>
                e.type === "user/message" &&
                "rpcId" in e.data.source &&
                e.data.source.rpcId === `file-${delivery}`,
            ),
        ).toHaveLength(1);
      });
    } finally {
      await b.dispose();
    }
  },
);

it("rejects parent and unknown receipts with precise child attachment errors", async () => {
  const b = await bench();
  try {
    const parentUpload = await b.upload(b.parent, "parent private attachment");
    await b.use(async () => {
      for (const receipt of [parentUpload.receiptId, "missing-file-receipt"])
        await expect(
          b.prompt(`foreign-${receipt}`, receipt),
        ).rejects.toMatchObject({
          code: "subagent/attachment-invalid",
          details: { reason: "FILE_NOT_STAGED" },
        });
    });
    expect(b.ctx.fileUploads.resolve(b.parent, parentUpload.receiptId)).toEqual(
      parentUpload.file,
    );
  } finally {
    await b.dispose();
  }
});

it("coalesces simultaneous accepted retries before resolving a retired receipt", async () => {
  const b = await bench();
  try {
    await b.use(async (child) => {
      const uploaded = await b.upload(child);
      const [first, retry] = await Promise.all([
        b.prompt("concurrent-file", uploaded.receiptId),
        b.prompt("concurrent-file", uploaded.receiptId),
      ]);
      expect(first).toEqual(retry);
      await child.whenIdle();
      expect(
        child.session
          .snapshotEvents()
          .filter(
            (e) =>
              e.type === "user/message" &&
              "rpcId" in e.data.source &&
              e.data.source.rpcId === "concurrent-file",
          ),
      ).toHaveLength(1);
    });
  } finally {
    await b.dispose();
  }
});

it("rolls back receipt binding after rejected admission and permits a real retry", async () => {
  const b = await bench();
  try {
    await b.use(async (child) => {
      const uploaded = await b.upload(child);
      const reject = vi.spyOn(child, "followup").mockImplementationOnce(() => {
        throw new Error("deliberate rejected admission");
      });
      await expect(
        b.prompt("failed-file", uploaded.receiptId),
      ).rejects.toThrow();
      reject.mockRestore();
      b.ctx.fileUploads.retirePrompt(child, "failed-file");
      expect(b.ctx.fileUploads.resolve(child, uploaded.receiptId)).toEqual(
        uploaded.file,
      );
      const unrelated = await b.prompt("accepted-file", uploaded.receiptId);
      expect(unrelated.messageId).toBeTruthy();
      await child.whenIdle();
      expect(
        b.ctx.fileUploads.resolve(child, uploaded.receiptId),
      ).toBeUndefined();
    });
  } finally {
    await b.dispose();
  }
});

it("preserves ordinary file uploads and refuses files for a non-continuable child", async () => {
  const b = await bench();
  try {
    const uploaded = await b.upload(b.parent);
    expect(b.ctx.fileUploads.resolve(b.parent, uploaded.receiptId)).toEqual(
      uploaded.file,
    );
    const { agent: foreign } = await b.ctx.agents.create({
      sessionId: SessionId("one-shot-like"),
      meta: { cwd: b.root, origin: "subagent", parentSession: b.parent.id },
      agentOptions: { provider: "test", model: "test" },
    });
    await expect(b.upload(foreign)).rejects.toMatchObject({
      code: "subagent/attachment-invalid",
    });
  } finally {
    await b.dispose();
  }
});

it("accepts only staged receipt file parts in the real generated protocol", async () => {
  const { default: remote } = await import("@deepseek-ai/dsh-subagent/remote");
  const request = {
    requestId: "wire-file",
    parentSessionId: "parent",
    childSessionId: "child",
    mode: "continuable",
    delivery: "queue",
    content: [{ type: "file", receiptId: "opaque-receipt" }],
  };
  const schema = remote.methods["subagents/prompt"].input().create();
  expect(schema.safeParse({ request }).success).toBe(true);
  expect(
    schema.safeParse({
      request: {
        ...request,
        content: [
          {
            type: "file",
            attachment: { attachmentId: "forged", name: "foreign", bytes: 1 },
          },
        ],
      },
    }).success,
  ).toBe(false);
});

it("deduplicates a receipt while its original input is claimed but not committed", async () => {
  const b = await bench();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  try {
    await b.use(async (child) => {
      const uploaded = await b.upload(child);
      const off = child.ctx.on("agent/pre-step", async (next) => {
        entered.resolve();
        await release.promise;
        return next;
      });
      const first = await b.prompt("claimed-file", uploaded.receiptId);
      await entered.promise;
      expect(child.inbox.nextTurn).toHaveLength(0);
      expect(
        child.session
          .snapshotEvents()
          .some(
            (e) =>
              e.type === "user/message" &&
              "rpcId" in e.data.source &&
              e.data.source.rpcId === "claimed-file",
          ),
      ).toBe(false);
      expect(await b.prompt("claimed-file", uploaded.receiptId)).toEqual(first);
      release.resolve();
      await child.whenIdle();
      off();
      expect(
        child.session
          .snapshotEvents()
          .filter(
            (e) =>
              e.type === "user/message" &&
              "rpcId" in e.data.source &&
              e.data.source.rpcId === "claimed-file",
          ),
      ).toHaveLength(1);
    });
  } finally {
    release.resolve();
    await b.dispose();
  }
});

it("does not publish an upload receipt after the receiving child is disposed", async () => {
  const b = await bench();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let upload: Promise<unknown> | undefined;
  try {
    await b.use(async (child) => {
      upload = b.ctx.fileUploads.uploadStream({
        sessionId: child.id,
        signal: signal(),
        data: (async function* () {
          entered.resolve();
          await release.promise;
          yield Buffer.from("disposed upload");
        })(),
      });
      // Observe rejection immediately; the deferred producer completes after view release.
      void upload.catch(() => {});
      await entered.promise;
    });
    await vi.waitFor(() => expect(b.ctx.agents.get(b.childId)).toBeUndefined());
    release.resolve();
    await expect(upload).rejects.toMatchObject({ code: "session/not-found" });
  } finally {
    release.resolve();
    await b.dispose();
  }
});

it("validates cancellation, actual parent and nonempty request identities before admission", async () => {
  const b = await bench();
  try {
    await b.use(async (child) => {
      const uploaded = await b.upload(child);
      await expect(b.prompt("", uploaded.receiptId)).rejects.toMatchObject({
        code: "gateway/bad-request",
      });
      const { agent: otherParent } = await b.ctx.agents.create({
        sessionId: SessionId("unrelated-parent"),
        meta: { cwd: b.root },
        agentOptions: { provider: "test", model: "test" },
      });
      await expect(
        b.ctx.subagents.prompt(
          {
            requestId: "wrong-parent",
            parentSessionId: otherParent.id,
            childSessionId: child.id,
            mode: "continuable",
            delivery: "queue",
            content: [{ type: "file", receiptId: uploaded.receiptId }],
          } as any,
          signal(),
        ),
      ).rejects.toMatchObject({ code: "subagent/unauthorized" });
      const abort = new AbortController();
      abort.abort();
      await expect(
        b.ctx.subagents.prompt(
          {
            requestId: "cancelled-file",
            parentSessionId: b.parent.id,
            childSessionId: child.id,
            mode: "continuable",
            delivery: "queue",
            content: [{ type: "file", receiptId: uploaded.receiptId }],
          } as any,
          abort.signal,
        ),
      ).rejects.toMatchObject({ code: "gateway/cancelled" });
      expect(b.ctx.fileUploads.resolve(child, uploaded.receiptId)).toEqual(
        uploaded.file,
      );
    });
  } finally {
    await b.dispose();
  }
});

it("finds the accepted request in persisted own history after cold reconstruction", async () => {
  const b = await bench();
  let first: { messageId: unknown } | undefined;
  let receiptId: string | undefined;
  try {
    await b.use(async (child) => {
      const upload = await b.upload(child);
      receiptId = upload.receiptId;
      first = await b.prompt("cold-accepted-file", receiptId);
      await child.whenIdle();
    });
    await vi.waitFor(() => expect(b.ctx.agents.get(b.childId)).toBeUndefined());
    const requests = b.adapter.requests.length;
    expect(await b.prompt("cold-accepted-file", receiptId!)).toEqual(first);
    expect(b.adapter.requests).toHaveLength(requests);
  } finally {
    await b.dispose();
  }
});

it("delivers a pure file input without requiring synthetic text", async () => {
  const b = await bench();
  try {
    await b.use(async (child) => {
      const uploaded = await b.upload(child);
      await b.ctx.subagents.prompt(
        {
          requestId: "attachment-only",
          parentSessionId: b.parent.id,
          childSessionId: child.id,
          mode: "continuable",
          delivery: "queue",
          content: [{ type: "file", receiptId: uploaded.receiptId }],
        } as any,
        signal(),
      );
      await child.whenIdle();
      const event = child.session
        .snapshotEvents()
        .find(
          (e) =>
            e.type === "user/message" &&
            "rpcId" in e.data.source &&
            e.data.source.rpcId === "attachment-only",
        );
      expect(event?.data.content).toEqual([
        { type: "file", attachment: uploaded.file },
      ]);
    });
  } finally {
    await b.dispose();
  }
});

it("keeps a staged receipt reusable when cancellation happens during attachment admission", async () => {
  const b = await bench();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  try {
    await b.use(async (child) => {
      const uploaded = await b.upload(child);
      const original = b.attachments.admitPromptContent.bind(b.attachments);
      const admit = vi
        .spyOn(b.attachments, "admitPromptContent")
        .mockImplementationOnce(async (content) => {
          entered.resolve();
          await release.promise;
          return original(content);
        });
      const cancel = new AbortController();
      const pending = b.ctx.subagents.prompt(
        {
          requestId: "cancel-during-admit",
          parentSessionId: b.parent.id,
          childSessionId: child.id,
          mode: "continuable",
          delivery: "queue",
          content: [{ type: "file", receiptId: uploaded.receiptId }],
        } as any,
        cancel.signal,
      );
      const rejected = expect(pending).rejects.toMatchObject({
        code: "gateway/cancelled",
      });
      await entered.promise;
      cancel.abort();
      release.resolve();
      await rejected;
      admit.mockRestore();
      expect(b.ctx.fileUploads.resolve(child, uploaded.receiptId)).toEqual(
        uploaded.file,
      );
      await b.prompt("after-cancel", uploaded.receiptId);
      await child.whenIdle();
      expect(
        b.ctx.fileUploads.resolve(child, uploaded.receiptId),
      ).toBeUndefined();
    });
  } finally {
    release.resolve();
    await b.dispose();
  }
});

it("does not grant a sibling Worker authority over another Worker's upload receipt", async () => {
  const b = await bench();
  const siblingId = SessionId("attachment-sibling");
  try {
    await b.ctx.subagents.startActivation({
      provider: "spawn",
      label: "sibling",
      childId: siblingId,
      request: {
        parent: b.parent,
        prompt: [{ type: "text", text: "initial sibling task" }],
        cwd: b.root,
      },
      signal: signal(),
      delivery: "caller",
    });
    await vi.waitFor(() => expect(b.ctx.agents.get(siblingId)).toBeUndefined());
    await (b.ctx.subagents as any)[residentChild](
      b.parent,
      siblingId,
      signal(),
      async (sibling: Agent) => {
        const uploaded = await b.upload(sibling);
        await b.use(async (child) => {
          await expect(
            b.prompt("sibling-receipt", uploaded.receiptId),
          ).rejects.toMatchObject({
            code: "subagent/attachment-invalid",
            details: { reason: "FILE_NOT_STAGED" },
          });
          expect(
            b.ctx.fileUploads.resolve(child, uploaded.receiptId),
          ).toBeUndefined();
        });
        expect(b.ctx.fileUploads.resolve(sibling, uploaded.receiptId)).toEqual(
          uploaded.file,
        );
      },
    );
  } finally {
    await b.dispose();
  }
});

it("keeps parent settlement for an ordinary native child's cold browser continuation", async () => {
  const f = await fixture();
  try {
    const { agent: parent } = await f.ctx.agents.create({
      sessionId: SessionId("ordinary-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const childId = SessionId("ordinary-cold-child");
    const settlements = () =>
      parent.session
        .snapshotEvents()
        .filter(
          (event) =>
            event.type === "user/message" &&
            event.data.source.kind === "subagent-settled",
        );
    await f.ctx.subagents.startActivation({
      provider: "spawn",
      label: "ordinary",
      childId,
      request: {
        parent,
        prompt: [{ type: "text", text: "initial task" }],
        cwd: f.root,
      },
      signal: signal(),
      delivery: "parent",
    });
    await vi.waitFor(() => expect(f.ctx.agents.get(childId)).toBeUndefined());
    await parent.whenIdle();
    expect(settlements()).toHaveLength(1);
    const request = {
      requestId: "ordinary-cold-browser",
      parentSessionId: parent.id,
      childSessionId: childId,
      mode: "continuable" as const,
      delivery: "queue" as const,
      content: [{ type: "text" as const, text: "continue native work" }],
    };
    const accepted = await f.ctx.subagents.prompt(request, signal());
    await vi.waitFor(() => expect(f.ctx.agents.get(childId)).toBeUndefined());
    await parent.whenIdle();
    expect(settlements()).toHaveLength(2);
    const calls = f.adapter.requests.length;
    expect(await f.ctx.subagents.prompt(request, signal())).toEqual(accepted);
    await vi.waitFor(() => expect(f.ctx.agents.get(childId)).toBeUndefined());
    await parent.whenIdle();
    expect(settlements()).toHaveLength(2);
    expect(f.adapter.requests).toHaveLength(calls);
  } finally {
    await f.dispose();
  }
});

it("keeps an already borrowed caller-delivery Worker free of duplicate native settlements", async () => {
  const b = await bench();
  try {
    await b.use(async (child) => {
      const uploaded = await b.upload(child);
      await b.prompt("managed-caller-file", uploaded.receiptId);
      await child.whenIdle();
    });
    await vi.waitFor(() => expect(b.ctx.agents.get(b.childId)).toBeUndefined());
    await b.parent.whenIdle();
    expect(
      b.parent.session
        .snapshotEvents()
        .filter(
          (event) =>
            event.type === "user/message" &&
            event.data.source.kind === "subagent-settled",
        ),
    ).toHaveLength(0);
  } finally {
    await b.dispose();
  }
});
