// @vitest-environment jsdom
import * as React from "react";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type * as Renderer from "@deepseek-ai/dsh-client-ui-renderer/client";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  apply,
  inject,
} from "../../packages/project-mode/src/client/index.tsx";
import { nativeLoader } from "./native-loader.ts";
import { submissionFixture } from "./submission-fixture.ts";
import { snapshot, sid } from "./fixture.ts";
import { en } from "../../packages/project-mode/src/client/locales.ts";
import type {
  WorkerMessageAttachment,
  WorkerTimelineTurn,
} from "../../packages/project-mode/src/shared/index.ts";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";

const dispose: (() => unknown)[] = [];
afterEach(async () => {
  cleanup();
  for (const off of dispose.splice(0).reverse()) await off();
  localStorage.clear();
  delete (window as any).__ModuleLoader__;
});
async function bench(
  inputText?: string,
  attachments?: WorkerMessageAttachment[],
  initialTurns?: WorkerTimelineTurn[],
) {
  const load = nativeLoader(),
    root = new Context();
  dispose.push(() => root.fiber.dispose());
  const renderer = load<typeof Renderer>("@deepseek-ai/dsh-client-ui-renderer"),
    conversation = load<typeof Conversation>(
      "@deepseek-ai/dsh-client-ui-conversation",
    );
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
        "conversation.session.header.actions": {
          kind: "list",
          scope: "session",
        },
        "conversation.session.header.views.actions": {
          kind: "list",
          scope: "root",
        },
        "sidebar.right.pane.tab": { kind: "keyed", scope: "session" },
      },
    } as any,
    (() => null) as any,
  );
  const mounted = createSnapshotStore(sid("parent")),
    tabs: any[] = [],
    types = new Map();
  const sidebar = {
    mounted,
    tabsIn: () => tabs,
    active: () => tabs[0],
    focus: vi.fn(),
    openTabIn: vi.fn((_id, kind) => tabs.push({ id: "workers-tab", kind })),
    openResourceIn: vi.fn((_id, address) =>
      tabs.push({ id: "notes-tab", kind: "text", contentId: address }),
    ),
  };
  root.provide("sidebarRight", sidebar as any);
  root.provide("sidebarRightTabs", {
    subscribe: () => () => {},
    entries: () => [...types.values()],
    claim: () => ({ kind: "text" }),
    register: (definition: any) => {
      types.set(definition.kind, definition);
      return () => types.delete(definition.kind);
    },
  } as any);
  const streamSignals: AbortSignal[] = [],
    streamDisposals = vi.fn();
  let turns = initialTurns,
    revision = 0;
  const frameListeners = new Set<() => void>();
  const remote = {
    catalog: async () => ({ ok: true, value: [snapshot()] }),
    timeline: vi.fn((_parent, workerId, limit, signal) => {
      streamSignals.push(signal);
      return {
        dispose: streamDisposals,
        async *[Symbol.asyncIterator]() {
          let observedRevision = -1;
          while (!signal.aborted) {
            if (observedRevision === revision) {
              await new Promise<void>((resolve) => {
                const finish = () => {
                  frameListeners.delete(finish);
                  signal.removeEventListener("abort", finish);
                  resolve();
                };
                frameListeners.add(finish);
                signal.addEventListener("abort", finish, { once: true });
                if (signal.aborted || observedRevision !== revision) finish();
              });
              continue;
            }
            observedRevision = revision;
            yield {
              workerId,
              total: turns?.length ?? 11,
              hasMore: limit < (turns?.length ?? 11),
              turns: turns ?? [
                {
                  turn: 2,
                  startedAt: 1700000000000,
                  finishedAt: 1700000001000,
                  outcome: "completed",
                  inputs: [
                    {
                      id: "in",
                      time: 1700000000000,
                      text:
                        inputText ??
                        `## Input ${workerId}\n\n- **Keep** this input as written.`,
                      actor: "user",
                      ...(attachments ? { attachments } : {}),
                    },
                  ],
                  outputs: [
                    {
                      id: "out",
                      time: 1700000001000,
                      text: `Output ${workerId}`,
                    },
                  ],
                  artifacts: [
                    { path: "report.md", kind: "changed", time: 1700000001000 },
                  ],
                },
              ],
            };
          }
        },
      };
    }),
  };
  root.provide("remote", {
    $mount: async () => () => {},
    projectMode: remote,
  } as any);
  root.provide("remote.projectMode", remote);
  root.provide("sessions", {
    list: createSnapshotStore({ ids: [], byId: {} }),
  } as any);
  root.provide("uiWorkspace", { openSession: vi.fn() } as any);
  root.provide("workspaces", {} as any);
  root.provide("locale", { register: () => () => {}, bind: () => t } as any);
  const fiber = root.plugin({ inject, apply });
  await fiber;
  const client = (slots.entries("conversation.input.left")[0].inject?.() as any)
    .client;
  await vi.waitFor(() =>
    expect(client.store.project(sid("parent"))).toBeDefined(),
  );
  return {
    root,
    fiber,
    slots,
    client,
    sidebar,
    types,
    remote,
    streamSignals,
    streamDisposals,
    emitTimeline(next: WorkerTimelineTurn[]) {
      turns = next;
      revision++;
      for (const notify of [...frameListeners]) notify();
    },
  };
}
const t = (key: keyof typeof en, args?: Record<string, any>) =>
  String(en[key] ?? key).replace(/\{(\w+)\}/g, (_, key) =>
    String(args?.[key] ?? key),
  );

