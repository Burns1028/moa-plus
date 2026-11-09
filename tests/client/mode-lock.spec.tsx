// @vitest-environment jsdom
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { SessionModeView } from "../../packages/project-mode/src/shared/index.ts";
import { ProjectToggle } from "../../packages/project-mode/src/client/components.tsx";
import { ProjectClient } from "../../packages/project-mode/src/client/runtime.ts";
import { en } from "../../packages/project-mode/src/client/locales.ts";
import { sid } from "./fixture.ts";
afterEach(cleanup);
const t = (key: keyof typeof en) => en[key];

it("keeps the MoA+ checkbox switchable before the first message", async () => {
  let mode: SessionModeView = {
    sessionId: sid("parent"),
    role: "ordinary",
    enabled: false,
    modeLocked: false,
    revision: 0,
    canToggle: true,
  };
  const setEnabled = vi.fn(async (_sessionId, enabled: boolean) => {
    mode = {
      ...mode,
      role: enabled ? "coordinator" : "ordinary",
      enabled,
      revision: mode.revision + 1,
    };
    return { ok: true, value: mode };
  });
  const client = new ProjectClient({
    mode: async () => ({ ok: true, value: mode }),
    setEnabled,
    catalog: async () => ({ ok: true, value: [] }),
  } as any);
  try {
    render(
      <ProjectToggle
        client={client}
        sessionId={sid("parent")}
        running={false}
        open={vi.fn()}
        t={t as any}
      />,
    );
    const checkbox = (await screen.findByRole("checkbox", {
      name: "MoA+",
    })) as HTMLInputElement;
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    const user = userEvent.setup();
    await user.click(checkbox);
    await waitFor(() => {
      expect(checkbox.checked).toBe(true);
      expect(checkbox.disabled).toBe(false);
    });
    await user.click(checkbox);
    await waitFor(() => {
      expect(checkbox.checked).toBe(false);
      expect(checkbox.disabled).toBe(false);
    });
    expect(setEnabled.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["parent", true],
      ["parent", false],
    ]);
  } finally {
    client.dispose();
  }
});

it.each([true, false])(
  "renders a fixed MoA+ identity without a checkbox when running=%s",
  async (running) => {
    const client = new ProjectClient({
      mode: async () => ({
        ok: true,
        value: {
          sessionId: sid("parent"),
          role: "coordinator",
          enabled: true,
          modeLocked: true,
          revision: 3,
          canToggle: false,
          toggleBlockedReason: "session-mode-locked",
        },
      }),
    } as any);
    try {
      await client.refreshMode(sid("parent"));
      render(
        <ProjectToggle
          client={client}
          sessionId={sid("parent")}
          running={running}
          open={vi.fn()}
          t={t as any}
        />,
      );
      expect(screen.getByText("MoA+")).toBeTruthy();
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.getByTitle(en["blocked.session-mode-locked"])).toBeTruthy();
    } finally {
      client.dispose();
    }
  },
);
