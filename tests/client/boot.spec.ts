// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import * as gateway from "@deepseek-ai/dsh-api-gateway/client";
import * as registry from "@deepseek-ai/dsh-typert-registry/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type * as Renderer from "@deepseek-ai/dsh-client-ui-renderer/client";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { nativeLoader } from "./native-loader.ts";
import moaRemoteDefinition from "../../packages/moa/lib/typert.remote-client.js";
import { submissionFixture } from "./submission-fixture.ts";
import { snapshot, sid } from "./fixture.ts";

const roots: Context[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await root.fiber.dispose();
  delete (window as any).__ModuleLoader__;
});

async function bench() {
  const capture = nativeLoader();
  const renderer = capture<typeof Renderer>(
    "@deepseek-ai/dsh-client-ui-renderer",
  );
  const conversation = capture<typeof Conversation>(
    "@deepseek-ai/dsh-client-ui-conversation",
  );
  // Load the exact shipped production apply, including its generated descriptor.
  const plugin = capture<{
    apply: (ctx: Context) => Promise<void>;
    inject: string[];
  }>("dsh-plugin-project-mode");
  const root = new Context();
  const submission = submissionFixture(root);
  roots.push(root);
  await root.plugin(registry);
  const call = vi.fn<ConnectionHandle["rpc"]["call"]>(async () => ({
    ok: true,
    value: [snapshot()],
  }));
  const streamSignals: AbortSignal[] = [];
  root.provide("connection", {
    interactions: "none",
    isLoopback: true,
    rpc: {
      call,
      open: async function* (_channel, _endpoint, _payload, signal) {
        streamSignals.push(signal);
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    },
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
    state: { getSnapshot: () => undefined, subscribe: () => () => {} },
    reconnect() {},
    registerGenerationSource: () => () => {},
    start: () => ({ stop() {} }),
    openWebSocket: () => {
      throw new Error("unexpected physical transport");
    },
  } satisfies ConnectionHandle);
  await root.plugin(gateway);
  const slots = new renderer.SlotRegistry(root);
  new conversation.UiConversation(root, {} as any);
  const list = createSnapshotStore({
    ids: ["parent"],
    byId: { parent: { id: "parent", retainedBy: {}, origin: "user" } },
  });
  const listeners = new Set<() => void>();
  root.provide("sessions", {
    list: {
      getSnapshot: list.getSnapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        const stop = list.subscribe(listener);
        return () => {
          listeners.delete(listener);
          stop();
        };
      },
    },
  } as any);
  root.provide("workspaces", {} as any);
  root.provide("uiWorkspace", {} as any);
  let locales = 0;
  root.provide("locale", {
    register: () => {
      locales++;
      return () => {
        locales--;
      };
    },
  } as any);
  slots.register(
    {
      name: "root",
      children: {
        "conversation.input.left": { kind: "list", scope: "session" },
        "conversation.chat.node": { kind: "keyed", scope: "session" },
        "conversation.chat.turnTail": { kind: "list", scope: "session" },
        "conversation.composer": { kind: "chain", scope: "session" },
        "sidebar.workspaces": { kind: "single", scope: "root" },
        "sidebar.workspaces.session.branch": { kind: "chain", scope: "root" },
      },
    } as any,
    (() => null) as any,
  );
  return {
    root,
    plugin,
    slots,
    call,
    streamSignals,
    listeners,
    submission,
    locales: () => locales,
  };
}

it("boots the shipped Client through native namespace injection and owns UI/subscriptions across withdrawal, remount and unload", async () => {
  const b = await bench();
  let unmount: (() => Promise<void>) | undefined;
  const nativeMount = b.root.remote.$mount;
  const mount = vi
    .spyOn(b.root.remote, "$mount")
    .mockImplementation(async function (this: Context["remote"], spec) {
      const dispose = await nativeMount.call(this, spec);
      unmount = dispose;
      return dispose;
    });
  const fiber = b.root.plugin(b.plugin);
  await fiber;
  await vi.waitFor(() =>
    expect(b.slots.entries("conversation.input.left")).toHaveLength(1),
  );
  expect(mount).toHaveBeenCalledTimes(1);
  expect(b.root.get("remote.projectMode")).toBeDefined();
  expect(b.listeners.size).toBe(3);
  expect(b.submission.behavior(sid("parent"))).toBe("steer");
  expect(b.submission.active()).toBe(1);
  expect(b.locales()).toBe(1);
  expect(b.streamSignals).toHaveLength(1);
  expect(b.streamSignals[0].aborted).toBe(false);
  expect(
    b.root.uiConversation.events
      .entries()
      .some((e) => e.kind === "project-mode-human-boundary"),
  ).toBe(true);
  expect(b.slots.entries("sidebar.workspaces")).toHaveLength(0);
  expect(b.slots.entries("sidebar.workspaces.session.branch")).toHaveLength(1);
  expect(b.slots.entries("conversation.chat.turnTail")).toHaveLength(0);
  expect(b.call).toHaveBeenCalledWith(
    "/api",
    "projectMode/catalog",
    { args: {} },
    expect.any(AbortSignal),
  );
  const firstClient = (
    b.slots.entries("conversation.input.left")[0].inject?.() as any
  ).client;

  await unmount!();
  await vi.waitFor(() =>
    expect(b.slots.entries("conversation.input.left")).toHaveLength(0),
  );
  expect(b.root.get("remote.projectMode")).toBeUndefined();
  expect(b.listeners.size).toBe(0);
  expect(b.submission.active()).toBe(0);
  expect(b.locales()).toBe(0);
  expect(b.streamSignals[0].aborted).toBe(true);
  expect(b.slots.entries("conversation.composer")).toHaveLength(0);
  expect(
    b.root.uiConversation.events
      .entries()
      .some((e) => e.kind === "project-mode-workers-tail"),
  ).toBe(false);
  expect(
    b.root.uiConversation.events
      .entries()
      .some((e) => e.kind === "project-mode-human-boundary"),
  ).toBe(false);
  const count = b.call.mock.calls.length;
  b.root.emit("connection/reset");
  firstClient.watchRoots([]);
  await Promise.resolve();
  expect(b.call).toHaveBeenCalledTimes(count);

  mount.mockRestore();
  const remount = b.root.plugin({
    inject: ["remote"],
    apply: async (ctx: Context) => {
      await ctx.remote.$mount(moaRemoteDefinition);
    },
  });
  await remount;
  await vi.waitFor(() =>
    expect(b.slots.entries("conversation.input.left")).toHaveLength(1),
  );
  const secondClient = (
    b.slots.entries("conversation.input.left")[0].inject?.() as any
  ).client;
  expect(secondClient).not.toBe(firstClient);
  expect(b.listeners.size).toBe(3);
  expect(b.submission.active()).toBe(1);
  expect(b.locales()).toBe(1);
  await fiber.dispose();
  expect(b.slots.entries("conversation.input.left")).toHaveLength(0);
  expect(b.listeners.size).toBe(0);
  expect(b.submission.active()).toBe(0);
  expect(b.locales()).toBe(0);
  await remount.dispose();
  expect(b.root.get("remote.projectMode")).toBeUndefined();

  const reapplied = b.root.plugin(b.plugin);
  await reapplied;
  await vi.waitFor(() =>
    expect(b.slots.entries("conversation.input.left")).toHaveLength(1),
  );
  await reapplied.dispose();
  expect(b.streamSignals.every((signal) => signal.aborted)).toBe(true);
  expect(b.root.get("remote.projectMode")).toBeUndefined();
  expect(b.listeners.size).toBe(0);
  expect(b.locales()).toBe(0);
});
