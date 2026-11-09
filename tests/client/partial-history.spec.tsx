// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type * as Renderer from "@deepseek-ai/dsh-client-ui-renderer/client";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import type * as Chat from "@deepseek-ai/dsh-client-ui-chat/client";
import { MessageId } from "@deepseek-ai/dsh-llm/brand";
import {
  apply,
  inject,
} from "../../packages/moa/src/client/index.tsx";
import { nativeLoader } from "./native-loader.ts";
import { snapshot, sid } from "./fixture.ts";
import { submissionFixture } from "./submission-fixture.ts";

const roots: Context[] = [];
afterEach(async () => {
  cleanup();
  for (const root of roots.splice(0).reverse()) await root.fiber.dispose();
  delete (window as any).__ModuleLoader__;
});

async function bench(loadingOlder = false) {
  const capture = nativeLoader();
  capture("@deepseek-ai/dsh-client-modules");
  const renderer = capture<typeof Renderer>(
    "@deepseek-ai/dsh-client-ui-renderer",
  );
  const conv = capture<typeof Conversation>(
    "@deepseek-ai/dsh-client-ui-conversation",
  );
  const chat = capture<typeof Chat>("@deepseek-ai/dsh-client-ui-chat");
  const model = new Context();
  roots.push(model);
  const service = new conv.UiConversation(model, {} as any),
    noop = () => () => {};
  model.provide("slots", { inject: noop, registerFactory: noop } as any);
  model.provide("uiSession", { provide: noop } as any);
  model.provide("locale", { register: noop, bind: () => () => "" } as any);
  const setting = createSnapshotStore({ value: {} });
  model.provide("configForms", {
    get: () => ({ ...setting, set: async () => {} }),
  } as any);
  chat.apply(model);

  const root = new Context();
  roots.push(root);
  const slots = new renderer.SlotRegistry(root);
  root.provide("uiConversation", service);
  submissionFixture(root);
  const remote = { catalog: async () => ({ ok: true, value: [] }) };
  root.provide("remote", {
    $mount: async () => () => {},
    projectMode: remote,
  } as any);
  root.provide("remote.projectMode", remote);
  root.provide("uiWorkspace", {} as any);
  root.provide("workspaces", {} as any);
  root.provide("locale", { register: () => () => {} } as any);
  let resolve!: () => void, reject!: (error: Error) => void;
  const loadThrough = vi.fn(
    () =>
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  const session = createSnapshotStore({ openState: "open", loadingOlder });
  const binding = { session: { ...session, loadThrough } };
  root.provide("sessions", {
    list: createSnapshotStore({ ids: [], byId: {} }),
    binding: () => binding,
  } as any);
  slots.register(
    {
      name: "root",
      children: {
        "conversation.chat.node": { kind: "keyed", scope: "session" },
      },
    } as any,
    (() => null) as any,
  );
  const fiber = root.plugin({ inject, apply });
  await fiber;
  const entry = slots
    .entries("conversation.chat.node")
    .find((entry) => entry.options.key === "project-mode-workers-tail")!;
  const client = (entry.inject?.() as any).client;
  const a = new conv.ConversationNodeAssembler(
    service.events,
    service.views,
    service.groups,
  );
  const event = (type: string, seq: number, data: unknown) =>
    ({
      type: "event",
      event: { type, seq, time: seq * 1000, surfaceOp: "append", data },
    }) as any;
  const assistant = (seq: number, step: number) =>
    event("assistant/message", seq, {
      turn: 1,
      step,
      message: {
        id: MessageId("assistant-" + seq),
        role: "assistant",
        source: { kind: "model", provider: "fixture", model: "fixture" },
        content: [{ type: "text", text: "working" }],
      },
      stream: [],
    });
  const human = (seq: number) =>
    event("user/message", seq, {
      id: MessageId("human-" + seq),
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "continue" }],
    });
  a.replaceWindow([assistant(101, 3)], true);
  a.activateTarget("chat");
  const read = () => {
    a.flush();
    return a.get("chat")!;
  };
  const source = createSnapshotStore(read());
  const Seat = entry.component as React.ComponentType<any>;
  function Seats() {
    const snapshot = React.useSyncExternalStore(
      source.subscribe,
      source.getSnapshot,
    );
    const sessionState = React.useSyncExternalStore(
      session.subscribe,
      session.getSnapshot,
    );
    return (
      <>
        {snapshot.nodes
          .values()
          .filter((node) => node.kind === "project-mode-workers-tail")
          .map((node) => (
            <Seat
              key={node.key}
              {...entry.inject?.()}
              sessionId={sid("parent")}
              node={node}
              useChat={(select: any) => select(snapshot)}
              useSession={(select: any) => select(sessionState)}
              t={(key: string) => key}
            />
          ))}
      </>
    );
  }
  const project = snapshot();
  project.turnMemberships = [
    {
      ...project.turnMemberships[0],
      coordinatorTurn: 1,
      segmentStartSeq: 3,
      participationSeq: 5,
    },
  ];
  return {
    client,
    fiber,
    loadThrough,
    Seats,
    addMembership: () => act(() => client.store.accept(project)),
    resolve: () => resolve(),
    reject: () => reject(new Error("history transport failed")),
    setLoading: (loadingOlder: boolean) =>
      act(() =>
        session.set({
          openState: "open",
          loadingOlder,
        }),
      ),
    step: () =>
      act(() => {
        a.append(assistant(103, 4));
        source.set(read());
      }),
    prepend: () =>
      act(() => {
        a.prepend(
          [
            event("turn/start", 1, { turn: 1 }),
            event("step/start", 2, { turn: 1, step: 1 }),
            human(3),
            assistant(10, 1),
            human(90),
          ],
          false,
        );
        source.set(read());
      }),
  };
}

