import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import { join } from "node:path";
import { fixture, response } from "./fixture.ts";
import { messageContent } from "../../packages/project-mode/src/host/message-content.ts";

async function start() {
  const f = await fixture();
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<SessionId>();
  const { agent: parent } = await f.ctx.agents.create({
    sessionId: SessionId("attachment-views-parent"),
    meta: { cwd: f.root },
    agentOptions: { provider: "test", model: "test" },
  });
  await f.ctx.projectMode.setEnabled(parent.id, true, 0, "enable");
  const path = join(f.root, "stored-upload");
  f.ctx.provide("attachments", {
    fileHostPath: () => path,
    imageHostPath: () => path,
  } as any);
  f.adapter.handler = async (request) => {
    if (request.sessionId !== parent.id) {
      entered.resolve(SessionId(request.sessionId!));
      await gate.promise;
    }
    return response("done");
  };
  await f.ctx.projectMode.controlForAgent(
    parent,
    { action: "spawn", name: "reader", task: "Read the next human input" },
    "spawn",
    new AbortController().signal,
  );
  const child = f.ctx.agents.get(await entered.promise)!;
  return { ...f, parent, child, gate, path };
}

const file: Extract<ContentBlock, { type: "file" }> = {
  type: "file",
  attachment: {
    attachmentId: AttachmentId("f".repeat(64)),
    name: "original notes.md",
    bytes: 17,
  },
};
const image: Extract<ContentBlock, { type: "image" }> = {
  type: "image",
  offloaded: true,
  attachment: {
    attachmentId: AttachmentId("e".repeat(64)),
    name: "diagram.png",
    mediaType: "image/png",
    bytes: 31,
    width: 2,
    height: 3,
  },
};

it("surfaces a native attachment path-mapping failure", async () => {
  const f = await fixture();
  try {
    f.ctx.provide("attachments", {
      fileHostPath: () => {
        throw new Error("attachment mapping failed");
      },
    } as any);
    expect(() => messageContent(f.ctx, [file])).toThrow(
      "attachment mapping failed",
    );
  } finally {
    await f.dispose();
  }
});

it.each([file, image])(
  "keeps $type references in pending and committed human activity",
  async (block) => {
    const f = await start();
    try {
      const message = createUserMessage({
        source: { kind: "user" },
        content: [block],
      });
      f.child.steer(message);
      const list = () =>
        f.ctx.projectMode.controlForAgent(
          f.parent,
          { action: "list" },
          "list",
          new AbortController().signal,
        ) as Promise<any[]>;
      expect((await list())[0].activity.lastUserInput).toMatchObject({
        messageId: message.id,
        text: "",
        state: "pending-steer",
        attachments: [
          { type: block.type, attachment: block.attachment, path: f.path },
        ],
      });
      f.gate.resolve();
      await f.child.whenIdle();
      expect((await list())[0].activity.lastUserInput).toMatchObject({
        messageId: message.id,
        text: "",
        state: "committed",
        attachments: [
          { type: block.type, attachment: block.attachment, path: f.path },
        ],
      });
    } finally {
      f.gate.resolve();
      await f.dispose();
    }
  },
);

it("retains attachment references in history without rewriting text or window positions", async () => {
  const f = await start();
  try {
    const message = createUserMessage({
      source: { kind: "user" },
      content: [
        { type: "text", text: "**Original instruction**" },
        file,
        image,
      ],
    });
    f.child.steer(message);
    f.gate.resolve();
    await f.child.whenIdle();
    const page = await f.ctx.projectMode.history(
      f.parent.id,
      f.child.id,
      1,
      1,
      new AbortController().signal,
    );
    expect(page.messages).toEqual([
      expect.objectContaining({
        id: message.id,
        index: 1,
        role: "user",
        text: "**Original instruction**",
        attachments: [
          { type: "file", attachment: file.attachment, path: f.path },
          { type: "image", attachment: image.attachment, path: f.path },
        ],
      }),
    ]);
    expect(page.total).toBe(4);
    expect(JSON.stringify(page)).not.toContain("offloaded");
  } finally {
    f.gate.resolve();
    await f.dispose();
  }
});

it("keeps attachment-only human input on the existing Worker timeline", async () => {
  const f = await start();
  try {
    const message = createUserMessage({
      source: { kind: "user" },
      content: [file, image],
    });
    f.child.steer(message);
    f.gate.resolve();
    await f.child.whenIdle();
    const control = new AbortController();
    const stream = f.ctx.projectMode
      .timeline(f.parent.id, f.child.id, 10, control.signal)
      [Symbol.asyncIterator]();
    try {
      const page = (await stream.next()).value!;
      expect(
        page.turns[0].inputs.find((input) => input.id === message.id),
      ).toMatchObject({
        text: "",
        actor: "user",
        attachments: [
          { type: "file", attachment: file.attachment, path: f.path },
          { type: "image", attachment: image.attachment, path: f.path },
        ],
      });
    } finally {
      control.abort();
      await stream.return?.();
    }
  } finally {
    f.gate.resolve();
    await f.dispose();
  }
});