function drawTimeline(
  b: Awaited<ReturnType<typeof bench>>,
  openResource = vi.fn(),
) {
  const entry = b.slots
    .entries("sidebar.right.pane.tab")
    .find((entry: any) => entry.options.key === "project-mode-workers")!;
  const Component = entry.component as any;
  const signal = new AbortController().signal;
  return {
    openResource,
    ...render(
      <Component
        {...entry.inject?.()}
        sessionId={sid("parent")}
        t={t}
        useTabInfo={() => ({
          tab: { visible: true, signal, actions: { openResource } },
        })}
      />,
    ),
  };
}

function timelineTurn(
  turn: number,
  patch: Partial<WorkerTimelineTurn> = {},
): WorkerTimelineTurn {
  return {
    turn,
    startedAt: 1700000000000 + turn * 1000,
    finishedAt: 1700000000500 + turn * 1000,
    outcome: "completed",
    inputs: [
      {
        id: `in-${turn}`,
        seq: turn * 10,
        time: 1700000000000 + turn * 1000,
        actor: "coordinator",
        text: `### Assignment ${turn}\n\nExact task ${turn}.`,
      },
    ],
    outputs: [
      {
        id: `out-${turn}`,
        seq: turn * 10 + 1,
        time: 1700000000500 + turn * 1000,
        text: `### Findings ${turn}\n\nExact result ${turn}.`,
      },
    ],
    artifacts: [
      {
        path: `report-${turn}.md`,
        kind: "changed",
        seq: turn * 10 + 2,
        time: 1700000000500 + turn * 1000,
      },
    ],
    ...patch,
  };
}

function taskCard(turn: number): HTMLDetailsElement {
  return screen
    .getByText(t("timelineTurn", { turn }))
    .closest<HTMLDetailsElement>("details")!;
}

it("shows attachment-only timeline input and opens its existing native file resource", async () => {
  const b = await bench("", [
    {
      type: "image",
      attachment: {
        attachmentId: AttachmentId("e".repeat(64)),
        name: "diagram.png",
        mediaType: "image/png",
        bytes: 31,
        width: 2,
        height: 3,
      },
      path: "/attachments/diagram.png",
    },
  ]);
  const entry = b.slots
    .entries("sidebar.right.pane.tab")
    .find((e: any) => e.options.key === "project-mode-workers")!;
  const Component = entry.component as any;
  const openResource = vi.fn();
  const signal = new AbortController().signal;
  const ui = render(
    <Component
      {...entry.inject?.()}
      sessionId={sid("parent")}
      t={t}
      useTabInfo={() => ({
        tab: { visible: true, signal, actions: { openResource } },
      })}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "diagram.png" }));
  expect(openResource).toHaveBeenCalledWith(
    expect.stringContaining("diagram.png"),
  );
  expect(
    [...ui.container.querySelectorAll("summary")].some(
      (summary) => summary.textContent === "",
    ),
  ).toBe(false);
});

