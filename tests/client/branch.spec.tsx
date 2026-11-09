// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MoABranch } from "../../packages/moa/src/client/branch.tsx";
import { MoAClient } from "../../packages/moa/src/client/runtime.ts";
import { en } from "../../packages/moa/src/client/locales.ts";
import { snapshot, sid } from "./fixture.ts";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
const t = (key: keyof typeof en, args?: Record<string, unknown>) =>
  Object.entries(args ?? {}).reduce(
    (s, [k, v]) => s.replace(`{${k}}`, String(v)),
    en[key] as string,
  );
function fixture() {
  const client = new MoAClient({} as any);
  client.store.accept(snapshot());
  const open = vi.fn(),
    parentOpen = vi.fn();
  const props = {
    client,
    open,
    sessionId: sid("parent"),
    matched: { coordinator: true },
    t,
    currentSessionId: sid("parent"),
    useWorkspaces: (select: (state: any) => unknown) =>
      select({ archivedSessionIds: [] }),
    renderRow: (prefix?: React.ReactNode) => (
      <div onClick={parentOpen}>
        {prefix}
        <span>Coordinator</span>
      </div>
    ),
    renderChild: (child: any) => (
      <button
        key={child.sessionId}
        aria-current={child.selected ? "page" : undefined}
        onClick={child.onOpen}
      >
        {child.icon}
        {child.title}
        <span>{child.trailing}</span>
      </button>
    ),
  };
  return { client, open, parentOpen, props };
}
it("keeps an archived Project as a native row without clickable worker branches and restores on unarchive", () => {
  const f = fixture();
  let archived = [sid("parent")];
  const props = {
    ...f.props,
    currentSessionId: sid("child"),
    useWorkspaces: (select: (state: any) => unknown) =>
      select({ archivedSessionIds: archived }),
  };
  try {
    const view = render(<MoABranch {...(props as any)} />);
    expect(screen.getByText("Coordinator")).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    archived = [];
    view.rerender(<MoABranch {...(props as any)} />);
    expect(screen.getByRole("button", { name: "BuilderWorking" })).toBeTruthy();
    archived = [sid("child")];
    view.rerender(<MoABranch {...(props as any)} />);
    expect(screen.queryByText("Builder")).toBeNull();
  } finally {
    f.client.dispose();
  }
});
it("adds only expandable worker rows and preserves the native child address and stable identity", () => {
  const f = fixture();
  try {
    const view = render(<MoABranch {...(f.props as any)} />);
    expect(screen.queryByText("Builder")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Workers" }));
    expect(f.parentOpen).not.toHaveBeenCalled();
    const child = screen.getByRole("button", { name: "BuilderWorking" });
    const identity = child.querySelector("svg")!.outerHTML;
    fireEvent.click(child);
    expect(f.open).toHaveBeenCalledWith({
      parentSessionId: "parent",
      childSessionId: "child",
      mode: "continuable",
    });
    expect(f.parentOpen).not.toHaveBeenCalled();
    const next = snapshot();
    next.revision = 2;
    next.workers[0] = { ...next.workers[0], name: "Renamed", phase: "idle" };
    act(() => f.client.store.accept(next));
    expect(
      screen.getByRole("button", { name: "RenamedIdle" }).querySelector("svg")!
        .outerHTML,
    ).toBe(identity);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Workers" }));
    expect(screen.queryByText("Renamed")).toBeNull();
    view.unmount();
    render(<MoABranch {...(f.props as any)} />);
    expect(screen.queryByText("Renamed")).toBeNull();
  } finally {
    f.client.dispose();
  }
});
it("reveals the current native worker, clears selection for an active panel, and never restores deleted workers", () => {
  const f = fixture();
  try {
    const view = render(
      <MoABranch
        {...({ ...f.props, currentSessionId: sid("child") } as any)}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "BuilderWorking" })
        .getAttribute("aria-current"),
    ).toBe("page");
    view.rerender(
      <MoABranch
        {...({ ...f.props, currentSessionId: undefined } as any)}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "BuilderWorking" })
        .getAttribute("aria-current"),
    ).toBeNull();
    const next = snapshot();
    next.revision = 2;
    next.workers[0].lifecycle = "deleted";
    act(() => f.client.store.accept(next));
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Coordinator")).toBeTruthy();
  } finally {
    f.client.dispose();
  }
});

it("shows native running motion only while the worker runs and keeps its identity", () => {
  const f = fixture();
  try {
    render(<MoABranch {...(f.props as any)} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Workers" }));
    const row = screen.getByRole("button", { name: "BuilderWorking" });
    const identity = row.querySelector(".pm-worker-icon")!.outerHTML;
    expect(row.querySelector('[data-state="ongoing"]')).not.toBeNull();

    for (const [index, phase] of (
      [
        "idle",
        "starting",
        "working",
        "waiting-user",
        "stopped",
        "failed",
        "disconnected",
      ] as const
    ).entries()) {
      const next = snapshot();
      next.revision = index + 2;
      next.workers[0].phase = phase;
      act(() => f.client.store.accept(next));
      expect(row.querySelector(".pm-worker-icon")!.outerHTML).toBe(identity);
      expect(Boolean(row.querySelector('[data-state="ongoing"]'))).toBe(
        phase === "starting" || phase === "working",
      );
    }
  } finally {
    f.client.dispose();
  }
});
