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

it("keeps the MoA+ wordmark switchable before the first message", async () => {
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
    const button = (await screen.findByRole("button", {
      name: "MoA+",
    })) as HTMLButtonElement;
    expect(screen.queryByRole("checkbox")).toBeNull();
    await waitFor(() => expect(button.disabled).toBe(false));
    const user = userEvent.setup();
    await user.click(button);
    await waitFor(() => {
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.disabled).toBe(false);
    });
    button.focus();
    await user.keyboard(" ");
    await waitFor(() => {
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.disabled).toBe(false);
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
      expect(screen.getByRole("img", { name: "MoA+" })).toBeTruthy();
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByTitle(en["blocked.session-mode-locked"])).toBeTruthy();
    } finally {
      client.dispose();
    }
  },
);