it.each([
  {
    kind: "code",
    text: "```js\nconst first = 1;\nconst last = 2;\n```",
    preview: "const first = 1; const last = 2;",
  },
  {
    kind: "table",
    text: "| Item | State |\n| --- | --- |\n| A | First |\n| B | Last |",
    preview: "Item State A First B Last",
  },
])(
  "previews $kind as text and expands its complete native Markdown",
  async ({ kind, text, preview }) => {
    const b = await bench(text);
    const entry = b.slots
      .entries("sidebar.right.pane.tab")
      .find((e: any) => e.options.key === "project-mode-workers")!;
    const Component = entry.component as any;
    const signal = new AbortController().signal;
    render(
      <Component
        {...entry.inject?.()}
        sessionId={sid("parent")}
        t={t}
        useTabInfo={() => ({ tab: { visible: true, signal, actions: {} } })}
      />,
    );
    const excerpt = await screen.findByText(preview);
    const summary = excerpt.closest("summary")!;
    const disclosure = summary.closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: en.copy })).toBeNull();
    fireEvent.click(excerpt);
    expect(disclosure.open).toBe(true);
    await vi.waitFor(() => expect(summary.textContent).toBe(en.collapseText));
    if (kind === "table") expect(await screen.findByRole("table")).toBeTruthy();
    else {
      expect(await screen.findByRole("button", { name: en.copy })).toBeTruthy();
      expect(disclosure.querySelector("pre code")?.textContent).toContain(
        "const last = 2;",
      );
    }
    expect(summary.querySelector("table,pre,button,a")).toBeNull();
    fireEvent.click(summary);
    expect(disclosure.open).toBe(false);
    await screen.findByText(preview);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: en.copy })).toBeNull();
  },
);

it("opens the latest task and keeps an older round compact until its complete result is requested", async () => {
  const b = await bench(undefined, undefined, [
    timelineTurn(2),
    timelineTurn(1),
  ]);
  const ui = drawTimeline(b);
  await screen.findByText("Findings 2 Exact result 2.");
  const latest = taskCard(2),
    older = taskCard(1);
  expect(latest.open).toBe(true);
  expect(older.open).toBe(false);
  expect(within(older).getByText("Assignment 1 Exact task 1.")).toBeDefined();
  expect(screen.queryByText("Findings 1 Exact result 1.")).toBeNull();
  expect(
    latest.querySelector<HTMLDetailsElement>(".pm-task-messages")?.open,
  ).toBe(false);
  expect(latest.querySelector(".pm-task-message-list")).toBeNull();

  fireEvent.click(older.querySelector("summary")!);
  const preview = await within(older).findByText("Findings 1 Exact result 1.");
  const result = preview.closest<HTMLDetailsElement>("details")!;
  expect(result.open).toBe(false);
  fireEvent.click(preview);
  expect(
    await within(older).findByRole("heading", { name: "Findings 1" }),
  ).toBeDefined();
  expect(within(older).getByText("Exact result 1.")).toBeDefined();
  expect(latest.open).toBe(true);
  fireEvent.click(within(older).getByRole("button", { name: "report-1.md" }));
  expect(ui.openResource).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("/child/report-1.md"),
  );
  expect(older.open).toBe(true);
});

it("hides later communication by default, restores the original message, and opens its native attachment", async () => {
  const rawTask = "From: coordinator\n### Clean task\n\nActual responsibility.";
  const rawFollowup =
    "Request ID: original-request\nFrom: teammate\n\n### Exact followup\n\nRetain this entire original message.";
  const turn = timelineTurn(2, {
    inputs: [
      {
        id: "task",
        seq: 20,
        time: 1700000000000,
        actor: "coordinator",
        text: rawTask,
        displayText: "### Clean task\n\nActual responsibility.",
      },
      {
        id: "followup",
        seq: 21,
        time: 1700000000100,
        actor: "agent",
        text: rawFollowup,
        displayText:
          "### Exact followup\n\nRetain this entire original message.",
        attachments: [
          {
            type: "image",
            path: "/attachments/followup.png",
            attachment: {
              attachmentId: AttachmentId("f".repeat(64)),
              name: "followup.png",
              mediaType: "image/png",
              bytes: 31,
              width: 2,
              height: 3,
            },
          },
        ],
      },
    ],
  });
  const b = await bench(undefined, undefined, [turn]);
  const ui = drawTimeline(b);
  await screen.findByText("Clean task Actual responsibility.");
  const card = taskCard(2);
  const messages = card.querySelector<HTMLDetailsElement>(".pm-task-messages")!;
  expect(messages.open).toBe(false);
  expect(
    screen.queryByText("Exact followup Retain this entire original message."),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "followup.png" })).toBeNull();
  expect(ui.container.textContent).not.toContain("From: coordinator");
  expect(ui.container.textContent).not.toContain(
    "Request ID: original-request",
  );

  fireEvent.click(messages.querySelector("summary")!);
  await within(messages).findByText(
    "Exact followup Retain this entire original message.",
  );
  const originals =
    messages.querySelectorAll<HTMLDetailsElement>(".pm-task-raw");
  expect(originals).toHaveLength(2);
  expect([...originals].every((item) => !item.open)).toBe(true);
  fireEvent.click(originals[1].querySelector("summary")!);
  expect(originals[1].open).toBe(true);
  expect(
    await within(originals[1]).findByRole("heading", {
      name: "Exact followup",
    }),
  ).toBeDefined();
  expect(originals[1].textContent).toContain("Request ID: original-request");
  expect(originals[1].textContent).toContain("From: teammate");
  expect(originals[1].textContent).toContain(
    "Retain this entire original message.",
  );
  fireEvent.click(
    within(messages).getByRole("button", { name: "followup.png" }),
  );
  expect(ui.openResource).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("followup.png"),
  );
  expect(messages.open).toBe(true);
  expect(card.open).toBe(true);
});

