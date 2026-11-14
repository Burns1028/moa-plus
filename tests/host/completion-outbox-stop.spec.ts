import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

const input = (text: string) => createUserMessage({
  source: { kind: "user" }, content: [{ type: "text", text }],
});

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

it.each(["completed", "aborted"] as const)(
  "parks a %s Worker result after joined Stop and returns it once on human resume",
  async (outcome) => {
    const f = await fixture();
    const rootStarted = Promise.withResolvers<void>();
    const workerStarted = Promise.withResolvers<void>();
    const releaseWorker = Promise.withResolvers<void>();
    const full = "Complete Worker evidence, including the final detail. ".repeat(100);
    try {
      const { agent: root } = await f.ctx.agents.create({
        sessionId: SessionId(`outbox-stop-${outcome}`), meta: { cwd: f.root },
        agentOptions: { provider: "test", model: "test" },
      });
      await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
      let rootCalls = 0;
      f.adapter.handler = async (options) => {
        if (options.sessionId === root.id) {
          if (rootCalls++ === 0) {
            rootStarted.resolve();
            return untilAborted(options.signal!);
          }
          return response("Delivered the existing assignment result.");
        }
        workerStarted.resolve();
        if (outcome === "aborted") return untilAborted(options.signal!);
        await releaseWorker.promise;
        return response(full);
      };
      const host = f.ctx.projectMode as any;
      root.followup(input("Work on this task; keep the existing assignment."));
      await rootStarted.promise;
      const [receipt] = await host.moa.dispatch(root, [{
        name: "Worker", task: "produce the result", role: "General-purpose", workspace: "shared",
      }], "worker", new AbortController().signal);
      const worker = f.ctx.agents.get(SessionId(receipt.workerId))!;
      await workerStarted.promise;

      await root.cancelAndJoin({ kind: "user" });
      expect(root.session.snapshotEvents().filter(e => e.type === "turn/end").at(-1))
        .toMatchObject({ data: { reason: { kind: "aborted", reason: { kind: "user" } } } });
      if (outcome === "aborted")
        await host.moa.stopWork(root, worker.id, new AbortController().signal);
      else releaseWorker.resolve();
      await worker.whenIdle();
      await host.outbox.ingest(worker.id);
      await f.ctx.projectMode.snapshot(root.id);
      await host.outbox.deliver(root.id);
      await root.whenIdle();

      const record = host.record(root.id);
      expect(record.completions).toHaveLength(1);
      const completion = record.completions[0], delivery = record.deliveries[0];
      const assignmentIds = record.assignments.map((a: any) => a.id);
      expect(completion).toMatchObject({ workerId: worker.id, workerTurn: 1, outcome });
      expect(delivery).toMatchObject({ state: "pending", attempts: 0 });
      expect(root.moaStopped).toBe(true);
      expect(root.status).toBe("idle");
      expect(rootCalls).toBe(1);
      expect([...root.inbox.nextStep, ...root.inbox.nextTurn]).toHaveLength(0);
      expect(root.session.snapshotEvents().filter(e => e.type === "turn/start")).toHaveLength(1);
      expect(delivery.message.content.slice(1)).toEqual(
        outcome === "completed" ? [{ type: "text", text: full }] : [],
      );

      root.followup(input("Continue the same task and use the existing result."));
      await root.whenIdle();
      await f.ctx.projectMode.snapshot(root.id);
      await host.outbox.deliver(root.id);
      await root.whenIdle();
      const returned = root.session.snapshotEvents().filter(e =>
        e.type === "user/message" && e.data.source.kind === "project-mode-result",
      );
      expect(returned).toHaveLength(1);
      expect(returned[0].data).toMatchObject({ id: delivery.message.id, content: delivery.message.content });
      expect(host.record(root.id).deliveries[0]).toMatchObject({
        completionId: completion.id, state: "consumed", attempts: 0,
      });
      expect(host.record(root.id).completions).toHaveLength(1);
      expect(host.record(root.id).assignments.map((a: any) => a.id)).toEqual(assignmentIds);
      expect(root.moaStopped).toBe(false);
      expect(rootCalls).toBe(2);
      expect(root.session.snapshotEvents().filter(e => e.type === "turn/start")).toHaveLength(2);
      expect(root.session.snapshotEvents().filter(e => e.type === "turn/end").at(-1))
        .toMatchObject({ data: { reason: { kind: "completed" } } });
    } finally {
      releaseWorker.resolve();
      await f.dispose();
    }
  },
);