it("a native seat arriving before Project membership requests its canonical history once, then preserves passive-segment separation", async () => {
  const b = await bench();
  const view = render(<b.Seats />);
  expect(b.loadThrough).not.toHaveBeenCalled();
  expect(screen.queryAllByRole("button", { name: "openWorker" })).toHaveLength(
    0,
  );
  b.addMembership();
  expect(b.loadThrough).toHaveBeenCalledExactlyOnceWith(3);
  view.rerender(<b.Seats />);
  b.step();
  expect(b.loadThrough).toHaveBeenCalledTimes(1);
  await act(async () => {
    b.prepend();
    b.resolve();
  });
  expect(screen.queryAllByRole("button", { name: "openWorker" })).toHaveLength(
    1,
  );
  expect(b.loadThrough).toHaveBeenCalledTimes(1);
  view.unmount();
  await b.fiber.dispose();
});

it("a rejected shared history load is bounded, can retry on remount, and starts no further work after unmount", async () => {
  const b = await bench();
  b.addMembership();
  const first = render(<b.Seats />);
  expect(b.loadThrough).toHaveBeenCalledExactlyOnceWith(3);
  b.setLoading(true);
  await act(async () => b.reject());
  b.setLoading(false);
  expect(screen.queryAllByRole("button", { name: "openWorker" })).toHaveLength(
    0,
  );
  expect(b.loadThrough).toHaveBeenCalledTimes(1);
  first.unmount();
  const second = render(<b.Seats />);
  expect(b.loadThrough).toHaveBeenCalledTimes(2);
  second.unmount();
  await act(async () => b.resolve());
  b.step();
  expect(b.loadThrough).toHaveBeenCalledTimes(2);
  await b.fiber.dispose();
});

it("waits for existing native paging to settle then loads the unchanged canonical target when that page still lacks its boundary", async () => {
  const b = await bench(true);
  const view = render(<b.Seats />);
  b.addMembership();
  expect(b.loadThrough).not.toHaveBeenCalled();
  // The unrelated native page updated Chat, but still starts in this turn's
  // unknown prefix; the durable boundary target remains exactly seq3.
  b.step();
  expect(b.loadThrough).not.toHaveBeenCalled();
  b.setLoading(false);
  expect(b.loadThrough).toHaveBeenCalledExactlyOnceWith(3);
  b.setLoading(true);
  await act(async () => b.resolve());
  b.setLoading(false);
  expect(b.loadThrough).toHaveBeenCalledTimes(1);
  view.unmount();
  await b.fiber.dispose();
});