it("folds the previous default task for a new round while keeping manual choices through stream frames", async () => {
  const second = timelineTurn(2),
    first = timelineTurn(1),
    third = timelineTurn(3);
  const b = await bench(undefined, undefined, [second, first]);
  drawTimeline(b);
  await screen.findByText("Findings 2 Exact result 2.");
  expect(taskCard(2).open).toBe(true);
  act(() => b.emitTimeline([third, second, first]));
  await screen.findByText("Findings 3 Exact result 3.");
  await vi.waitFor(() => expect(taskCard(2).open).toBe(false));
  expect(taskCard(3).open).toBe(true);
  expect(taskCard(1).open).toBe(false);

  const secondCard = taskCard(2),
    thirdCard = taskCard(3);
  fireEvent.click(secondCard.querySelector("summary")!);
  const excerpt = await within(secondCard).findByText(
    "Findings 2 Exact result 2.",
  );
  fireEvent.click(excerpt);
  await within(secondCard).findByRole("heading", { name: "Findings 2" });
  fireEvent.click(thirdCard.querySelector("summary")!);
  expect(thirdCard.open).toBe(false);
  const updated = {
    ...second,
    outputs: [
      {
        ...second.outputs[0],
        text: "### Updated evidence\n\nLater streamed result.",
      },
    ],
  };
  act(() => b.emitTimeline([timelineTurn(4), third, updated, first]));
  await screen.findByRole("heading", { name: "Updated evidence" });
  expect(taskCard(4).open).toBe(true);
  expect(taskCard(3)).toBe(thirdCard);
  expect(thirdCard.open).toBe(false);
  expect(taskCard(2)).toBe(secondCard);
  expect(secondCard.open).toBe(true);
  expect(within(secondCard).getByText("Later streamed result.")).toBeDefined();
  expect(b.remote.timeline).toHaveBeenCalledTimes(1);
});

it("registers a native Workers tab and defaults once to Workers and the native notes preview without reopening closed tabs", async () => {
  const b = await bench();
  expect(b.types.has("project-mode-workers")).toBe(true);
  const entry = b.slots
    .entries("conversation.session.header.actions")
    .find((e: any) => e.options.id === "project-mode.panels")!;
  const props = {
    ...entry.inject?.(),
    sessionId: sid("parent"),
    useSession: (select: any) => select({ openState: "open" }),
  };
  const Component = entry.component as any;
  const ui = render(<Component {...props} />);
  await vi.waitFor(() => expect(b.sidebar.openTabIn).toHaveBeenCalledTimes(1));
  expect(b.sidebar.openResourceIn).toHaveBeenCalledExactlyOnceWith(
    sid("parent"),
    expect.stringContaining("/parent/notes"),
  );
  b.sidebar.tabsIn().splice(0);
  ui.unmount();
  render(<Component {...props} />);
  expect(b.sidebar.openTabIn).toHaveBeenCalledTimes(1);
  await b.fiber.dispose();
  expect(b.types.size).toBe(0);
});

