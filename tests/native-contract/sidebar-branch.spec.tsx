// @vitest-environment jsdom
import React from "react";
import * as jsx from "react/jsx-runtime";
import * as cordis from "@deepseek-ai/cordis";
import * as store from "@deepseek-ai/dsh-client-store";
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { nativeLoader } from "../client/native-loader.ts";

const packageRoot = resolve(
  "node_modules/@deepseek-ai/dsh-client-ui-workspace",
);
const sourcePath =
  process.env.NATIVE_WORKSPACE_FILE ?? resolve(packageRoot, "lib/client.js");
function workspaceModule() {
  let definition: any;
  (window as any).__ModuleLoader__ = {
    load(value: unknown) {
      definition = value;
    },
  };
  // Expose the native row only within this test loader; shipped JS exports no internals.
  const source = readFileSync(sourcePath, "utf8").replace(
    "exports.apply = apply;",
    "exports.__test = { SessionNodeItem }; exports.apply = apply;",
  );
  new Function(source)();
  const modules: Record<string, unknown> = {
    "@deepseek-ai/cordis": cordis,
    "@deepseek-ai/dsh-client-store": store,
    "@deepseek-ai/dsh-client-ui-primitives": primitives,
    react: React,
    "react/jsx-runtime": jsx,
  };
  return definition.factory((id: string) => {
    if (!(id in modules))
      throw new Error(`Missing real native dependency ${id}`);
    return modules[id];
  });
}
const node = {
  kind: "session",
  id: "parent",
  title: "Coordinator",
  blank: false,
  archived: false,
  pinned: true,
  updatedAt: 1,
  createdAt: 1,
  pendingInteraction: undefined,
  runningSubagentCount: 0,
  status: "idle",
  unread: false,
};
afterEach(() => {
  cleanup();
  delete (window as any).__ModuleLoader__;
});
async function fixture() {
  localStorage.clear();
  const load = nativeLoader();
  const renderer = load<any>("@deepseek-ai/dsh-client-ui-renderer");
  const native = workspaceModule();
  const ctx = new cordis.Context();
  renderer.apply(ctx);
  const slots = (ctx as any).slots;
  const absent = store.createSnapshotStore({
    key: undefined,
    props: {},
    hooks: {},
    keyedHooks: {},
  });
  slots.installScope("session", {
    current: absent,
    bindingSource: () => absent,
    renderArea: (_props: unknown, children: unknown) => children,
    subscribeRelease: () => () => {},
  });
  const list = store.createSnapshotStore({
    phase: "loading",
    ids: [],
    byId: {},
  });
  ctx.provide("sessions", { list } as any);
  ctx.provide("workspaces", {
    list: store.createSnapshotStore({
      phase: "loading",
      items: [],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    }),
  } as any);
  ctx.provide("remote", {
    directoryPicker: {},
    $host: { home: "/tmp" },
  } as any);
  ctx.provide("remoteAccess", { source: () => undefined } as any);
  ctx.provide("locale", {
    register: () => () => {},
    bind: () => (key: string) => key,
  } as any);
  ctx.provide("shortcuts", {
    register: () => () => {},
    catalog: store.createSnapshotStore([]),
  } as any);
  slots.installLocale({
    bind: () => (key: string) => key,
    getSnapshot: () => 0,
    subscribe: () => () => {},
  });
  slots.register(
    {
      name: "root",
      children: { "sidebar.workspaces": { kind: "single", scope: "root" } },
    },
    ({ renderSlot }: any) =>
      renderSlot("sidebar.workspaces", { wide: true, expandSidebar() {} }),
  );
  native.apply(ctx);
  const entry = slots.entries("sidebar.workspaces")[0];
  return { ctx, slots, native, entry, list };
}
it("declares a public root chain on the original native browser without replacing it", async () => {
  const f = await fixture();
  try {
    expect(f.entry.component.name).toBe("WorkspaceBrowser");
    expect(f.slots.spec("sidebar.workspaces.session.branch")).toMatchObject({
      kind: "chain",
      scope: "root",
    });
    expect(
      f.entry.children["sidebar.workspaces.session.menu.item"],
    ).toBeDefined();
    expect(f.entry.children["sidebar.workspaces.directoryFlow"]).toBeDefined();
  } finally {
    cleanup();
    await f.ctx.fiber.dispose();
  }
});
it("renders worker children through native row callbacks and restores original behavior on unload", async () => {
  const f = await fixture();
  const open = vi.fn(),
    rename = vi.fn(),
    childOpen = vi.fn();
  try {
    // Keep the actual native browser declaration and renderer authority. Mount its
    // row in a focused test harness so host navigation is outside this contract.
    const SessionRow = f.native.__test.SessionNodeItem;
    f.entry.component = (props: any) => (
      <SessionRow
        {...props}
        node={node}
        currentId="parent"
        now={10}
        onOpen={open}
        onRenameRequest={rename}
        t={(key: string) => key}
      />
    );
    const child = f.slots.spec("sidebar.workspaces.session.branch");
    expect(child, "native branch extension is missing").toBeDefined();
    let owner: any;
    const dispose = f.slots.register(
      {
        name: "sidebar.workspaces.session.branch",
        select: (value: any) => (value.sessionId === "parent" ? true : null),
      },
      (props: any) => {
        owner = props;
        const [expanded, setExpanded] = React.useState(true);
        return (
          <>
            {props.renderRow(
              <button
                aria-label="toggle workers"
                onClick={() => setExpanded(!expanded)}
              >
                ›
              </button>,
            )}
            {expanded &&
              props.renderChild({
                sessionId: "child",
                title: "Worker",
                icon: <i data-testid="identity" />,
                trailing: "idle",
                selected: true,
                onOpen: childOpen,
              })}
          </>
        );
      },
    );
    const view = render(f.slots.renderSlot("root", {}));
    expect(owner.sessionId).toBe("parent");
    expect(owner.currentSessionId).toBe("parent");
    expect(owner.renderRow).toBeTypeOf("function");
    expect(owner.renderChild).toBeTypeOf("function");
    const parent = screen
      .getByText("Coordinator")
      .closest('[role="treeitem"]') as HTMLElement;
    const worker = screen
      .getByText("Worker")
      .closest('[role="treeitem"]') as HTMLElement;
    expect(parent.className).toContain("sessionRow");
    expect(worker.className).toBe(
      parent.className.replace(/ \S+menuOpen/g, ""),
    );
    expect(worker.hasAttribute("data-row-key")).toBe(false);
    expect(getComputedStyle(parent).height).toBe("32px");
    expect(getComputedStyle(worker).height).toBe("32px");
    expect(getComputedStyle(screen.getByText("Worker")).fontSize).toBe("14px");
    expect(getComputedStyle(screen.getByText("Worker")).textOverflow).toBe(
      "ellipsis",
    );
    expect(parent.firstElementChild?.getAttribute("style")).toBe(
      worker.firstElementChild?.getAttribute("style"),
    );
    expect(getComputedStyle(parent.firstElementChild!).width).toBe("12px");
    fireEvent.click(screen.getByText("Coordinator"));
    expect(open).toHaveBeenCalledWith("parent");
    fireEvent.doubleClick(screen.getByText("Coordinator"));
    expect(rename).toHaveBeenCalledWith("parent", "Coordinator");
    fireEvent.click(screen.getByText("Worker"));
    expect(childOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(worker, { key: "Enter" });
    fireEvent.keyDown(worker, { key: " " });
    expect(childOpen).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "toggle workers" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Worker")).toBeNull();
    expect(screen.getByText("Coordinator").closest('[role="treeitem"]')).toBe(
      parent,
    );
    await act(async () => dispose());
    expect(screen.queryByRole("button", { name: "toggle workers" })).toBeNull();
    const restored = screen
      .getByText("Coordinator")
      .closest('[role="treeitem"]')!;
    expect(restored.firstElementChild?.getAttribute("style")).toBeNull();
    fireEvent.click(screen.getByText("Coordinator"));
    expect(open).toHaveBeenCalledTimes(2);
    view.unmount();
  } finally {
    cleanup();
    await f.ctx.fiber.dispose();
  }
});

it.each(["workspace", "flat"])(
  "forwards the branch through the entire original %s browser",
  async (groupBy) => {
    const f = await fixture();
    const panel = store.createSnapshotStore({ activePanelId: null });
    const ws = (f.ctx as any).workspaces.list;
    const errors: unknown[] = [];
    f.slots.onEntryError((_key: string, _entry: unknown, error: unknown) =>
      errors.push(error),
    );
    try {
      f.list.set({
        phase: "loading",
        ids: ["parent"],
        byId: {
          parent: {
            id: "parent",
            title: "Coordinator",
            displayTitle: "Coordinator",
            blank: false,
            running: false,
            updatedAt: 1,
            retainedBy: { mainView: 1 },
          },
        },
        projectionsBySession: {},
      } as any);
      ws.set({
        phase: "ready",
        state: "ready",
        items: [],
        pinnedSessionIds: [],
        archivedSessionIds: [],
      });
      f.slots.provideRoot({
        hooks: {
          sessions: f.list,
          panelInfo: panel,
          sessionStatus: store.createSnapshotStore(new Map()),
        },
      });
      const instance = f.entry.store.create();
      instance.actions.setGroupBy(groupBy);
      let current: string | undefined;
      f.slots.register(
        { name: "sidebar.workspaces.session.branch", select: () => true },
        (props: any) => {
          current = props.currentSessionId;
          return (
            <>
              {props.renderRow(<button aria-label="toggle workers">›</button>)}
              <div role="group" style={{ display: "grid", gap: 2 }}>
                {props.renderChild({
                  sessionId: "child",
                  title: "Worker",
                  icon: <i />,
                  trailing: "idle",
                  selected: false,
                  onOpen() {},
                })}
              </div>
            </>
          );
        },
      );
      const view = render(f.slots.renderSlot("root", {}));
      expect(errors).toEqual([]);
      expect(screen.getByText("Coordinator")).toBeTruthy();
      expect(screen.getByText("Worker")).toBeTruthy();
      const heading =
        groupBy === "flat" ? "section.sessions" : "section.workspaces";
      expect(screen.getByText(heading)).toBeTruthy();
      expect(current).toBe("parent");
      const header = screen.getByText(heading);
      const row = screen.getByText("Coordinator").closest('[role="treeitem"]');
      expect(row).toBeTruthy();
      expect(getComputedStyle(row!).height).toBe("32px");
      if (groupBy === "workspace") {
        mkdirSync(".superpowers/native-sidebar", { recursive: true });
        writeFileSync(
          ".superpowers/native-sidebar/native-rows.html",
          '<!doctype html><html><head><meta charset="UTF-8">' +
            document.head.innerHTML +
            '<style>body{margin:20px;font-family:Arial;background:#fff;color:#222;--dsw-alias-label-primary:#222;--dsw-alias-label-tertiary:#888;--dsw-alias-interactive-bg-hover:#eee;--dsw-radius-md:6px}#root{width:280px}</style></head><body><main id="root">' +
            view.container.innerHTML +
            "</main></body></html>",
        );
      }
      await act(async () => panel.set({ activePanelId: "details" } as any));
      expect(current).toBeUndefined();
      expect(screen.getByText(heading)).toBe(header);
      view.unmount();
    } finally {
      cleanup();
      await f.ctx.fiber.dispose();
    }
  },
);

it("keeps native two-pixel sibling spacing when every branch selector declines", async () => {
  const f = await fixture();
  try {
    const byId = Object.fromEntries(
      ["parent", "other"].map((id) => [
        id,
        {
          id,
          title: id,
          blank: false,
          running: false,
          updatedAt: 1,
          retainedBy: {},
        },
      ]),
    );
    f.list.set({
      phase: "loading",
      ids: ["parent", "other"],
      byId,
      projectionsBySession: {},
    } as any);
    (f.ctx as any).workspaces.list.set({
      phase: "ready",
      state: "ready",
      items: [],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    });
    f.slots.provideRoot({
      hooks: {
        sessions: f.list,
        panelInfo: store.createSnapshotStore({ activePanelId: null }),
        sessionStatus: store.createSnapshotStore(new Map()),
      },
    });
    f.entry.store.create().actions.setGroupBy("flat");
    const view = render(f.slots.renderSlot("root", {}));
    const list = screen.getByRole("tree");
    expect(
      list.querySelectorAll(
        ':scope > [data-slot="sidebar.workspaces.session.branch"]',
      ),
      "display:contents anchors cannot receive the native sibling margin",
    ).toHaveLength(0);
    const seats = [...list.children];
    expect(seats).toHaveLength(2);
    expect(getComputedStyle(seats[0]).display).toBe("block");
    expect(getComputedStyle(seats[1]).display).toBe("block");
    expect(getComputedStyle(seats[1]).marginTop).toBe("2px");
    expect(
      getComputedStyle(screen.getByText("other").closest('[role="treeitem"]')!)
        .height,
    ).toBe("32px");
    view.unmount();
  } finally {
    cleanup();
    await f.ctx.fiber.dispose();
  }
});

it("exports the real MoABranch with native coordinator, ordinary and worker rows", async () => {
  const [{ MoABranch }, { MoAClient }, { snapshot, sid }, { en }] =
    await Promise.all([
      import("../../packages/moa/src/client/branch.tsx"),
      import("../../packages/moa/src/client/runtime.ts"),
      import("../client/fixture.ts"),
      import("../../packages/moa/src/client/locales.ts"),
    ]);
  const f = await fixture();
  const client = new MoAClient({} as any);
  const data = snapshot();
  data.workers.push({
    ...data.workers[0],
    workerId: sid("reviewer"),
    name: "Reviewer",
    status: "idle",
    phase: "idle",
  });
  client.store.accept(data);
  const open = vi.fn();
  const t = (key: keyof typeof en, args?: Record<string, unknown>) =>
    Object.entries(args ?? {}).reduce(
      (s, [k, v]) => s.replace(`{${k}}`, String(v)),
      en[key] as string,
    );
  const summary = (id: string, title: string, current = false) => ({
    id,
    title,
    blank: false,
    running: false,
    updatedAt: 1,
    retainedBy: current ? { mainView: 1 } : {},
  });
  try {
    localStorage.setItem("project-mode.branch:parent", "true");
    f.list.set({
      phase: "loading",
      ids: ["parent", "ordinary-a", "ordinary-b"],
      byId: {
        parent: summary("parent", "Coordinator", true),
        "ordinary-a": summary("ordinary-a", "Ordinary session A"),
        "ordinary-b": summary("ordinary-b", "Ordinary session B"),
      },
      projectionsBySession: {},
    } as any);
    (f.ctx as any).workspaces.list.set({
      phase: "ready",
      state: "ready",
      items: [
        {
          workspaceId: "fixture-workspace",
          title: "Native workspace",
          path: "/fixture",
          createdAt: "2026-10-29T00:00:00.000Z",
          sessionIds: ["parent", "ordinary-a", "ordinary-b"],
        },
      ],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    });
    f.slots.provideRoot({
      hooks: {
        sessions: f.list,
        panelInfo: store.createSnapshotStore({ activePanelId: null }),
        sessionStatus: store.createSnapshotStore(new Map()),
      },
    });
    f.slots.register(
      {
        name: "sidebar.workspaces.session.branch",
        select: (owner: any) =>
          owner.sessionId === "parent" ? { coordinator: true } : null,
      },
      (props: any) => (
        <MoABranch {...props} client={client} open={open} t={t} />
      ),
    );
    const view = render(f.slots.renderSlot("root", {}));
    expect(screen.getByText("Native workspace")).toBeTruthy();
    expect(screen.getByText("section.workspaces")).toBeTruthy();
    expect(screen.getByText("Ordinary session A")).toBeTruthy();
    expect(screen.getByText("Ordinary session B")).toBeTruthy();
    const parent = screen
      .getByText("Coordinator")
      .closest('[role="treeitem"]')!;
    const child = screen.getByText("Builder").closest('[role="treeitem"]')!;
    const reviewer = screen.getByText("Reviewer").closest('[role="treeitem"]')!;
    expect(
      [parent, child, reviewer].map((row) => getComputedStyle(row).height),
    ).toEqual(["32px", "32px", "32px"]);
    expect(child.querySelector("svg.pm-worker-icon")).toBeTruthy();
    expect(reviewer.querySelector("svg.pm-worker-icon")).toBeTruthy();
    expect(child.querySelector("svg")!.outerHTML).not.toBe(
      reviewer.querySelector("svg")!.outerHTML,
    );
    // Idle Projects use the disclosure as their leading cell, rather than
    // reserving a second empty native status cell before the title.
    expect(getComputedStyle(parent.children[1]!).display).toBe("none");
    expect(getComputedStyle(parent.firstElementChild!).width).toBe("16px");
    expect(getComputedStyle(child.firstElementChild!).display).toBe("none");
    expect(child.hasAttribute("data-row-key")).toBe(false);
    expect(reviewer.hasAttribute("data-row-key")).toBe(false);
    const html =
      '<!doctype html><html><head><meta charset="UTF-8">' +
      document.head.innerHTML +
      '<style>body{margin:20px;font-family:Arial;background:#fff;color:#222;--dsw-alias-label-primary:#222;--dsw-alias-label-tertiary:#888;--dsw-alias-interactive-bg-hover:#eee;--dsw-radius-md:6px}#root{width:280px;height:600px;display:flex}</style></head><body><main id="root">' +
      view.container.innerHTML +
      "</main></body></html>";
    const variant = sourcePath.includes("desktop") ? "desktop" : "npm";
    writeFileSync(".superpowers/native-sidebar/native-rows.html", html);
    writeFileSync(
      `.superpowers/native-sidebar/native-rows-${variant}.html`,
      html,
    );
    fireEvent.click(screen.getByText("Builder"));
    expect(open).toHaveBeenCalledWith({
      parentSessionId: "parent",
      childSessionId: "child",
      mode: "continuable",
    });
    const next = f.list.getSnapshot() as any;
    await act(async () =>
      f.list.set({
        ...next,
        byId: {
          ...next.byId,
          parent: summary("parent", "Coordinator"),
          child: summary("child", "Builder", true),
        },
      }),
    );
    expect(
      screen
        .getByText("Builder")
        .closest('[role="treeitem"]')!
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByText("Coordinator")
        .closest('[role="treeitem"]')!
        .getAttribute("aria-selected"),
    ).toBe("false");
    view.unmount();
  } finally {
    cleanup();
    client.dispose();
    await f.ctx.fiber.dispose();
  }
});
