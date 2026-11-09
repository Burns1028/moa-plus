import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { fixture, response } from "./fixture.ts";
import MoAPlugin from "../../packages/moa/src/host/index.ts";
import { steerHostSubagentPrompt } from "../../packages/moa/src/host/native.ts";

it.each(["reload", "restart"] as const)(
  "does not wake the coordinator again for a native result after %s",
  async (mode) => {
    let f = await fixture(undefined, { keepFiles: mode === "restart" });
    try {
      let { agent } = await f.ctx.agents.create({
        sessionId: SessionId("native-receipt-recovery"),
        meta: { cwd: f.root },
        agentOptions: { provider: "test", model: "test" },
      });
      await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
      const { workerId } = (await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "spawn", name: "worker", task: "initial" },
        "spawn",
        new AbortController().signal,
      )) as { workerId: ReturnType<typeof SessionId> };
      await f.ctx.agents.get(workerId)?.whenIdle();
      await f.ctx.projectMode.snapshot(agent.id);
      await agent.whenIdle();
      await vi.waitFor(() =>
        expect(f.ctx.agents.get(workerId)).toBeUndefined(),
      );
      await f.plugin.dispose();
      f.adapter.handler = () => response("legacy result");
      await steerHostSubagentPrompt(
        f.ctx.subagents,
        agent,
        workerId,
        [{ type: "text", text: "legacy task" }],
        { kind: "agent-message", form: "relay", senderSessionId: agent.id },
        new AbortController().signal,
      );
      await f.ctx.agents.get(workerId)?.whenIdle();
      await vi.waitFor(() =>
        expect(
          agent.session
            .snapshotEvents()
            .filter(
              (e) =>
                e.type === "user/message" &&
                e.data.source.kind === "subagent-settled",
            ),
        ).toHaveLength(1),
      );
      await agent.whenIdle();
      const native = agent.session
        .snapshotEvents()
        .filter(
          (e) =>
            e.type === "user/message" &&
            e.data.source.kind === "subagent-settled",
        );
      expect(native).toHaveLength(1);
      let requests = f.adapter.requests.length;
      const turns = agent.session
        .snapshotEvents()
        .filter((e) => e.type === "turn/start").length;
      const parentId = agent.id;
      if (mode === "restart") {
        const root = f.root;
        await f.dispose();
        f = await fixture(undefined, { root });
        await f.ctx.projectMode.snapshot(parentId);
        ({ agent } = await f.ctx.agents.resume({
          resumeSessionId: parentId,
          agentOptions: { provider: "test", model: "test" },
        }));
        requests = 0;
      } else await f.ctx.plugin(MoAPlugin, {});
      await f.ctx.projectMode.snapshot(agent.id);
      await agent.whenIdle();
      expect(f.adapter.requests).toHaveLength(requests);
      expect(
        agent.session.snapshotEvents().filter((e) => e.type === "turn/start"),
      ).toHaveLength(turns);
      const record = (f.ctx.projectMode as any).record(agent.id);
      expect(record.completions).toHaveLength(2);
      expect(record.deliveries[1]).toMatchObject({
        state: "consumed",
        attempts: 0,
        nativeReceipt: { messageId: native[0].data.id, seq: native[0].seq },
      });
      await (f.ctx.projectMode as any).recover(agent.id);
      await f.ctx.projectMode.snapshot(agent.id);
      expect(f.adapter.requests).toHaveLength(requests);
    } finally {
      await f.dispose();
    }
  },
);
