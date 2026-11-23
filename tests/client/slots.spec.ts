// @vitest-environment jsdom
import React from "react";
import { render, cleanup, act, screen } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type * as Renderer from "@deepseek-ai/dsh-client-ui-renderer/client";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  apply,
  inject,
} from "../../packages/project-mode/src/client/index.tsx";
import { nativeLoader } from "./native-loader.ts";
import { snapshot, sid } from "./fixture.ts";
import { submissionFixture } from "./submission-fixture.ts";
function nativeFace() {
  return {
    hooks: {
      workspaceShortcuts: createSnapshotStore({
        searchRequest: 0,
        addRequested: false,
        directoryBusy: false,
        renameTarget: null,
      }),
    },
    closeAddWorkspace() {},
    setDirectoryBusy() {},
  };
}
it("registers on real native SlotRegistry without taking child owners, and unload restores native browser/composer", async () => {
  const capture = nativeLoader();
  const renderer = capture<typeof Renderer>(
      "@deepseek-ai/dsh-client-ui-renderer",
    ),
    conv = capture<typeof Conversation>(
      "@deepseek-ai/dsh-client-ui-conversation",
    );
  const root = new Context();
  const submission = submissionFixture(root);
  const slots = new renderer.SlotRegistry(root);
  new conv.UiConversation(root, {} as any);
  const mounts = vi.fn(async () => () => {}),
    streamDispose = vi.fn();
  let frame: (v: unknown) => void = () => {};
  const stream = {
    dispose: streamDispose,
    async *[Symbol.asyncIterator]() {
      yield { type: "baseline", value: snapshot() };
      await new Promise((r) => (frame = r));
    },
  };
  const remote = {
    catalog: vi.fn(async () => ({ ok: true, value: [snapshot()] })),
    follow: vi.fn(() => stream),
    mode: vi.fn(),
    setEnabled: vi.fn(),
  };
  root.provide("remote", { $mount: mounts, projectMode: remote } as any);
  root.provide("remote.projectMode", remote);
  root.provide("uiWorkspace", {} as any);
  root.provide("workspaces", {} as any);
  root.provide("sessions", {
    list: createSnapshotStore({
      ids: [sid("parent")],
      byId: { parent: { id: sid("parent"), retainedBy: {} } },
    }),
  } as any);
  root.provide("locale", { register: () => () => {} } as any);
  const declare = slots.register(
    {
      name: "root",
      children: {
        "sidebar.workspaces": { kind: "single", scope: "root" },
        "conversation.input.left": { kind: "list", scope: "session" },
        "conversation.chat.node": { kind: "keyed", scope: "session" },
        "conversation.chat.turnTail": { kind: "list", scope: "session" },
        "conversation.composer": { kind: "chain", scope: "session" },
      },
    } as any,
    ((_props: unknown) => null) as any,
  );
  const native = slots.register(
    {
      name: "sidebar.workspaces",
      inject: nativeFace,
      children: {
        "sidebar.workspaces.directoryFlow": { kind: "single", scope: "root" },
        "sidebar.workspaces.session.branch": { kind: "chain", scope: "root" },
      },
    } as any,
    (() => null) as any,
  );
  const original = slots.entries("sidebar.workspaces")[0];
  const fiber = root.plugin({ inject, apply });
  await fiber;
  try {
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(slots.entriesOfSlot("sidebar.workspaces")[0]).toBe(original);
    expect(slots.entriesOfSlot("sidebar.workspaces")).toHaveLength(1);
    expect(slots.entries("sidebar.workspaces.session.branch")).toHaveLength(1);
    expect(slots.spec("sidebar.workspaces.directoryFlow")).toBeDefined();
    expect(slots.spec("project-mode.browser.directoryFlow")).toBeUndefined();
    expect(
      root.uiConversation.events
        .entries()
        .some((e) => e.kind === "project-mode-workers-tail"),
    ).toBe(true);
    const active = slots
      .entriesOfSlot("conversation.chat.node")
      .find((e) => e.options.key === "project-mode-workers-tail")!;
    const props = {
      ...active.inject?.(),
      sessionId: sid("parent"),
      node: { data: { turn: 99 } },
      useChat: () => false,
      useSession: (select: any) =>
        select({ openState: "open", loadingOlder: false }),
      t: (key: string) => key,
    };
    const ui = render(
      React.createElement(active.component as React.ComponentType<any>, props),
    );
    expect(ui.container.firstChild).toBeNull();
    cleanup();
    expect(slots.entriesOfSlot("conversation.chat.turnTail")).toHaveLength(0);
    expect(submission.behavior(sid("parent"))).toBe("steer");
    const client = (active.inject?.() as any).client;
    for (const order of ["native-first", "outcomes-first"]) {
      const nativeClosed = createSnapshotStore(false),
        initial = snapshot(),
        base = {
          ...initial,
          streamEpoch: order,
          turnMemberships: initial.turnMemberships.map((m) => ({
            ...m,
            segmentStartSeq: 10,
            participationSeq: 14,
          })),
        };
      client.store.accept(base);
      const Seat = active.component as React.ComponentType<any>;
      const seat = {
        key: "persistent-native-seat",
        kind: "project-mode-workers-tail",
        target: "chat",
        visibility: "visible",
        anchorSeq: 15.2,
        data: { turn: 3, step: 1, segmentStartSeq: 10 },
      };
      function PersistentSeat() {
        const closed = React.useSyncExternalStore(
          nativeClosed.subscribe,
          nativeClosed.getSnapshot,
        );
        const shared = {
          ...active.inject?.(),
          sessionId: sid("parent"),
          t: (key: string) => key,
        };
        return React.createElement(Seat, {
          ...shared,
          node: seat,
          useChat: (select: any) =>
            select({
              nodes: { values: () => [seat] },
              timeline: {
                turns: new Map([[3, { end: closed ? {
                  type: "turn/end", seq: 16, time: 16000,
                  data: { turn: 3, reason: { kind: "completed" } },
                } : undefined }]]),
              },
            }),
          useSession: (select: any) =>
            select({ openState: "open", loadingOlder: false }),
        });
      }
      const view = render(React.createElement(PersistentSeat));
      const count = () =>
        screen.queryAllByRole("button", { name: "openWorker" }).length;
      expect(count()).toBe(1);
      act(() =>
        client.store.accept({ ...base, revision: 2, turnMemberships: [] }),
      );
      expect(count()).toBe(0);
      act(() => client.store.accept({ ...base, revision: 3 }));
      expect(count()).toBe(1);
      const mountedCapsule = screen.getByRole("button", { name: "openWorker" });
      const outcome = {
        ...base,
        revision: 4,
        closedTurnOutcomes: [
          {
            coordinatorSessionId: sid("parent"),
            coordinatorTurn: 3,
            segmentStartSeq: 10,
            workerId: sid("child"),
            status: "completed",
            completionIds: ["done"],
            summary: "Frozen result",
          },
        ],
      };
      if (order === "native-first") {
        act(() => nativeClosed.set(true));
        expect(count()).toBe(1);
        expect(screen.getByRole("button", { name: "openWorker" })).toBe(
          mountedCapsule,
        );
        expect(screen.getByText("Public text")).toBeTruthy();
        act(() =>
          client.store.accept({
            ...base,
            revision: 4,
            workers: [{ ...base.workers[0], progressText: "Later live run" }],
          }),
        );
        expect(count()).toBe(1);
        expect(screen.queryByText("Later live run")).toBeNull();
        act(() => client.store.accept(outcome));
      } else {
        act(() => client.store.accept(outcome));
        expect(count()).toBe(1);
        act(() => nativeClosed.set(true));
      }
      expect(count()).toBe(1);
      expect(screen.getByRole("button", { name: "openWorker" })).toBe(
        mountedCapsule,
      );
      expect(mountedCapsule.title).toContain("Frozen result");
      expect(mountedCapsule.textContent?.match(/completed/g)).toHaveLength(1);
      act(() =>
        client.store.accept({
          ...outcome,
          revision: 5,
          workers: [{ ...base.workers[0], progressText: "Later run" }],
        }),
      );
      expect(count()).toBe(1);
      expect(screen.queryByText("Later run")).toBeNull();
      view.unmount();
    }
    await fiber.dispose();
    expect(slots.entriesOfSlot("sidebar.workspaces")[0]).toBe(original);
    expect(slots.spec("sidebar.workspaces.directoryFlow")).toBeDefined();
    expect(slots.spec("project-mode.browser.directoryFlow")).toBeUndefined();
    expect(slots.entries("conversation.composer")).toHaveLength(0);
    expect(streamDispose).toHaveBeenCalled();
    expect(submission.active()).toBe(0);
    expect(
      root.uiConversation.events
        .entries()
        .some((e) => e.kind === "project-mode-workers-tail"),
    ).toBe(false);
  } finally {
    await fiber.dispose();
    native();
    declare();
    await root.fiber.dispose();
    delete (window as any).__ModuleLoader__;
    frame(undefined);
  }
});
it("waits for the native branch declaration and releases only its contribution on withdrawal", async () => {
  const capture = nativeLoader(),
    renderer = capture<typeof Renderer>("@deepseek-ai/dsh-client-ui-renderer"),
    conv = capture<typeof Conversation>(
      "@deepseek-ai/dsh-client-ui-conversation",
    );
  const root = new Context(),
    slots = new renderer.SlotRegistry(root);
  submissionFixture(root);
  new conv.UiConversation(root, {} as any);
  const remote = { catalog: async () => ({ ok: true, value: [] }) };
  root.provide("remote", {
    $mount: async () => () => {},
    projectMode: remote,
  } as any);
  root.provide("remote.projectMode", remote);
  root.provide("sessions", {
    list: createSnapshotStore({ ids: [], byId: {} }),
  } as any);
  root.provide("uiWorkspace", {} as any);
  root.provide("workspaces", {} as any);
  root.provide("locale", { register: () => () => {} } as any);
  const declare = slots.register(
    {
      name: "root",
      children: { "sidebar.workspaces": { kind: "single", scope: "root" } },
    } as any,
    (() => null) as any,
  );
  const fiber = root.plugin({ inject, apply });
  await fiber;
  let dispose = () => {};
  try {
    expect(slots.entriesOfSlot("sidebar.workspaces")).toHaveLength(0);
    expect(slots.entries("sidebar.workspaces.session.branch")).toHaveLength(0);
    for (let i = 0; i < 2; i++) {
      dispose = slots.register(
        {
          name: "sidebar.workspaces",
          children: {
            "sidebar.workspaces.directoryFlow": {
              kind: "single",
              scope: "root",
            },
            "sidebar.workspaces.session.branch": {
              kind: "chain",
              scope: "root",
            },
          },
        } as any,
        (() => null) as any,
      );
      await Promise.resolve();
      expect(slots.entriesOfSlot("sidebar.workspaces")).toHaveLength(1);
      expect(slots.entries("sidebar.workspaces.session.branch")).toHaveLength(
        1,
      );
      dispose();
      await Promise.resolve();
      expect(slots.entries("sidebar.workspaces.session.branch")).toHaveLength(
        0,
      );
    }
  } finally {
    await fiber.dispose();
    dispose();
    declare();
    await root.fiber.dispose();
    delete (window as any).__ModuleLoader__;
  }
});
