// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import type * as Renderer from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { SessionModeView } from "../../packages/moa/src/shared/index.ts";
import { MoAClient } from "../../packages/moa/src/client/runtime.ts";
import { bindCoordinatorInputPolicy } from "../../packages/moa/src/client/input-policy.ts";
import { nativeLoader } from "./native-loader.ts";
import { snapshot, sid } from "./fixture.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose();
  delete (window as any).__ModuleLoader__;
});

/** Actual published Conversation factory and native per-Session bar sources.
 * Session transport is unused: these tests exercise Project state → native
 * composer policy. The real Enter/Send admission is covered by the capability
 * compatibility tests, through the same sources and native InputBar. */
async function bench() {
  const load = nativeLoader();
  const renderer = load<typeof Renderer>(
    "@deepseek-ai/dsh-client-ui-renderer",
  );
  const conversation = load<typeof Conversation>(
    "@deepseek-ai/dsh-client-ui-conversation",
  );
  const root = new Context();
  cleanups.push(() => root.fiber.dispose());
  const slots = new renderer.SlotRegistry(root);
  slots.register(
    { name: "root", children: { main: { kind: "keyed", scope: "root" } } } as any,
    (() => null) as any,
  );
  const bindings = new Map<string, any>();
  const sessions = createSnapshotStore({
    ids: [sid("parent"), sid("child"), sid("ordinary")],
  });
  root.provide("sessions", {
    list: sessions,
    binding: (id: string) => bindings.get(id),
    sessionOf: (ctx: Context) =>
      [...bindings.values()].find((b) => b.ctx === ctx)?.session,
  } as any);
  const preference = createSnapshotStore({ value: { busyEnter: "queue" } });
  const settingsWrite = vi.fn();
  root.provide("configForms", {
    get: () => ({ ...preference, set: settingsWrite }),
    developerTools: { enabled: createSnapshotStore(false) },
  } as any);
  root.provide("uiSession", { provide: () => () => {} } as any);
  root.provide("fileUpload", {} as any);
  root.provide("uiWorkspace", {} as any);
  root.provide("locale", {
    register: () => () => {},
    bind: () => (key: string) => key,
    subscribe: () => () => {},
  } as any);
  await root.plugin(conversation);
  await vi.waitFor(() => expect(root.get("conversation")).toBeDefined());
  const bar = slots.entries("conversation.composer.bar")[0];
  const modes = new Map<string, SessionModeView>();
  const client = new MoAClient({
    mode: vi.fn(async (id: string) => ({ ok: true, value: modes.get(id)! })),
  } as any);
  cleanups.push(() => client.dispose());
  function busy(id: string, worker = false) {
    const ctx = root.extend({});
    const session = {
      sessionId: sid(id),
      ...createSnapshotStore({
        sessionId: sid(id),
        running: true,
        removed: false,
        blank: false,
        subagent: worker
          ? {
              address: {
                parentSessionId: sid("parent"),
                childSessionId: sid(id),
                mode: "continuable",
              },
              parentAvailable: true,
            }
          : null,
      }),
      projections: { faceOf: () => createSnapshotStore(undefined) },
    };
    bindings.set(id, { sessionId: sid(id), session, ctx });
    const face = bar.inject?.(sid(id) as never) as unknown as Conversation.ComposerBarInjected;
    return face.hooks.busyEnter;
  }
  const bind = () => {
    const restore = bindCoordinatorInputPolicy(
      client,
      root.conversation.submission,
      sessions,
    );
    cleanups.push(restore);
    return restore;
  };
  return { root, client, busy, modes, bind, sessions, preference, settingsWrite };
}

it("changes only the enabled coordinator's native bar, follows newer mode/frame facts, and releases on unload", async () => {
  const b = await bench();
  const parent = b.busy("parent"),
    worker = b.busy("child", true),
    ordinary = b.busy("ordinary");
  const restore = b.bind();
  const project = snapshot();
  b.client.store.accept(project);
  expect(parent.getSnapshot()).toBe("steer");
  expect(worker.getSnapshot()).toBe("queue");
  expect(ordinary.getSnapshot()).toBe("queue");

  b.modes.set("parent", {
    sessionId: sid("parent"), role: "coordinator", enabled: false,
    revision: 2, canToggle: true,
  });
  await b.client.refreshMode(sid("parent"));
  expect(parent.getSnapshot()).toBe("queue");
  b.client.store.accept({ ...project, revision: 2 });
  expect(parent.getSnapshot()).toBe("queue");

  b.client.store.accept({
    ...project,
    project: { ...project.project, revision: 3 },
    revision: 3,
  });
  expect(parent.getSnapshot()).toBe("steer");
  restore();
  restore();
  expect(parent.getSnapshot()).toBe("queue");
  b.client.store.accept({
    ...project,
    project: { ...project.project, revision: 4 },
    revision: 4,
  });
  b.sessions.set({ ids: [sid("parent")] });
  expect(parent.getSnapshot()).toBe("queue");
  expect(b.settingsWrite).not.toHaveBeenCalled();
});

it("accepts an enabled coordinator mode before its catalog frame, preserving live ordinary/worker preferences", async () => {
  const b = await bench();
  const parent = b.busy("parent"),
    worker = b.busy("child", true),
    ordinary = b.busy("ordinary");
  const restore = b.bind();
  for (const [id, role] of [
    ["parent", "coordinator"], ["child", "worker"], ["ordinary", "ordinary"],
  ] as const) {
    b.modes.set(id, {
      sessionId: sid(id), role, enabled: role === "coordinator",
      revision: 1, canToggle: role !== "worker",
    });
    await b.client.refreshMode(sid(id));
  }
  expect(parent.getSnapshot()).toBe("steer");
  expect(worker.getSnapshot()).toBe("queue");
  expect(ordinary.getSnapshot()).toBe("queue");

  b.preference.set({ value: { busyEnter: "steer" } });
  expect(worker.getSnapshot()).toBe("steer");
  expect(ordinary.getSnapshot()).toBe("steer");
  restore();
  expect(parent.getSnapshot()).toBe("steer");
  expect(b.settingsWrite).not.toHaveBeenCalled();
});

it("restores an existing native owner and removes listeners before later Project updates", async () => {
  const b = await bench();
  const parent = b.busy("parent");
  const priorOwner = b.root.conversation.submission.register(sid("parent"), "queue");
  b.client.store.accept(snapshot());
  const restore = b.bind();
  expect(parent.getSnapshot()).toBe("steer");
  restore();
  expect(parent.getSnapshot()).toBe("queue");
  b.client.store.accept({ ...snapshot(), revision: 2 });
  expect(parent.getSnapshot()).toBe("queue");
  priorOwner();
  b.preference.set({ value: { busyEnter: "steer" } });
  expect(parent.getSnapshot()).toBe("steer");
  expect(b.settingsWrite).not.toHaveBeenCalled();
});

it("rejects a host missing the native policy capability before registering Project listeners", () => {
  const client = new MoAClient({} as any);
  expect(() =>
    bindCoordinatorInputPolicy(
      client,
      undefined as any,
      createSnapshotStore({ ids: [] }),
    ),
  ).toThrow(/native.*composer.*compatibility/i);
  client.dispose();
});
