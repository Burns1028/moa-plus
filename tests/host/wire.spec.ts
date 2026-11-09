import { it, expect } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import Registry from "@deepseek-ai/dsh-typert-registry";
import Gateway from "@deepseek-ai/dsh-api-gateway";
import Access from "@deepseek-ai/dsh-api-remote-access";
import { fixture } from "./fixture.ts";

it("dispatches the compiled plugin through native Gateway with generated codecs and stream cancellation", async () => {
  const f = await fixture();
  try {
    await f.plugin.dispose();
    const entry = new URL(
      "../../packages/moa/lib/index.js",
      import.meta.url,
    ).href;
    const host = new URL(
      "../../packages/moa/lib/typert.host.js",
      import.meta.url,
    ).href;
    const remote = new URL(
      "../../packages/moa/lib/typert.remote-client.js",
      import.meta.url,
    ).href;
    await f.ctx.plugin((await import(entry)).default, {});
    await f.ctx.plugin(Registry);
    f.ctx.typert.register((await import(host)).TYPERT);
    await f.ctx.plugin(Access);
    await f.ctx.plugin(Gateway);
    const info = (await import(remote)).default;
    expect(Object.keys(info.methods).sort()).toEqual(
      [
        "catalog",
        "control",
        "follow",
        "history",
        "mode",
        "setEnabled",
        "snapshot",
        "timeline",
      ].map((key) => `projectMode/${key}`),
    );
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("wire-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const peer = new Peer(f.ctx, { principal: { kind: "owner" } });
    const args = info.methods["projectMode/setEnabled"].input().create().parse({
      sessionId: agent.id,
      enabled: true,
      expectedRevision: 0,
      requestId: "wire",
    });
    const value = await f.ctx.typertGateway.invoke({
      namespace: "projectMode",
      method: "setEnabled",
      args: JSON.parse(JSON.stringify(args)),
      peer,
    });
    const decoded = info.methods["projectMode/setEnabled"].result
      .create()
      .parse(JSON.parse(JSON.stringify(value)));
    expect(decoded).toMatchObject({
      enabled: true,
      role: "coordinator",
      sessionId: agent.id,
    });
    const receipt = (await f.ctx.typertGateway.invoke({
      namespace: "projectMode",
      method: "control",
      args: {
        sessionId: agent.id,
        request: { action: "spawn", name: "history", task: "wire assignment" },
        requestId: "wire-spawn",
      },
      peer,
    })) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const history = await f.ctx.typertGateway.invoke({
      namespace: "projectMode",
      method: "history",
      args: {
        sessionId: agent.id,
        workerId: receipt.workerId,
        offset: 0,
        limit: 200,
      },
      peer,
    });
    expect(
      info.methods["projectMode/history"].result.create().parse(history),
    ).toMatchObject({
      status: "idle",
      offset: 0,
      limit: 200,
      total: 2,
      messages: [
        { index: 0, role: "assistant", text: "done" },
        { index: 1, role: "user", text: "wire assignment" },
      ],
    });
    const older = await f.ctx.typertGateway.invoke({
      namespace: "projectMode",
      method: "control",
      args: {
        sessionId: agent.id,
        request: {
          action: "history",
          worker_id: receipt.workerId,
          offset: 1,
          limit: 1,
        },
        requestId: "wire-history",
      },
      peer,
    });
    expect(
      info.methods["projectMode/control"].result.create().parse(older),
    ).toMatchObject({
      offset: 1,
      limit: 1,
      messages: [{ index: 1, role: "user", text: "wire assignment" }],
    });
    const controller = new AbortController();
    const stream = await f.ctx.typertGateway.stream({
      namespace: "projectMode",
      method: "follow",
      args: { sessionId: agent.id },
      peer,
      signal: controller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const frame = await iterator.next();
    expect(
      info.methods["projectMode/follow"].result
        .create()
        .parse(JSON.parse(JSON.stringify(frame.value))),
    ).toMatchObject({
      type: "baseline",
      value: { project: { coordinatorSessionId: agent.id } },
    });
    controller.abort();
    await iterator.return?.();
    await expect(
      f.ctx.typertGateway.invoke({
        namespace: "projectMode",
        method: "setEnabled",
        args: { sessionId: agent.id, enabled: "wrong" },
        peer,
      }),
    ).rejects.toThrow();
  } finally {
    await f.dispose();
  }
});
