import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import ProjectMode from "../../packages/project-mode/src/host/index.ts";
import { fixture, response } from "./fixture.ts";

const input = () =>
  createUserMessage({
    source: { kind: "user" },
    content: [{ type: "text", text: "hello" }],
  });
async function parent(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await f.ctx.agents.create({
      sessionId: SessionId("fixed-project"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    })
  ).agent;
}

it("permits choosing and clearing Project before the first native turn", async () => {
  const f = await fixture();
  try {
    const agent = await parent(f);
    const on = await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    expect(on).toMatchObject({
      enabled: true,
      modeLocked: false,
      canToggle: true,
    });
    const off = await f.ctx.projectMode.setEnabled(
      agent.id,
      false,
      on.revision,
      "off",
    );
    expect(off.enabled).toBe(false);
    expect(
      agent.session.snapshotEvents().some((e) => e.type === "turn/start"),
    ).toBe(false);
  } finally {
    await f.dispose();
  }
});

it("fixes Project at turn start and rejects downgrade while running and after idle", async () => {
  const f = await fixture();
  const gate = Promise.withResolvers<void>();
  try {
    const agent = await parent(f);
    const on = await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    f.adapter.handler = async () => {
      await gate.promise;
      return response("done");
    };
    agent.followup(input());
    await vi.waitFor(() => expect(f.adapter.requests.length).toBe(1));
    expect(f.ctx.projectMode.mode(agent.id)).toMatchObject({
      enabled: true,
      modeLocked: true,
      canToggle: false,
      toggleBlockedReason: "session-mode-locked",
    });
    await expect(
      f.ctx.projectMode.setEnabled(agent.id, false, on.revision, "racing-off"),
    ).rejects.toThrow("project-mode/session-mode-locked");
    gate.resolve();
    await agent.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    const mode = f.ctx.projectMode.mode(agent.id);
    expect(mode).toMatchObject({
      enabled: true,
      modeLocked: true,
      canToggle: false,
    });
    await expect(
      f.ctx.projectMode.setEnabled(agent.id, false, mode.revision, "idle-off"),
    ).rejects.toThrow("project-mode/session-mode-locked");
    expect(f.ctx.tools.get("moa_dispatch", agent)).toBeDefined();
  } finally {
    gate.resolve();
    await f.dispose();
  }
});

it("retains fixed mode through a fresh JSON runtime without restoring or waking the Agent", async () => {
  let f = await fixture(undefined, { keepFiles: true });
  try {
    const agent = await parent(f);
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    agent.followup(input());
    await agent.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    const root = f.root;
    await f.dispose();
    f = await fixture(undefined, { root });
    await f.ctx.projectMode.snapshot(agent.id);
    expect(f.ctx.agents.get(agent.id)).toBeUndefined();
    const mode = f.ctx.projectMode.mode(agent.id);
    expect(mode).toMatchObject({
      enabled: true,
      modeLocked: true,
      canToggle: false,
      toggleBlockedReason: "session-mode-locked",
    });
    await expect(
      f.ctx.projectMode.setEnabled(agent.id, false, mode.revision, "cold-off"),
    ).rejects.toThrow("project-mode/session-mode-locked");
    expect(f.adapter.requests).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});

it("recovers legacy enabled history as fixed mode without waking it", async () => {
  const f = await fixture();
  try {
    const agent = await parent(f);
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    agent.followup(input());
    await agent.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await (f.ctx.projectMode as any).update(agent.id, (r: any) => {
      const { modeLocked, ...project } = r.project;
      return { ...r, project };
    });
    const before = agent.session.snapshotEvents();
    const requests = f.adapter.requests.length;
    await f.plugin.dispose();
    await f.ctx.plugin(ProjectMode, { completionVerification: false });
    await f.ctx.projectMode.snapshot(agent.id);
    expect(f.ctx.projectMode.mode(agent.id)).toMatchObject({
      modeLocked: true,
      canToggle: false,
    });
    expect(agent.session.snapshotEvents()).toEqual(before);
    expect(f.adapter.requests).toHaveLength(requests);
  } finally {
    await f.dispose();
  }
});

it.each(["draft", "disabled-history"] as const)(
  "keeps a legacy %s switchable without changing its mode",
  async (kind) => {
    const f = await fixture();
    try {
      const agent = await parent(f);
      const on = await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
      if (kind === "disabled-history") {
        await f.ctx.projectMode.setEnabled(agent.id, false, on.revision, "off");
        agent.followup(input());
        await agent.whenIdle();
      }
      await f.ctx.projectMode.snapshot(agent.id);
      await (f.ctx.projectMode as any).update(agent.id, (r: any) => {
        const { modeLocked, ...project } = r.project;
        return { ...r, project };
      });
      await f.plugin.dispose();
      await f.ctx.plugin(ProjectMode, { completionVerification: false });
      await f.ctx.projectMode.snapshot(agent.id);
      const mode = f.ctx.projectMode.mode(agent.id);
      expect(mode).toMatchObject({
        enabled: kind === "draft",
        modeLocked: false,
        canToggle: true,
      });
      if (kind === "draft")
        expect(
          (
            await f.ctx.projectMode.setEnabled(
              agent.id,
              false,
              mode.revision,
              "clear-draft",
            )
          ).enabled,
        ).toBe(false);
      else {
        const converted = await f.ctx.projectMode.setEnabled(
          agent.id,
          true,
          mode.revision,
          "convert",
        );
        expect(converted).toMatchObject({
          enabled: true,
          modeLocked: true,
          canToggle: false,
        });
      }
    } finally {
      await f.dispose();
    }
  },
);

it("keeps Project identity after stopping the first native turn", async () => {
  const f = await fixture();
  const gate = Promise.withResolvers<void>();
  try {
    const agent = await parent(f);
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    f.adapter.handler = async () => {
      await gate.promise;
      return response("done");
    };
    agent.followup(input());
    await vi.waitFor(() => expect(f.adapter.requests.length).toBe(1));
    agent.cancel({ kind: "user" }, { keepInbox: true });
    gate.resolve();
    await agent.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    expect(
      agent.session.snapshotEvents().find((e) => e.type === "turn/end")?.data
        .reason.kind,
    ).toBe("aborted");
    const mode = f.ctx.projectMode.mode(agent.id);
    expect(mode).toMatchObject({
      enabled: true,
      modeLocked: true,
      canToggle: false,
    });
    await expect(
      f.ctx.projectMode.setEnabled(agent.id, false, mode.revision, "off"),
    ).rejects.toThrow("project-mode/session-mode-locked");
  } finally {
    gate.resolve();
    await f.dispose();
  }
});