it("selects workers inside one native tab, renders per-turn inputs/outputs/artifacts, loads older turns and releases streams", async () => {
  const b = await bench();
  const entry = b.slots
    .entries("sidebar.right.pane.tab")
    .find((e: any) => e.options.key === "project-mode-workers");
  expect(entry).toBeDefined();
  b.client.store.accept({
    ...snapshot(),
    revision: 2,
    workers: [
      ...snapshot().workers,
      {
        ...snapshot().workers[0],
        workerId: sid("child-two"),
        name: "Reviewer",
      },
    ],
  });
  const openResource = vi.fn(),
    signal = new AbortController().signal;
  const Component = entry!.component as any;
  const ui = render(
    <Component
      {...entry!.inject?.()}
      sessionId={sid("parent")}
      t={t}
      useTabInfo={() => ({
        tab: { visible: true, signal, actions: { openResource } },
      })}
    />,
  );
  await screen.findByText("Output child");
  const inputText = screen.getByText("Input child Keep this input as written.");
  const outputText = screen.getByText("Output child");
  const inputSummary = inputText.closest("summary")!;
  const outputSummary = outputText.closest("summary")!;
  expect(inputSummary).not.toBeNull();
  expect(outputSummary).not.toBeNull();
  const input = inputSummary.closest("details")!;
  const output = outputSummary.closest("details")!;
  expect(input).not.toBeNull();
  expect(output).not.toBeNull();
  expect(input.open).toBe(false);
  expect(output.open).toBe(false);
  expect(screen.getByRole("heading", { name: en.timelineInputs })).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: en.timelineOutputs }),
  ).toBeTruthy();
  fireEvent.click(inputText);
  expect(input.open).toBe(true);
  expect(output.open).toBe(false);
  expect(
    await screen.findByRole("heading", { name: "Input child" }),
  ).toBeTruthy();
  fireEvent.click(outputText);
  expect(output.open).toBe(true);
  await vi.waitFor(() =>
    expect(outputSummary.textContent).toBe(en.collapseText),
  );
  expect(input.open).toBe(true);
  fireEvent.click(outputSummary);
  expect(output.open).toBe(false);
  expect(screen.getByText("Keep").tagName).toBe("STRONG");
  expect(screen.getByText("report.md")).toBeTruthy();
  fireEvent.click(screen.getByText("report.md"));
  expect(openResource).toHaveBeenCalledWith(
    expect.stringContaining("/child/report.md"),
  );
  const axis = ui.container.querySelector(".pm-worker-axis")!;
  axis.scrollTop = 500;
  fireEvent.click(screen.getByRole("button", { name: /Reviewer/ }));
  await screen.findByText("Output child-two");
  expect(axis.scrollTop).toBe(0);
  expect(b.streamSignals[0].aborted).toBe(true);
  expect(screen.queryByText("Output child")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Load earlier/ }));
  await vi.waitFor(() =>
    expect(b.remote.timeline).toHaveBeenLastCalledWith(
      sid("parent"),
      sid("child-two"),
      20,
      expect.any(AbortSignal),
    ),
  );
  ui.unmount();
  expect(b.streamSignals.every((signal) => signal.aborted)).toBe(true);
  expect(b.streamDisposals).toHaveBeenCalled();
});

it("offers explicit reopen actions only while a Project is selected", async () => {
  const b = await bench();
  const entry = b.slots
    .entries("conversation.session.header.views.actions")
    .find((e: any) => e.options.id === "project-mode.open-panels");
  expect(entry).toBeDefined();
  const Component = entry!.component as any;
  render(<Component t={t} onDismiss={vi.fn()} />);
  fireEvent.click(screen.getByRole("menuitem", { name: "Workers" }));
  expect(b.sidebar.openTabIn).toHaveBeenCalledWith(
    sid("parent"),
    "project-mode-workers",
  );
  act(() => b.sidebar.mounted.set(sid("ordinary")));
  expect(screen.queryByRole("menuitem", { name: "Workers" })).toBeNull();
});

it("reopens a failed first timeline when the same Worker becomes natively ready, without restarting healthy streams on later activity", async () => {
  const b = await bench();
  const entry = b.slots
    .entries("sidebar.right.pane.tab")
    .find((e: any) => e.options.key === "project-mode-workers")!;
  const Component = entry.component as any;
  const initial = snapshot();
  b.client.store.accept({
    ...initial,
    revision: 2,
    workers: initial.workers.map((worker) => ({
      ...worker,
      lifecycle: "provisioning" as const,
      availability: "unavailable" as const,
      phase: "starting" as const,
    })),
  });
  b.remote.timeline.mockImplementationOnce(() => ({
    dispose: b.streamDisposals,
    async *[Symbol.asyncIterator]() {
      throw new Error("Native session not found before activation");
    },
  }));
  const signal = new AbortController().signal;
  render(
    <Component
      {...entry.inject?.()}
      sessionId={sid("parent")}
      t={t}
      useTabInfo={() => ({ tab: { visible: true, signal, actions: {} } })}
    />,
  );
  await screen.findByText("Native session not found before activation");
  expect(b.remote.timeline).toHaveBeenCalledTimes(1);
  act(() => b.client.store.accept({ ...initial, revision: 3 }));
  await screen.findByText("Output child");
  expect(
    screen.queryByText("Native session not found before activation"),
  ).toBeNull();
  expect(b.remote.timeline).toHaveBeenCalledTimes(2);
  for (const [revision, availability, status, phase] of [
    [4, "cold", "idle", "idle"],
    [5, "live", "busy", "working"],
  ] as const) {
    act(() =>
      b.client.store.accept({
        ...initial,
        revision,
        workers: initial.workers.map((worker) => ({
          ...worker,
          availability,
          status,
          phase,
        })),
      }),
    );
  }
  expect(b.remote.timeline).toHaveBeenCalledTimes(2);
});

