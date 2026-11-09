// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type * as Renderer from "@deepseek-ai/dsh-client-ui-renderer/client";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  apply,
  inject,
} from "../../packages/moa/src/client/index.tsx";
import { nativeLoader } from "./native-loader.ts";
import { snapshot, sid } from "./fixture.ts";
import { submissionFixture } from "./submission-fixture.ts";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  delete (window as any).__ModuleLoader__;
});

async function bench() {
  const load = nativeLoader();
  const renderer = load<typeof Renderer>("@deepseek-ai/dsh-client-ui-renderer");
  const conversation = load<typeof Conversation>(
    "@deepseek-ai/dsh-client-ui-conversation",
  );
  const root = new Context();
  cleanups.push(() => root.fiber.dispose());
  const slots = new renderer.SlotRegistry(root);
  new conversation.UiConversation(root, {} as any);
  submissionFixture(root);
  slots.register(
    {
      name: "root",
      children: {
        "conversation.input.left": { kind: "list", scope: "session" },
        "conversation.chat.node": { kind: "keyed", scope: "session" },
        "conversation.composer": { kind: "chain", scope: "session" },
      },
    } as any,
    (() => null) as any,
  );
  const release = vi.fn();
  const list = createSnapshotStore<any>({ ids: [], byId: {} });
  const retain = vi.fn((id: string) => {
    // Native retention itself updates the list synchronously.
    list.set({ ...list.getSnapshot() });
    return { sessionId: sid(id), ready: Promise.resolve({}), release };
  });
  root.provide("sessions", {
    list,
    retain,
    subagentAddress: (id: string) =>
      id.startsWith("child")
        ? {
            parentSessionId: sid("parent"),
            childSessionId: sid(id),
            mode: "continuable",
          }
        : undefined,
  } as any);
  const remote = {
    catalog: async () => ({ ok: true, value: [snapshot()] }),
    mode: async () => ({
      ok: true,
      value: { role: "ordinary", canToggle: false },
    }),
    follow: (_id: string, signal: AbortSignal) => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        yield { type: "baseline", value: snapshot() };
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    }),
  };
  root.provide("remote", {
    $mount: async () => () => {},
    projectMode: remote,
  } as any);
  root.provide("remote.projectMode", remote);
  root.provide("uiWorkspace", { openSession: vi.fn() } as any);
  root.provide("workspaces", {} as any);
  root.provide("locale", { register: () => () => {} } as any);
  const fiber = root.plugin({ inject, apply });
  await fiber;
  const client = (slots.entries("conversation.input.left")[0].inject?.() as any)
    .client;
  await vi.waitFor(() =>
    expect(client.store.get(sid("parent"))).toBeDefined(),
  );
  const show = (counts: Record<string, Record<string, number>>) =>
    list.set({
      ids: [sid("parent"), ...Object.keys(counts).map(sid)],
      byId: Object.fromEntries([
        ["parent", { id: sid("parent"), origin: "session", retainedBy: {} }],
        ...Object.entries(counts).map(([id, retainedBy]) => [
          id,
          {
            id: sid(id),
            origin: "subagent",
            retainedBy,
          },
        ]),
      ]),
    });
  return { fiber, client, retain, release, show };
}

it("opens the native parent in the background for a visible worker and releases its one shared reference", async () => {
  const b = await bench();
  expect(b.retain).not.toHaveBeenCalled();
  b.show({ child: { mainView: 1 } });
  expect(b.retain).toHaveBeenCalledExactlyOnceWith(sid("parent"), {
    source: "moaParent",
  });
  b.client.store.accept({
    ...snapshot(),
    revision: 2,
    workers: [
      ...snapshot().workers,
      { ...snapshot().workers[0], workerId: sid("child-two") },
    ],
  });
  b.show({ child: { mainView: 1 }, "child-two": { sidebarChat: 1 } });
  expect(b.retain).toHaveBeenCalledTimes(1);
  b.show({ "child-two": { sidebarChat: 1 } });
  expect(b.release).not.toHaveBeenCalled();
  b.show({});
  expect(b.release).toHaveBeenCalledTimes(1);
  b.show({ child: { mainView: 1 } });
  expect(b.retain).toHaveBeenCalledTimes(2);
  await b.fiber.dispose();
  expect(b.release).toHaveBeenCalledTimes(2);
});

it("does not activate parents for background, ordinary, disabled, or deleted workers", async () => {
  const b = await bench();
  b.show({ child: {}, "child-ordinary": { mainView: 1 } });
  expect(b.retain).not.toHaveBeenCalled();
  b.client.store.accept({
    ...snapshot(),
    revision: 2,
    workers: [{ ...snapshot().workers[0], lifecycle: "deleted" }],
  });
  b.show({ child: { mainView: 1 } });
  expect(b.retain).not.toHaveBeenCalled();
  b.client.store.accept({
    ...snapshot(),
    revision: 3,
    project: {
      ...snapshot().project,
      revision: 3,
      mode: "disabled",
    },
  });
  expect(b.retain).not.toHaveBeenCalled();
});
