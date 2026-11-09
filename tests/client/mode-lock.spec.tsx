// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProjectToggle } from "../../packages/project-mode/src/client/components.tsx";
import { ProjectClient } from "../../packages/project-mode/src/client/runtime.ts";
import { en } from "../../packages/project-mode/src/client/locales.ts";
import { sid } from "./fixture.ts";
afterEach(cleanup);
const t = (key: keyof typeof en) => en[key];

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