it("keeps a ready Worker's actual timeline failure visible until explicit retry", async () => {
  const b = await bench();
  const entry = b.slots
    .entries("sidebar.right.pane.tab")
    .find((e: any) => e.options.key === "project-mode-workers")!;
  const Component = entry.component as any;
  b.remote.timeline.mockImplementationOnce(() => ({
    dispose: b.streamDisposals,
    async *[Symbol.asyncIterator]() {
      throw new Error("Native history is unreadable");
    },
  }));
  const signal = new AbortController().signal;
  render(
    <Component
      {...entry.inject?.()}
      sessionId={sid("parent")}
      t={t}
      useTabInfo={() => ({ tab: { visible: true, signal, actions: {} } })}
    />,
  );
  await screen.findByText("Native history is unreadable");
  for (const [revision, availability] of [
    [2, "cold"],
    [3, "live"],
  ] as const) {
    act(() =>
      b.client.store.accept({
        ...snapshot(),
        revision,
        workers: snapshot().workers.map((worker) => ({
          ...worker,
          availability,
        })),
      }),
    );
  }
  expect(b.remote.timeline).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: en.retry }));
  await screen.findByText("Output child");
  expect(b.remote.timeline).toHaveBeenCalledTimes(2);
});

it("omits removed and uncreated workers, switches away from a deleted selection and clears the final removed timeline", async () => {
  const b = await bench();
  const entry = b.slots
    .entries("sidebar.right.pane.tab")
    .find((e: any) => e.options.key === "project-mode-workers")!;
  const initial = snapshot();
  initial.workers = [
    {
      ...initial.workers[0],
      workerId: sid("removed"),
      name: "Removed",
      lifecycle: "deleted",
    },
    {
      ...initial.workers[0],
      workerId: sid("uncreated"),
      name: "Uncreated",
      lifecycle: "provision-failed",
      phase: "failed",
    },
    initial.workers[0],
    {
      ...initial.workers[0],
      workerId: sid("recoverable"),
      name: "Recoverable",
      phase: "failed",
    },
  ];
  b.client.store.accept(initial);
  const Component = entry.component as any;
  const signal = new AbortController().signal;
  render(
    <Component
      {...entry.inject?.()}
      sessionId={sid("parent")}
      t={t}
      useTabInfo={() => ({ tab: { visible: true, signal, actions: {} } })}
    />,
  );
  expect(screen.queryByRole("button", { name: /Removed/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Uncreated/ })).toBeNull();
  await screen.findByText("Output child");
  fireEvent.click(screen.getByRole("button", { name: /Recoverable/ }));
  await screen.findByText("Output recoverable");
  const originalSignal = b.streamSignals.at(-1)!;
  const next = {
    ...initial,
    revision: 3,
    workers: initial.workers.map((w) =>
      w.workerId === sid("recoverable")
        ? { ...w, lifecycle: "deleted" as const }
        : w,
    ),
  };
  act(() => b.client.store.accept(next));
  await screen.findByText("Output child");
  expect(originalSignal.aborted).toBe(true);
  expect(screen.queryByText("Output recoverable")).toBeNull();
  expect(b.client.store.project(sid("parent"))!.workers).toHaveLength(4);
  act(() =>
    b.client.store.accept({
      ...next,
      revision: 4,
      workers: next.workers.map((w) => ({
        ...w,
        lifecycle: "deleted" as const,
      })),
    }),
  );
  expect(screen.getByText(en.noWorkers)).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: en.workers })).toBeNull();
  expect(screen.queryByText(en.selectWorker)).toBeNull();
  expect(screen.queryByText("Output child")).toBeNull();
  expect(b.streamSignals.every((signal) => signal.aborted)).toBe(true);
});
