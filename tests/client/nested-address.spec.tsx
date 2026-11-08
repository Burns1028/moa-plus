// @vitest-environment jsdom
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkerCapsuleList, ProjectToggle } from "../../packages/project-mode/src/client/components.tsx";
import { ProjectBranch } from "../../packages/project-mode/src/client/branch.tsx";
import { WorkersPanel } from "../../packages/project-mode/src/client/worker-timeline.tsx";
import { ProjectClient } from "../../packages/project-mode/src/client/runtime.ts";
import { en } from "../../packages/project-mode/src/client/locales.ts";
import { snapshot, sid } from "./fixture.ts";

afterEach(() => { cleanup(); localStorage.clear(); });
const t = (key: keyof typeof en, args?: Record<string, string | number>) =>
  String(en[key]).replace(/\{(\w+)\}/g, (_, name) => String(args?.[name] ?? name));

it.each(["capsule", "sidebar", "timeline"] as const)(
  "opens a nested worker from its %s with its true native parent address",
  async (entry) => {
    const client = new ProjectClient({} as any), open = vi.fn();
    const data = snapshot();
    client.store.accept({ ...data, workers: data.workers.map(worker => ({ ...worker, parentSessionId: sid("leader") })) });
    try {
      if (entry === "capsule") {
        render(<WorkerCapsuleList client={client} open={open} t={t} sessionId={sid("parent")} turn={3} closed={false} />);
        fireEvent.click(screen.getByRole("button", { name: "Open worker: Builder" }));
      } else if (entry === "sidebar") {
        render(<ProjectBranch {...({
          client, open, t, sessionId: sid("parent"), currentSessionId: sid("parent"), matched: { coordinator: true },
          useWorkspaces: (select: (state: unknown) => unknown) => select({ archivedSessionIds: [] }),
          renderRow: (prefix: React.ReactNode) => <div>{prefix}<span>Coordinator</span></div>,
          renderChild: (child: any) => <button key={child.sessionId} onClick={child.onOpen}>{child.title}</button>,
        } as any)} />);
        fireEvent.click(screen.getByRole("button", { name: "Expand Workers" }));
        fireEvent.click(screen.getByRole("button", { name: "Builder" }));
      } else {
        const abort = new AbortController();
        const timeline = (_root: unknown, workerId: unknown, _limit: unknown, signal: AbortSignal) => ({
          dispose() {},
          async *[Symbol.asyncIterator]() {
            yield { workerId, total: 0, hasMore: false, turns: [] };
            if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
          },
        });
        render(<WorkersPanel {...({ client, open, t, sessionId: sid("parent"), timeline, useTabInfo: () => ({ tab: { visible: true, signal: abort.signal } }) } as any)} />);
        fireEvent.click(screen.getByRole("button", { name: en.openConversation }));
      }
      expect(open).toHaveBeenCalledExactlyOnceWith({ parentSessionId: "leader", childSessionId: "child", mode: "continuable" });
    } finally { cleanup(); client.dispose(); }
  },
);

it("keeps Back directed to the project's Coordinator rather than a nested creator", async () => {
  const open = vi.fn();
  const client = new ProjectClient({
    mode: async () => ({ ok: true, value: { sessionId: sid("child"), role: "worker", enabled: false, revision: 1, canToggle: false, coordinatorSessionId: sid("parent") } }),
  } as any);
  const data = snapshot();
  client.store.accept({ ...data, workers: data.workers.map(worker => ({ ...worker, parentSessionId: sid("leader") })) });
  try {
    render(<ProjectToggle client={client} open={open} t={t} sessionId={sid("child")} running={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(sid("parent"));
  } finally { client.dispose(); }
});
