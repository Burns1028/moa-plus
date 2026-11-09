// @vitest-environment jsdom
import React from "react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import {
  WorkerCapsuleList,
  MoAToggle,
} from "../../packages/moa/src/client/components.tsx";
import { MoAClient } from "../../packages/moa/src/client/runtime.ts";
import { en } from "../../packages/moa/src/client/locales.ts";
import { snapshot, sid } from "./fixture.ts";
afterEach(cleanup);
const t = (key: keyof typeof en, args?: Record<string, unknown>) =>
  Object.entries(args ?? {}).reduce(
    (s, [k, v]) => s.replace("{" + k + "}", String(v)),
    en[key] as string,
  );
it("membership alone makes mounted tail visible and native closure avoids live historical fallback; click uses address", async () => {
  const client = new MoAClient({} as any),
    open = vi.fn();
  const s = snapshot();
  const { rerender } = render(
    <WorkerCapsuleList
      client={client}
      sessionId={sid("parent")}
      turn={3}
      closed={false}
      open={open}
      t={t}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  act(() => client.store.accept(s));
  const button = screen.getByRole("button", { name: "Open worker: Builder" });
  fireEvent.click(button);
  expect(open).toHaveBeenCalledWith({
    parentSessionId: "parent",
    childSessionId: "child",
    mode: "continuable",
  });
  button.focus();
  const keyboard = userEvent.setup();
  await keyboard.keyboard("{Enter}");
  await keyboard.keyboard(" ");
  expect(open).toHaveBeenCalledTimes(3);
  rerender(
    <WorkerCapsuleList
      client={client}
      sessionId={sid("parent")}
      turn={3}
      closed
      open={open}
      t={t}
    />,
  );
  // Native closure may precede the durable Project outcome. Keep the same
  // mounted row in its original seat through that transport gap.
  expect(screen.getByRole("button", { name: "Open worker: Builder" })).toBe(
    button,
  );
  client.dispose();
});
it("native checkbox stays unchecked during request, exposes busy and localized Host error", async () => {
  let finish: (v: unknown) => void = () => {};
  const client = new MoAClient({
    mode: async () => ({
      ok: true,
      value: {
        sessionId: sid("parent"),
        role: "ordinary",
        enabled: false,
        revision: 4,
        canToggle: true,
      },
    }),
    setEnabled: () => new Promise((r) => (finish = r)),
  } as any);
  render(
    <MoAToggle
      client={client}
      sessionId={sid("parent")}
      running={false}
      open={vi.fn()}
      t={t}
    />,
  );
  await act(async () => {});
  const check = screen.getByRole("checkbox") as HTMLInputElement;
  fireEvent.click(check);
  expect(check.checked).toBe(false);
  expect(check.disabled).toBe(true);
  await act(async () =>
    finish({ ok: false, error: { message: "Workers active" } }),
  );
  expect(screen.getByRole("alert").textContent).toContain("Workers active");
  client.dispose();
});

it("shows one completed label without duplicating a missing progress fallback", () => {
  const client = new MoAClient({} as any);
  const data = snapshot();
  data.closedTurnOutcomes = [
    {
      coordinatorSessionId: sid("parent"),
      coordinatorTurn: 3,
      workerId: sid("child"),
      status: "completed",
      completionIds: [],
    },
  ];
  client.store.accept(data);
  try {
    render(
      <WorkerCapsuleList
        client={client}
        sessionId={sid("parent")}
        turn={3}
        closed
        open={vi.fn()}
        t={t}
      />,
    );
    const button = screen.getByRole("button", { name: "Open worker: Builder" });
    expect(button.textContent?.match(/Completed/g)).toHaveLength(1);
  } finally {
    client.dispose();
  }
});