it("rechecks joined Stop after awaited native receipt adoption before admitting another result", async () => {
  const f = await fixture();
  const adopting = Promise.withResolvers<void>();
  const releaseAdoption = Promise.withResolvers<void>();
  let restore: (() => void) | undefined;
  try {
    const { agent: root } = await f.ctx.agents.create({
      sessionId: SessionId("outbox-stop-adoption"), meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    f.adapter.handler = (options) => response(options.sessionId === root.id ? "reviewed" : "full Worker result");
    // Hold automatic admission at its existing native normalization boundary.
    // Both real Worker endings must be durable before the storage race starts.
    host.outbox.normalizing.add(root.id);
    const receipts = await host.moa.dispatch(root, [
      { name: "first", task: "first task", role: "General-purpose", workspace: "shared" },
      { name: "second", task: "second task", role: "General-purpose", workspace: "shared" },
    ], "workers", new AbortController().signal);
    for (const receipt of receipts) {
      await f.ctx.agents.get(SessionId(receipt.workerId))?.whenIdle();
      await host.outbox.ingest(SessionId(receipt.workerId));
    }
    await f.ctx.projectMode.snapshot(root.id);
    expect(host.record(root.id).deliveries).toHaveLength(2);
    expect(f.adapter.requests.filter(r => r.sessionId === root.id)).toHaveLength(0);
    const [first, second] = host.record(root.id).deliveries;
    const completion = host.record(root.id).completions.find((c: any) => c.id === first.completionId);
    // A committed legacy native receipt can exist before canonical outbox
    // reconciliation. Record its actual admission and complete native payload.
    const native = createUserMessage({
      source: { kind: "subagent-settled", form: "relay", senderSessionId: completion.workerId },
      content: [
        { type: "text", text: `Background subagent ${completion.workerId} finished and will do no further work unless you send it more.` },
        { type: "text", text: "Its closing message:" },
        ...completion.lastAssistant.content,
      ],
    });
    root.inbox.splice("next-step", Infinity, 0, [freezeMessage(native)]);
    root.inbox.remove(native.id);
    root.session.append("user/message", native, { surfaceOp: "append" });
    host.outbox.normalizing.delete(root.id);

    const update = host.update.bind(host);
    const spy = vi.spyOn(host, "update").mockImplementation(async (...args: any[]) => {
      const [id, change] = args;
      if (change(host.record(id)).deliveries.some((d: any) =>
        d.completionId === first.completionId && d.nativeReceipt,
      )) {
        adopting.resolve();
        await releaseAdoption.promise;
      }
      return update(...args);
    });
    restore = () => spy.mockRestore();
    const delivery = host.outbox.deliver(root.id);
    await adopting.promise;
    await root.cancelAndJoin({ kind: "user" });
    releaseAdoption.resolve();
    await delivery;
    await root.whenIdle();
    expect(root.moaStopped).toBe(true);
    expect(f.adapter.requests.filter(r => r.sessionId === root.id)).toHaveLength(0);
    expect(root.session.snapshotEvents().filter(e => e.type === "turn/start")).toHaveLength(0);
    expect([...root.inbox.nextStep, ...root.inbox.nextTurn]).toHaveLength(0);
    expect(host.record(root.id).deliveries.find((d: any) => d.completionId === first.completionId))
      .toMatchObject({ state: "consumed", attempts: 0, nativeReceipt: { messageId: native.id } });
    expect(host.record(root.id).deliveries.find((d: any) => d.completionId === second.completionId))
      .toMatchObject({ state: "pending", attempts: 0 });
  } finally {
    releaseAdoption.resolve();
    restore?.();
    await f.dispose();
  }
});
